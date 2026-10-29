import { Injectable } from '@nestjs/common';
import { ErrorCode, money, type Money, type SupplierLedgerType, toMoneyString } from '@erp/shared';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { type Tx } from '../prisma/prisma.service';

export interface SupplierEntryInput {
  supplierId: string;
  type: SupplierLedgerType;
  /** Signed: + we owe the supplier more, - we owe less. */
  amount: string;
  /** Short description stored with the entry (document number, note...). */
  label: string;
  reason?: string | null;
  refType?: string | null;
  refId?: string | null;
  /** Only for the backfill of past bons de réception; defaults to now. */
  createdAt?: Date;
}

interface BalanceRow {
  balance: Money;
  hasOpening: boolean;
}

/**
 * The only way to change a supplier account (dettes fournisseurs, phase 21), the twin
 * of ClientAccountService. Bons de réception, retours, règlements and the import call
 * `post` inside their own transaction; nothing else writes supplier_ledger_entries or
 * supplier_balances.
 */
@Injectable()
export class SupplierAccountService {
  async post(tx: Tx, entries: SupplierEntryInput[]): Promise<Map<string, string>> {
    if (entries.length === 0) return new Map();
    const tenantId = tenantContext.requireTenantId();
    const userId = tenantContext.get()?.userId ?? null;
    const balances = await this.lock(
      tx,
      entries.map((e) => e.supplierId),
    );

    for (const e of entries) {
      const row = balances.get(e.supplierId);
      if (!row) throw new Error(`balance not locked for ${e.supplierId}`);
      const amount = money(e.amount);
      if (amount.isZero()) throw new Error('A ledger entry cannot be zero');
      if (e.type === 'OPENING') {
        if (row.hasOpening) {
          throw new AppException(
            ErrorCode.SUPPLIER_OPENING_ALREADY_SET,
            'Opening balance already set',
            { supplierId: e.supplierId },
          );
        }
        row.hasOpening = true;
      }
      row.balance = row.balance.plus(amount);
      await tx.supplierLedgerEntry.create({
        data: {
          tenantId,
          supplierId: e.supplierId,
          type: e.type,
          amount: amount.toString(),
          label: e.label.slice(0, 160),
          reason: e.reason ?? null,
          refType: e.refType ?? null,
          refId: e.refId ?? null,
          createdBy: userId,
          ...(e.createdAt ? { createdAt: e.createdAt } : {}),
        },
      });
    }

    const result = new Map<string, string>();
    for (const [supplierId, row] of balances) {
      await tx.supplierBalance.update({
        where: { supplierId },
        data: { balance: row.balance.toString(), hasOpening: row.hasOpening },
      });
      result.set(supplierId, toMoneyString(row.balance));
    }
    return result;
  }

  /**
   * Net amount documents put on the account (sum of their entries), so a cancellation
   * reverses exactly what is left. Call with the document locked.
   */
  async netOf(tx: Tx, refs: { refType: string; refIds: string[] }): Promise<Money> {
    if (refs.refIds.length === 0) return money(0);
    const agg = await tx.supplierLedgerEntry.aggregate({
      where: { refType: refs.refType, refId: { in: refs.refIds } },
      _sum: { amount: true },
    });
    return money(agg._sum.amount?.toString() ?? '0');
  }

  /**
   * Creates missing balance rows, then locks them in supplierId order so two
   * transactions on the same suppliers never deadlock and the second waits.
   */
  private async lock(tx: Tx, supplierIds: string[]): Promise<Map<string, BalanceRow>> {
    const tenantId = tenantContext.requireTenantId();
    const ids = [...new Set(supplierIds)].sort();
    const suppliers = await tx.supplier.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (suppliers.length !== ids.length) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Supplier not found');
    }
    for (const supplierId of ids) {
      await tx.$executeRaw`
        INSERT INTO supplier_balances ("id", "tenantId", "supplierId", "updatedAt")
        VALUES (gen_random_uuid(), ${tenantId}::uuid, ${supplierId}::uuid, CURRENT_TIMESTAMP)
        ON CONFLICT ("supplierId") DO NOTHING`;
    }
    const rows = await tx.$queryRaw<
      { supplierId: string; balance: Prisma.Decimal; hasOpening: boolean }[]
    >`
      SELECT "supplierId", balance, "hasOpening" FROM supplier_balances
      WHERE "tenantId" = ${tenantId}::uuid
        AND "supplierId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "supplierId"
      FOR UPDATE`;
    return new Map(
      rows.map((r) => [
        r.supplierId,
        { balance: money(r.balance.toString()), hasOpening: r.hasOpening },
      ]),
    );
  }
}
