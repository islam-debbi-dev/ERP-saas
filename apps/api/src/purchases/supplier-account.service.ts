import { Injectable } from '@nestjs/common';
import { ErrorCode, money, type Money, type SupplierLedgerType, toMoneyString } from '@erp/shared';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { type Tx } from '../prisma/prisma.service';

export interface SupplierEntryInput {
  supplierId: string;
  type: SupplierLedgerType;
  /** Signed, in DZD: + we owe the supplier more, - we owe less. */
  amount: string;
  /**
   * Phase 22: the same amount in the supplier's foreign currency (signed like `amount`).
   * Required for a foreign supplier, refused for a DZD one: the two balances never drift.
   */
  amountCurrency?: string | null;
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
  balanceCurrency: Money;
  currency: string;
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
      const foreign = row.currency !== 'DZD';
      if (foreign !== (e.amountCurrency !== undefined && e.amountCurrency !== null)) {
        // A programming error, not a user one: callers convert before posting.
        throw new Error(`supplier ${e.supplierId} (${row.currency}): amountCurrency mismatch`);
      }
      const amountCurrency = foreign ? money(e.amountCurrency ?? '0') : null;
      row.balance = row.balance.plus(amount);
      if (amountCurrency) row.balanceCurrency = row.balanceCurrency.plus(amountCurrency);
      await tx.supplierLedgerEntry.create({
        data: {
          tenantId,
          supplierId: e.supplierId,
          type: e.type,
          amount: amount.toString(),
          currency: row.currency,
          amountCurrency: amountCurrency?.toString() ?? null,
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
        data: {
          balance: row.balance.toString(),
          balanceCurrency: row.balanceCurrency.toString(),
          hasOpening: row.hasOpening,
        },
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
    return (await this.netWithCurrency(tx, refs)).amount;
  }

  /** `netOf` plus the same in the supplier's currency (phase 22, foreign suppliers). */
  async netWithCurrency(
    tx: Tx,
    refs: { refType: string; refIds: string[] },
  ): Promise<{ amount: Money; amountCurrency: Money }> {
    if (refs.refIds.length === 0) return { amount: money(0), amountCurrency: money(0) };
    const agg = await tx.supplierLedgerEntry.aggregate({
      where: { refType: refs.refType, refId: { in: refs.refIds } },
      _sum: { amount: true, amountCurrency: true },
    });
    return {
      amount: money(agg._sum.amount?.toString() ?? '0'),
      amountCurrency: money(agg._sum.amountCurrency?.toString() ?? '0'),
    };
  }

  /** The supplier's currency ('DZD' unless set for an importer, phase 22). */
  async currencyOf(tx: Tx, supplierId: string): Promise<string> {
    const s = await tx.supplier.findUnique({
      where: { id: supplierId },
      select: { currency: true },
    });
    if (!s) throw new AppException(ErrorCode.NOT_FOUND, 'Supplier not found');
    return s.currency;
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
      select: { id: true, currency: true },
    });
    const currencyById = new Map(suppliers.map((s) => [s.id, s.currency]));
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
      {
        supplierId: string;
        balance: Prisma.Decimal;
        balanceCurrency: Prisma.Decimal;
        hasOpening: boolean;
      }[]
    >`
      SELECT "supplierId", balance, "balanceCurrency", "hasOpening" FROM supplier_balances
      WHERE "tenantId" = ${tenantId}::uuid
        AND "supplierId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "supplierId"
      FOR UPDATE`;
    return new Map(
      rows.map((r) => [
        r.supplierId,
        {
          balance: money(r.balance.toString()),
          balanceCurrency: money(r.balanceCurrency.toString()),
          currency: currencyById.get(r.supplierId) ?? 'DZD',
          hasOpening: r.hasOpening,
        },
      ]),
    );
  }
}
