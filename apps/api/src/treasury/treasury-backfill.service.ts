import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  CashMovementType,
  ExpenseStatus,
  money,
  type PaymentMode,
  PaymentStatus,
  PurchaseStatus,
  SupplierPaymentStatus,
  toMoneyString,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { tenantContext } from '../common/tenant-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { type CashEntry, CashLedgerService, toDay } from './cash-ledger.service';

export interface TreasuryBackfillResult {
  tenants: number;
  /** Rows given an account: a row without a movement was already cancelled or bounced. */
  linked: number;
  movements: number;
  /** BRs paid at reception that stay as they are: the opening has to account for them. */
  paidAtReception: { count: number; total: string };
}

interface OldRow {
  id: string;
  number: string;
  amount: { toString(): string };
  mode: PaymentMode;
  warehouseId: string | null;
  day: string;
  live: boolean;
}

const BATCH = 500;

type MoneyTable = 'payments' | 'supplier_payments' | 'expenses';

/**
 * One-off after the phase 34 deploy (docs/runbook.md, "Treasury backfill"): links the money
 * rows to the default accounts and writes their movements, dated at the row's date. Only a
 * row without an account is touched, in the same transaction as its movement, so a second run
 * changes nothing and a run during the deploy catches what the old version still wrote.
 */
@Injectable()
export class TreasuryBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: CashLedgerService,
    private readonly audit: AuditService,
  ) {}

  async run(): Promise<TreasuryBackfillResult> {
    const tenants = await tenantContext.runAsSystem(() =>
      this.prisma.db.tenant.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    );
    const result = { tenants: tenants.length, linked: 0, movements: 0 };
    let count = 0;
    let total = money(0);
    for (const t of tenants) {
      await tenantContext.run({ tenantId: t.id }, async () => {
        const done = await this.tenant();
        result.linked += done.linked;
        result.movements += done.movements;
        const paid = await this.paidAtReception();
        count += paid.count;
        total = total.plus(paid.total);
      });
    }
    return { ...result, paidAtReception: { count, total: toMoneyString(total) } };
  }

  /**
   * Locks a batch before reading it: a cancel that lands while it runs either happens first
   * (the row reads as cancelled) or waits and then finds the movement to reverse.
   */
  private async lockBatch(tx: Tx, table: MoneyTable): Promise<string[]> {
    // `table` comes from the literal union above, never from input.
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM ${table} WHERE "tenantId" = $1::uuid AND "cashAccountId" IS NULL
       ORDER BY id LIMIT ${BATCH} FOR UPDATE`,
      tenantContext.requireTenantId(),
    );
    return rows.map((r) => r.id);
  }

  private async tenant(): Promise<{ linked: number; movements: number }> {
    const sum = { linked: 0, movements: 0 };
    const pass = async (
      read: (tx: Tx) => Promise<OldRow[]>,
      link: (tx: Tx, ids: string[], cashAccountId: string) => Promise<unknown>,
      type: CashMovementType,
      refType: string,
      sign: 1 | -1,
    ) => {
      for (;;) {
        const done = await this.prisma.db.$transaction(
          async (tx) => {
            await this.ledger.ensureAccounts(tx);
            const rows = await read(tx);
            const groups = new Map<string, OldRow[]>();
            const entries: CashEntry[] = [];
            for (const r of rows) {
              const cashAccountId = await this.ledger.defaultFor(tx, r);
              groups.set(cashAccountId, [...(groups.get(cashAccountId) ?? []), r]);
              if (!r.live) continue;
              entries.push({
                cashAccountId,
                amount: money(r.amount.toString()).times(sign).toString(),
                type,
                refType,
                refId: r.id,
                date: r.day,
                note: r.number,
              });
            }
            for (const [cashAccountId, group] of groups) {
              await link(
                tx,
                group.map((r) => r.id),
                cashAccountId,
              );
            }
            await this.ledger.post(tx, entries);
            if (rows.length > 0) {
              await this.audit.log(tx, {
                action: 'TREASURY_BACKFILLED',
                entity: refType,
                entityId: tenantContext.requireTenantId(),
                after: { linked: rows.length, movements: entries.length },
              });
            }
            return { linked: rows.length, movements: entries.length };
          },
          { timeout: 120_000 },
        );
        sum.linked += done.linked;
        sum.movements += done.movements;
        if (done.linked < BATCH) return;
      }
    };

    await pass(
      async (tx) =>
        (
          await tx.payment.findMany({
            where: { id: { in: await this.lockBatch(tx, 'payments') } },
          })
        ).map((p) => ({
          id: p.id,
          number: p.number,
          amount: p.amount,
          mode: p.mode,
          warehouseId: p.warehouseId,
          day: algiersDay(p.receivedAt),
          live: p.status === PaymentStatus.VALID,
        })),
      (tx, ids, cashAccountId) =>
        tx.payment.updateMany({ where: { id: { in: ids } }, data: { cashAccountId } }),
      CashMovementType.VERSEMENT,
      'Payment',
      1,
    );
    await pass(
      async (tx) =>
        (
          await tx.supplierPayment.findMany({
            where: { id: { in: await this.lockBatch(tx, 'supplier_payments') } },
          })
        ).map((p) => ({
          id: p.id,
          number: p.number,
          amount: p.amount,
          mode: p.mode,
          warehouseId: p.warehouseId,
          day: algiersDay(p.paidAt),
          live: p.status === SupplierPaymentStatus.VALID,
        })),
      (tx, ids, cashAccountId) =>
        tx.supplierPayment.updateMany({ where: { id: { in: ids } }, data: { cashAccountId } }),
      CashMovementType.SUPPLIER_PAYMENT,
      'SupplierPayment',
      -1,
    );
    await pass(
      async (tx) =>
        (
          await tx.expense.findMany({
            where: { id: { in: await this.lockBatch(tx, 'expenses') } },
          })
        ).map((e) => ({
          id: e.id,
          number: e.number,
          amount: e.amount,
          mode: e.mode,
          warehouseId: e.warehouseId,
          day: toDay(e.date),
          live: e.status === ExpenseStatus.VALID,
        })),
      (tx, ids, cashAccountId) =>
        tx.expense.updateMany({ where: { id: { in: ids } }, data: { cashAccountId } }),
      CashMovementType.EXPENSE,
      'Expense',
      -1,
    );
    return sum;
  }

  /** Validated BRs with a paid part and no règlement: the money left, but no row says how. */
  private async paidAtReception(): Promise<{ count: number; total: string }> {
    const found = await this.prisma.db.purchase.aggregate({
      where: {
        status: { in: [PurchaseStatus.VALIDATED, PurchaseStatus.IN_TRANSIT] },
        paidAmount: { gt: 0 },
        paidPayment: { is: null },
      },
      _count: true,
      _sum: { paidAmount: true },
    });
    return { count: found._count, total: found._sum.paidAmount?.toString() ?? '0' };
  }
}
