import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  CashMovementType,
  countsInBalance,
  defaultCashAccount,
  ErrorCode,
  money,
  type Money,
  type PaymentMode,
  Permission,
  WarehouseType,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { WarehousesService } from '../stock/warehouses.service';

export interface CashEntry {
  cashAccountId: string;
  /** Signed, in DZD: + in, - out. */
  amount: string;
  type: CashMovementType;
  refType: string;
  refId: string;
  /** The Algiers day the money moved. */
  date: string;
  note?: string | null;
}

/** `@db.Date` columns: midnight UTC of the Algiers day. */
export const toDay = (d: Date): string => d.toISOString().slice(0, 10);
export const fromDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/**
 * The only writer of cash_movements and cash_account_balances (phase 34), the twin of
 * ClientAccountService. Money rows call `resolve` and `post` inside their own transaction.
 *
 * Lock order: **the cash balance comes last**, after stock, payment rows, client, supplier
 * and employee balances, so a caisse every sale of a dépôt goes through is held for as short
 * a time as possible and never waits on anything else. Several accounts lock by id order.
 */
@Injectable()
export class CashLedgerService {
  constructor(
    private readonly scope: ScopeService,
    private readonly warehouses: WarehousesService,
  ) {}

  /**
   * First use: one caisse principale on the dépôt principal and one banque principale.
   * ON CONFLICT: two first uses at once, the second waits and adds nothing.
   */
  async ensureAccounts(tx: Tx): Promise<void> {
    const tenantId = tenantContext.requireTenantId();
    if (await tx.cashAccount.findFirst({ select: { id: true } })) return;
    const mainId = await this.warehouses.defaultId(tx);
    await tx.$executeRaw`
      INSERT INTO cash_accounts ("id", "tenantId", "name", "type", "warehouseId", "isDefault", "updatedAt")
      VALUES
        (gen_random_uuid(), ${tenantId}::uuid, 'Caisse principale', 'CAISSE', ${mainId}::uuid, true, CURRENT_TIMESTAMP),
        (gen_random_uuid(), ${tenantId}::uuid, 'Banque principale', 'BANQUE', NULL, true, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING`;
    await tx.$executeRaw`
      INSERT INTO cash_account_balances ("id", "tenantId", "cashAccountId", "updatedAt")
      SELECT gen_random_uuid(), a."tenantId", a.id, CURRENT_TIMESTAMP
      FROM cash_accounts a WHERE a."tenantId" = ${tenantId}::uuid
      ON CONFLICT DO NOTHING`;
  }

  /**
   * The account of a money row. One asked for must be live and in the user's reach (OPERATE);
   * otherwise the default for the mode, which is the company's choice and is never refused.
   */
  async resolve(
    tx: Tx,
    row: { requested?: string | null; mode: PaymentMode; warehouseId: string | null },
    user: CurrentUserInfo,
  ): Promise<string> {
    if (row.requested) {
      await this.assertPickable(tx, row.requested, user);
      return row.requested;
    }
    return this.defaultFor(tx, row);
  }

  /** The default account, without a user: the backfill goes through here too. */
  async defaultFor(
    tx: Tx,
    row: { mode: PaymentMode; warehouseId: string | null },
  ): Promise<string> {
    await this.ensureAccounts(tx);
    const accounts = await tx.cashAccount.findMany({
      where: { deletedAt: null, isDefault: true },
      select: { id: true, type: true, warehouseId: true, isDefault: true },
      orderBy: { createdAt: 'asc' },
    });
    const found = defaultCashAccount(accounts, {
      mode: row.mode,
      warehouseId: await this.unitOf(tx, row.warehouseId),
      mainWarehouseId: await this.warehouses.defaultId(tx),
    });
    if (!found) throw new AppException(ErrorCode.CASH_ACCOUNT_NOT_FOUND, 'No default account');
    return found.id;
  }

  /** A truck has no caisse of its own: its money belongs to its dépôt. */
  private async unitOf(tx: Tx, warehouseId: string | null): Promise<string | null> {
    if (!warehouseId) return null;
    const w = await tx.warehouse.findFirst({
      where: { id: warehouseId },
      select: { type: true, parentWarehouseId: true },
    });
    return w?.type === WarehouseType.VEHICLE ? w.parentWarehouseId : warehouseId;
  }

  async assertPickable(tx: Tx, id: string, user: CurrentUserInfo): Promise<void> {
    const account = await tx.cashAccount.findFirst({
      where: { id, deletedAt: null },
      select: { warehouseId: true },
    });
    if (!account || !(await this.inReach(tx, account, user, 'operate'))) {
      throw new AppException(ErrorCode.CASH_ACCOUNT_NOT_FOUND, 'Cash account not found');
    }
  }

  /**
   * Phase 24 scope: an account on a dépôt is reached like the dépôt (OPERATE to use it, the
   * figures reach to look at it); an account with no dépôt is for managers only.
   */
  async inReach(
    db: Tx,
    account: { warehouseId: string | null },
    user: CurrentUserInfo,
    level: 'operate' | 'view',
  ): Promise<boolean> {
    if (!account.warehouseId) return can(user, Permission.TREASURY_VIEW);
    const units = await this.scope.warehouses(user, db);
    const ids = level === 'operate' ? units.warehouseIds : units.statsWarehouseIds;
    return ids === null || ids.includes(account.warehouseId);
  }

