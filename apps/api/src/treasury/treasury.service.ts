import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  type CancelCashTransferInput,
  type CashBalances,
  CashAccountType,
  CashMovementType,
  type CashTransferDto,
  type CreateCashTransferInput,
  DocType,
  ErrorCode,
  money,
  type Money,
  Permission,
  toMoneyString,
  transferLegs,
  type TreasuryReconcileDto,
  type TreasurySummaryDto,
  type TreasurySummaryQuery,
  ZERO,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { CashAccountsService } from './cash-accounts.service';
import { CashLedgerService, fromDay, toDay } from './cash-ledger.service';

const transferInclude = {
  from: { select: { id: true, name: true } },
  to: { select: { id: true, name: true } },
} satisfies Prisma.CashTransferInclude;
type TransferRow = Prisma.CashTransferGetPayload<{ include: typeof transferInclude }>;

const transferDto = (t: TransferRow): CashTransferDto => ({
  id: t.id,
  number: t.number,
  from: t.from,
  to: t.to,
  amount: toMoneyString(t.amount.toString()),
  date: toDay(t.date),
  note: t.note,
  status: t.status,
  cancelReason: t.cancelReason,
  cancelledAt: t.cancelledAt?.toISOString() ?? null,
});

const ALERT_DAYS = 30;