  /** Writes the movements and updates the balances, in one go. */
  async post(tx: Tx, entries: CashEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const tenantId = tenantContext.requireTenantId();
    const userId = tenantContext.get()?.userId ?? null;
    const balances = await this.lock(
      tx,
      entries.map((e) => e.cashAccountId),
    );
    const openings = await this.openings(tx, [...balances.keys()]);
    for (const e of entries) {
      const amount = money(e.amount);
      if (amount.isZero()) throw new Error('A cash movement cannot be zero');
      await tx.cashMovement.create({
        data: {
          tenantId,
          cashAccountId: e.cashAccountId,
          amount: amount.toString(),
          type: e.type,
          refType: e.refType,
          refId: e.refId,
          date: fromDay(e.date),
          note: e.note?.slice(0, 255) ?? null,
          createdBy: userId,
        },
      });
      if (countsInBalance(e.date, openings.get(e.cashAccountId) ?? null)) {
        balances.set(e.cashAccountId, balances.get(e.cashAccountId)!.plus(amount));
      }
    }
    await this.save(tx, balances);
  }

  /**
   * Takes back what a document left on its accounts: nothing for a row older than the ledger
   * (cancelled before the backfill). Dated today, except an input mistake on a row dated before
   * the opening: that row never counted, so neither does its reversal, or cancelling it would
   * add money the owner did not count. A bounce (`realEvent`) really takes the money back
   * today, whenever the cheque came in.
   */
  async reverse(
    tx: Tx,
    ref: { refType: string; refId: string; note?: string | null; realEvent?: boolean },
  ): Promise<void> {
    const rows = await tx.cashMovement.findMany({
      where: { refType: ref.refType, refId: ref.refId },
      select: { cashAccountId: true, amount: true, date: true },
      orderBy: { date: 'asc' },
    });
    const byAccount = new Map<string, { net: Money; date: string }>();
    for (const r of rows) {
      const a = byAccount.get(r.cashAccountId) ?? { net: money(0), date: toDay(r.date) };
      byAccount.set(r.cashAccountId, { ...a, net: a.net.plus(r.amount.toString()) });
    }
    const live = [...byAccount].filter(([, a]) => !a.net.isZero());
    if (live.length === 0) return;
    const openings = await this.openings(
      tx,
      live.map(([id]) => id),
    );
    const today = algiersDay();
    await this.post(
      tx,
      live.map(([cashAccountId, a]) => ({
        cashAccountId,
        amount: a.net.negated().toString(),
        type: CashMovementType.REVERSAL,
        refType: ref.refType,
        refId: ref.refId,
        date:
          ref.realEvent || countsInBalance(a.date, openings.get(cashAccountId) ?? null)
            ? today
            : a.date,
        note: ref.note ?? null,
      })),
    );
  }

  /**
   * The solde initial: one per account. From now on the opening carries the result of
   * everything dated before it, so the balance is recomputed from the ledger.
   */
  async open(
    tx: Tx,
    input: { cashAccountId: string; amount: string; date: string; note?: string | null },
  ): Promise<Money> {
    const tenantId = tenantContext.requireTenantId();
    await this.lock(tx, [input.cashAccountId]);
    const account = await tx.cashAccount.findUniqueOrThrow({
      where: { id: input.cashAccountId },
      select: { openingDate: true },
    });
    if (account.openingDate) {
      throw new AppException(ErrorCode.CASH_OPENING_ALREADY_SET, 'Opening balance already set', {
        openingDate: toDay(account.openingDate),
      });
    }
    await tx.cashMovement.create({
      data: {
        tenantId,
        cashAccountId: input.cashAccountId,
        amount: input.amount,
        type: CashMovementType.OPENING,
        date: fromDay(input.date),
        note: input.note ?? null,
        createdBy: tenantContext.get()?.userId ?? null,
      },
    });
    await tx.cashAccount.update({
      where: { id: input.cashAccountId },
      data: { openingDate: fromDay(input.date), version: { increment: 1 } },
    });
    const total = await tx.cashMovement.aggregate({
      where: { cashAccountId: input.cashAccountId, date: { gte: fromDay(input.date) } },
      _sum: { amount: true },
    });
    const balance = money(total._sum.amount?.toString() ?? '0');
    await this.save(tx, new Map([[input.cashAccountId, balance]]));
    return balance;
  }

  /** Locks the balance rows by account id, so two transfers never deadlock. */
  async lock(tx: Tx, accountIds: string[]): Promise<Map<string, Money>> {
    const tenantId = tenantContext.requireTenantId();
    const ids = [...new Set(accountIds)].sort();
    const rows = await tx.$queryRaw<{ cashAccountId: string; balance: Prisma.Decimal }[]>`
      SELECT "cashAccountId", balance FROM cash_account_balances
      WHERE "tenantId" = ${tenantId}::uuid AND "cashAccountId" = ANY(${ids}::uuid[])
      ORDER BY "cashAccountId"
      FOR UPDATE`;
    if (rows.length !== ids.length) {
      throw new AppException(ErrorCode.CASH_ACCOUNT_NOT_FOUND, 'Cash account not found');
    }
    return new Map(rows.map((r) => [r.cashAccountId, money(r.balance.toString())]));
  }

  /** Call with the balances locked: an opening cannot move under a movement being posted. */
  private async openings(tx: Tx, ids: string[]): Promise<Map<string, string | null>> {
    const accounts = await tx.cashAccount.findMany({
      where: { id: { in: ids } },
      select: { id: true, openingDate: true },
    });
    return new Map(accounts.map((a) => [a.id, a.openingDate ? toDay(a.openingDate) : null]));
  }

  private async save(tx: Tx, balances: Map<string, Money>): Promise<void> {
    for (const [cashAccountId, balance] of balances) {
      await tx.cashAccountBalance.update({
        where: { cashAccountId },
        data: { balance: balance.toString() },
      });
    }
  }
}