/** Balances, transfers and the reconcile of the cash ledger (phase 34). */
@Injectable()
export class TreasuryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: CashLedgerService,
    private readonly accounts: CashAccountsService,
    private readonly numbering: DocumentNumberingService,
    private readonly audit: AuditService,
    private readonly scopes: ScopeService,
  ) {}

  async summary(query: TreasurySummaryQuery, user: CurrentUserInfo): Promise<TreasurySummaryDto> {
    const tenantId = tenantContext.requireTenantId();
    const date = query.date ?? algiersDay();
    const reached = await this.accounts.list({}, user);
    const ids = reached.map((a) => a.id);
    // Cash in / out follow the document, so a reversal nets against what it reverses, and a
    // transfer, an opening or a comptage is neither.
    const rows = await this.prisma.db.$queryRaw<
      {
        cashAccountId: string;
        balance: Prisma.Decimal | null;
        cashIn: Prisma.Decimal | null;
        cashOut: Prisma.Decimal | null;
      }[]
    >`
      SELECT m."cashAccountId",
        SUM(m.amount) FILTER (WHERE m.date <= ${date}::date) AS balance,
        SUM(m.amount) FILTER (WHERE m.date = ${date}::date AND m."refType" = 'Payment') AS "cashIn",
        -SUM(m.amount) FILTER (WHERE m.date = ${date}::date
          AND m."refType" IN ('SupplierPayment', 'Expense', 'ImportCost')) AS "cashOut"
      FROM cash_movements m JOIN cash_accounts a ON a.id = m."cashAccountId"
      WHERE m."tenantId" = ${tenantId}::uuid AND m."cashAccountId" = ANY(${ids}::uuid[])
        AND (a."openingDate" IS NULL OR m.date >= a."openingDate")
      GROUP BY m."cashAccountId"`;
    const byAccount = new Map(rows.map((r) => [r.cashAccountId, r]));
    const amount = (v: Prisma.Decimal | null | undefined): Money => money(v?.toString() ?? '0');

    let caisses = ZERO;
    let banques = ZERO;
    let cashIn = ZERO;
    let cashOut = ZERO;
    const perWarehouse = new Map<
      string,
      { warehouse: { id: string; name: string } | null; balance: Money }
    >();
    const accounts = reached.map((a) => {
      const row = byAccount.get(a.id);
      const balance = amount(row?.balance);
      if (a.type === CashAccountType.CAISSE) caisses = caisses.plus(balance);
      else banques = banques.plus(balance);
      cashIn = cashIn.plus(amount(row?.cashIn));
      cashOut = cashOut.plus(amount(row?.cashOut));
      const key = a.warehouse?.id ?? '';
      const w = perWarehouse.get(key) ?? { warehouse: a.warehouse, balance: ZERO };
      perWarehouse.set(key, { ...w, balance: w.balance.plus(balance) });
      return {
        account: {
          id: a.id,
          name: a.name,
          type: a.type,
          warehouse: a.warehouse,
          isDefault: a.isDefault,
          openingDate: a.openingDate,
        },
        balance: toMoneyString(balance),
        cashIn: toMoneyString(amount(row?.cashIn)),
        cashOut: toMoneyString(amount(row?.cashOut)),
      };
    });

    const since = new Date(Date.now() - ALERT_DAYS * 86_400_000);
    const alerts = await this.prisma.db.cashCount.findMany({
      where: { alert: true, createdAt: { gte: since }, cashAccountId: { in: ids } },
      include: { account: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      date,
      accounts,
      byWarehouse: [...perWarehouse.values()].map((w) => ({
        warehouse: w.warehouse,
        balance: toMoneyString(w.balance),
      })),
      totals: {
        caisses: toMoneyString(caisses),
        banques: toMoneyString(banques),
        cashIn: toMoneyString(cashIn),
        cashOut: toMoneyString(cashOut),
      },
      alerts: alerts.map((c) => ({
        id: c.id,
        cashAccountId: c.cashAccountId,
        account: c.account,
        counted: toMoneyString(c.counted.toString()),
        expected: toMoneyString(c.expected.toString()),
        ecart: toMoneyString(c.ecart.toString()),
        reason: c.reason,
        alert: c.alert,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Today's balances per business unit: an account with no dépôt counts for the dépôt
   * principal, like any row without a dépôt. Null without TREASURY_VIEW.
   */
  async balancesByUnit(
    user: CurrentUserInfo,
    mainId: string | null,
  ): Promise<Map<string, CashBalances> | null> {
    if (!can(user, Permission.TREASURY_VIEW)) return null;
    const rows = await this.prisma.db.cashAccount.findMany({
      where: { deletedAt: null },
      select: { type: true, warehouseId: true, balance: { select: { balance: true } } },
    });
    const sums = new Map<string, { caisses: Money; banques: Money }>();
    for (const r of rows) {
      const unit = r.warehouseId ?? mainId;
      if (!unit) continue;
      const s = sums.get(unit) ?? { caisses: ZERO, banques: ZERO };
      const value = money(r.balance?.balance.toString() ?? '0');
      if (r.type === CashAccountType.CAISSE) s.caisses = s.caisses.plus(value);
      else s.banques = s.banques.plus(value);
      sums.set(unit, s);
    }
    return new Map(
      [...sums].map(([unit, s]) => [
        unit,
        { caisses: toMoneyString(s.caisses), banques: toMoneyString(s.banques) },
      ]),
    );
  }

  /** En caisse on the dashboard: the accounts of the dépôts the figures cover. */
  async balancesFor(
    user: CurrentUserInfo,
    warehouseIds: string[] | null,
    mainId: string | null,
  ): Promise<CashBalances | null> {
    const units = await this.balancesByUnit(user, mainId);
    if (!units) return null;
    let caisses = ZERO;
    let banques = ZERO;
    for (const [unit, b] of units) {
      if (warehouseIds && !warehouseIds.includes(unit)) continue;
      caisses = caisses.plus(b.caisses);
      banques = banques.plus(b.banques);
    }
    return { caisses: toMoneyString(caisses), banques: toMoneyString(banques) };
  }

  async transfer(input: CreateCashTransferInput, user: CurrentUserInfo): Promise<CashTransferDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      await this.ledger.ensureAccounts(tx);
      await this.ledger.assertPickable(tx, input.fromAccountId, user);
      await this.ledger.assertPickable(tx, input.toAccountId, user);
      // Both balances, by id order: two transfers draining one caisse take turns here.
      const balances = await this.ledger.lock(tx, [input.fromAccountId, input.toAccountId]);
      const available = balances.get(input.fromAccountId)!;
      if (money(input.amount).gt(available)) {
        throw new AppException(ErrorCode.CASH_INSUFFICIENT, 'Not enough money on the account', {
          available: toMoneyString(available),
        });
      }
      const date = algiersDay();
      const number = await this.numbering.next(tx, tenantId, DocType.TRF);
      const transfer = await tx.cashTransfer.create({
        data: {
          tenantId,
          number,
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amount: input.amount,
          date: fromDay(date),
          note: input.note,
          createdBy: user.id,
        },
      });
      const legs = transferLegs(input.amount);
      const leg = { refType: 'CashTransfer', refId: transfer.id, date, note: number };
      await this.ledger.post(tx, [
        {
          ...leg,
          cashAccountId: input.fromAccountId,
          amount: legs.out.toString(),
          type: CashMovementType.TRANSFER_OUT,
        },
        {
          ...leg,
          cashAccountId: input.toAccountId,
          amount: legs.in.toString(),
          type: CashMovementType.TRANSFER_IN,
        },
      ]);
      await this.audit.log(tx, {
        action: 'CASH_TRANSFER_CREATED',
        entity: 'CashTransfer',
        entityId: transfer.id,
        after: { number, ...input },
      });
      return transfer.id;
    });
    return this.getTransfer(id);
  }

  /** Input mistake: both legs are reversed. Never deleted. */
  async cancelTransfer(
    id: string,
    input: CancelCashTransferInput,
    user: CurrentUserInfo,
  ): Promise<CashTransferDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const t = await this.lockTransfer(tx, id);
      await this.ledger.assertPickable(tx, t.fromAccountId, user);
      await this.ledger.assertPickable(tx, t.toAccountId, user);
      if (t.status !== 'VALID') {
        throw new AppException(ErrorCode.CASH_TRANSFER_NOT_VALID, 'Already cancelled');
      }
      await tx.cashTransfer.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelReason: input.reason,
          cancelledBy: user.id,
          cancelledAt: new Date(),
        },
      });
      await this.ledger.reverse(tx, {
        refType: 'CashTransfer',
        refId: id,
        note: input.reason,
      });
      await this.audit.log(tx, {
        action: 'CASH_TRANSFER_CANCELLED',
        entity: 'CashTransfer',
        entityId: id,
        before: { status: t.status },
        after: { reason: input.reason },
      });
    });
    return this.getTransfer(id);
  }

  /** Cached balances against the ledger, for one company (the nightly job covers them all). */
  async reconcile(): Promise<TreasuryReconcileDto> {
    const tenantId = tenantContext.requireTenantId();
    const rows = await this.prisma.db.$queryRaw<
      { id: string; name: string; cached: Prisma.Decimal; ledger: Prisma.Decimal }[]
    >`
      SELECT a.id, a.name, b.balance AS cached,
        COALESCE(SUM(m.amount) FILTER (
          WHERE a."openingDate" IS NULL OR m.date >= a."openingDate"), 0) AS ledger
      FROM cash_accounts a
      JOIN cash_account_balances b ON b."cashAccountId" = a.id
      LEFT JOIN cash_movements m ON m."cashAccountId" = a.id
      WHERE a."tenantId" = ${tenantId}::uuid
      GROUP BY a.id, a.name, b.balance
      HAVING b.balance <> COALESCE(SUM(m.amount) FILTER (
        WHERE a."openingDate" IS NULL OR m.date >= a."openingDate"), 0)`;
    return {
      ok: rows.length === 0,
      differences: rows.map((r) => ({
        account: { id: r.id, name: r.name },
        cached: toMoneyString(r.cached.toString()),
        ledger: toMoneyString(r.ledger.toString()),
      })),
    };
  }

  private async getTransfer(id: string): Promise<CashTransferDto> {
    const t = await this.prisma.db.cashTransfer.findFirst({
      where: { id },
      include: transferInclude,
    });
    if (!t) throw new AppException(ErrorCode.NOT_FOUND, 'Transfer not found');
    return transferDto(t);
  }

  private async lockTransfer(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM cash_transfers
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      FOR UPDATE`;
    if (rows.length === 0) throw new AppException(ErrorCode.NOT_FOUND, 'Transfer not found');
    return tx.cashTransfer.findUniqueOrThrow({ where: { id } });
  }
}
