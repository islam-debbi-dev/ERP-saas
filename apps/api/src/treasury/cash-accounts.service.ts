import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  type CashAccountDto,
  type CashAccountListQuery,
  CashAccountType,
  type CashCountDto,
  type CashCountInput,
  CashMovementType,
  type CashMovementDto,
  type CashMovementListQuery,
  type CashMovementPage,
  type CashOpeningInput,
  countEcart,
  countNeedsAlert,
  type CreateCashAccountInput,
  ErrorCode,
  Feature,
  Permission,
  toMoneyString,
  type UpdateCashAccountInput,
  WarehouseType,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { FeaturesService } from '../billing/features.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { CashLedgerService, toDay } from './cash-ledger.service';

const accountInclude = {
  warehouse: { select: { id: true, name: true } },
  balance: { select: { balance: true } },
} satisfies Prisma.CashAccountInclude;
type AccountRow = Prisma.CashAccountGetPayload<{ include: typeof accountInclude }>;

function toDto(a: AccountRow, seesBalance: boolean): CashAccountDto {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    warehouse: a.warehouse,
    bankName: a.bankName,
    rib: a.rib,
    isDefault: a.isDefault,
    currency: a.currency,
    openingDate: a.openingDate ? toDay(a.openingDate) : null,
    balance: seesBalance ? toMoneyString(a.balance?.balance.toString() ?? '0') : null,
    archivedAt: a.deletedAt?.toISOString() ?? null,
    version: a.version,
  };
}

/** Ledger order: the opening first on its day, then as entered. */
interface MovementRow {
  id: string;
  type: CashMovementType;
  amount: Prisma.Decimal;
  date: Date;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
  ord: number;
  counted: boolean;
  running: Prisma.Decimal | null;
}

const encodeCursor = (m: MovementRow): string =>
  `${toDay(m.date)}|${m.ord}|${m.createdAt.toISOString()}|${m.id}`;

function decodeCursor(cursor: string): [string, number, Date, string] {
  const [day, ord, at, id] = cursor.split('|');
  const when = new Date(at ?? '');
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !id || Number.isNaN(when.getTime())) {
    throw new AppException(ErrorCode.VALIDATION_FAILED, 'Bad cursor', { field: 'cursor' });
  }
  return [day, Number(ord), when, id];
}

/** Caisses and bank accounts (phase 34): master data, solde initial, comptage, movements. */
@Injectable()
export class CashAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: CashLedgerService,
    private readonly audit: AuditService,
    private readonly features: FeaturesService,
  ) {}

  async list(query: CashAccountListQuery, user: CurrentUserInfo): Promise<CashAccountDto[]> {
    await this.prisma.db.$transaction((tx) => this.ledger.ensureAccounts(tx));
    const seesBalance = can(user, Permission.TREASURY_VIEW);
    const rows = await this.prisma.db.cashAccount.findMany({
      where: { deletedAt: query.archived ? { not: null } : null },
      include: accountInclude,
      orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    });
    // Without TREASURY_VIEW a user only ever picks: he gets what he may put money in.
    const level = query.pick || !seesBalance ? 'operate' : 'view';
    const reached = await this.prisma.db.$transaction(async (tx) => {
      const out: AccountRow[] = [];
      for (const r of rows) if (await this.ledger.inReach(tx, r, user, level)) out.push(r);
      return out;
    });
    return reached.map((r) => toDto(r, seesBalance));
  }

  async get(id: string, user: CurrentUserInfo): Promise<CashAccountDto> {
    const row = await this.prisma.db.cashAccount.findFirst({
      where: { id },
      include: accountInclude,
    });
    const reached =
      row &&
      (await this.prisma.db.$transaction((tx) => this.ledger.inReach(tx, row, user, 'view')));
    if (!row || !reached) {
      throw new AppException(ErrorCode.CASH_ACCOUNT_NOT_FOUND, 'Cash account not found');
    }
    return toDto(row, can(user, Permission.TREASURY_VIEW));
  }

  async create(input: CreateCashAccountInput, user: CurrentUserInfo): Promise<CashAccountDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      await this.ledger.ensureAccounts(tx);
      await this.assertDepot(tx, input, tenantId);
      await this.assertNameFree(tx, input.name, null);
      if (input.isDefault) await this.clearDefault(tx, input.type, input.warehouseId);
      const account = await tx.cashAccount.create({
        data: { tenantId, ...input, createdBy: user.id },
      });
      await tx.cashAccountBalance.create({ data: { tenantId, cashAccountId: account.id } });
      await this.audit.log(tx, {
        action: 'CASH_ACCOUNT_CREATED',
        entity: 'CashAccount',
        entityId: account.id,
        after: { ...input },
      });
      return account.id;
    });
    return this.get(id, user);
  }

  async update(
    id: string,
    input: UpdateCashAccountInput,
    user: CurrentUserInfo,
  ): Promise<CashAccountDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.lockLive(tx, id);
      if (before.version !== input.version) {
        throw new AppException(
          ErrorCode.CASH_ACCOUNT_MODIFIED,
          'Account changed since it was read',
        );
      }
      await this.assertNameFree(tx, input.name, id);
      if (input.isDefault && !before.isDefault) {
        await this.clearDefault(tx, before.type, before.warehouseId);
      }
      if (!input.isDefault && before.isDefault) await this.assertNotLastDefault(tx, before);
      const { version: _version, ...fields } = input;
      await tx.cashAccount.update({
        where: { id },
        data: { ...fields, version: { increment: 1 } },
      });
      await this.audit.log(tx, {
        action: 'CASH_ACCOUNT_UPDATED',
        entity: 'CashAccount',
        entityId: id,
        before: { name: before.name, isDefault: before.isDefault },
        after: { ...fields },
      });
    });
    return this.get(id, user);
  }

  /** Master data: archived, never deleted, and only once it is empty. */
  async archive(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const account = await this.lockLive(tx, id);
      const balance = (await this.ledger.lock(tx, [id])).get(id)!;
      if (!balance.isZero()) {
        throw new AppException(ErrorCode.CASH_ACCOUNT_NOT_EMPTY, 'The balance is not zero', {
          balance: toMoneyString(balance),
        });
      }
      if (account.isDefault) await this.assertNotLastDefault(tx, account);
      await tx.cashAccount.update({
        where: { id },
        data: { deletedAt: new Date(), isDefault: false, version: { increment: 1 } },
      });
      await this.audit.log(tx, {
        action: 'CASH_ACCOUNT_ARCHIVED',
        entity: 'CashAccount',
        entityId: id,
        before: { name: account.name },
      });
    });
  }

  async opening(
    id: string,
    input: CashOpeningInput,
    user: CurrentUserInfo,
  ): Promise<CashAccountDto> {
    if (input.date > algiersDay()) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'The opening cannot be in the future', {
        field: 'date',
      });
    }
    await this.prisma.db.$transaction(async (tx) => {
      await this.lockLive(tx, id);
      const balance = await this.ledger.open(tx, { cashAccountId: id, ...input });
      await this.audit.log(tx, {
        action: 'CASH_OPENING_SET',
        entity: 'CashAccount',
        entityId: id,
        after: { amount: input.amount, date: input.date, balance: toMoneyString(balance) },
      });
    });
    return this.get(id, user);
  }

  /** Comptage de caisse: the écart against the balance becomes a COUNT_ADJUST. */
  async count(id: string, input: CashCountInput, user: CurrentUserInfo): Promise<CashCountDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      const account = await this.lockLive(tx, id);
      if (!(await this.ledger.inReach(tx, account, user, 'operate'))) {
        throw new AppException(ErrorCode.CASH_ACCOUNT_NOT_FOUND, 'Cash account not found');
      }
      if (account.type !== CashAccountType.CAISSE) {
        throw new AppException(ErrorCode.CASH_ACCOUNT_NOT_CAISSE, 'Only a caisse is counted');
      }
      // Locked from here on: nothing moves between reading the balance and adjusting it.
      const expected = (await this.ledger.lock(tx, [id])).get(id)!;
      const ecart = countEcart(input.counted, expected);
      if (!ecart.isZero() && !input.reason) {
        throw new AppException(
          ErrorCode.VALIDATION_FAILED,
          'A count with an écart needs a reason',
          {
            field: 'reason',
            ecart: toMoneyString(ecart),
          },
        );
      }
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { cashCountAlertThreshold: true },
      });
      const alert = countNeedsAlert(ecart, tenant.cashCountAlertThreshold.toString());
      const row = await tx.cashCount.create({
        data: {
          tenantId,
          cashAccountId: id,
          counted: input.counted,
          expected: expected.toString(),
          ecart: ecart.toString(),
          reason: input.reason,
          alert,
          createdBy: user.id,
        },
      });
      if (!ecart.isZero()) {
        await this.ledger.post(tx, [
          {
            cashAccountId: id,
            amount: ecart.toString(),
            type: CashMovementType.COUNT_ADJUST,
            refType: 'CashCount',
            refId: row.id,
            date: algiersDay(),
            note: input.reason,
          },
        ]);
      }
      await this.audit.log(tx, {
        action: 'CASH_COUNTED',
        entity: 'CashAccount',
        entityId: id,
        before: { balance: toMoneyString(expected) },
        after: {
          counted: input.counted,
          ecart: toMoneyString(ecart),
          reason: input.reason,
          alert,
        },
      });
      return {
        id: row.id,
        cashAccountId: id,
        counted: toMoneyString(input.counted),
        expected: toMoneyString(expected),
        ecart: toMoneyString(ecart),
        reason: row.reason,
        alert,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  /** Newest first, with the balance after each movement. */
  async movements(
    id: string,
    query: CashMovementListQuery,
    user: CurrentUserInfo,
  ): Promise<CashMovementPage> {
    await this.get(id, user);
    const tenantId = tenantContext.requireTenantId();
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    // The window runs over the whole ledger of the account: a page never restarts the balance.
    const rows = await this.prisma.db.$queryRaw<MovementRow[]>`
      WITH ledger AS (
        SELECT m.id, m.type, m.amount, m.date, m."refType", m."refId", m.note, m."createdBy",
               m."createdAt", CASE WHEN m.type = 'OPENING' THEN 0 ELSE 1 END AS ord,
               (a."openingDate" IS NULL OR m.date >= a."openingDate") AS counted
        FROM cash_movements m JOIN cash_accounts a ON a.id = m."cashAccountId"
        WHERE m."tenantId" = ${tenantId}::uuid AND m."cashAccountId" = ${id}::uuid
      ), running AS (
        SELECT l.*, SUM(CASE WHEN l.counted THEN l.amount ELSE 0 END) OVER (
          ORDER BY l.date, l.ord, l."createdAt", l.id) AS running
        FROM ledger l
      )
      SELECT * FROM running r
      WHERE TRUE
        ${query.from ? Prisma.sql`AND r.date >= ${query.from}::date` : Prisma.empty}
        ${query.to ? Prisma.sql`AND r.date <= ${query.to}::date` : Prisma.empty}
        ${
          after
            ? Prisma.sql`AND (r.date, r.ord, r."createdAt", r.id) <
                (${after[0]}::date, ${after[1]}::int, ${after[2]}::timestamptz, ${after[3]}::uuid)`
            : Prisma.empty
        }
      ORDER BY r.date DESC, r.ord DESC, r."createdAt" DESC, r.id DESC
      LIMIT ${query.limit + 1}`;
    const page = rows.slice(0, query.limit);
    const hidden = await this.hiddenSalaries(page, user);
    const userIds = [...new Set(page.flatMap((m) => (m.createdBy ? [m.createdBy] : [])))];
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const names = new Map(users.map((u) => [u.id, u]));
    const items: CashMovementDto[] = page.map((m) => {
      const secret = m.refId !== null && hidden.has(m.refId);
      return {
        id: m.id,
        type: m.type,
        amount: toMoneyString(m.amount.toString()),
        date: toDay(m.date),
        refType: secret ? null : m.refType,
        refId: secret ? null : m.refId,
        note: secret ? null : m.note,
        counted: m.counted,
        runningBalance: m.counted ? toMoneyString(m.running?.toString() ?? '0') : null,
        createdBy: m.createdBy ? (names.get(m.createdBy) ?? null) : null,
        createdAt: m.createdAt.toISOString(),
      };
    });
    const last = page[page.length - 1];
    return { items, nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null };
  }

  /**
   * An avance or a salary is hidden without SALARY_VIEW (phase 31). Its amount stays in the
   * list, or the running balance would not add up, but not who was paid nor its document.
   */
  private async hiddenSalaries(rows: MovementRow[], user: CurrentUserInfo): Promise<Set<string>> {
    if (can(user, Permission.SALARY_VIEW)) return new Set();
    const ids = rows.flatMap((m) => (m.refType === 'Expense' && m.refId ? [m.refId] : []));
    if (ids.length === 0) return new Set();
    const found = await this.prisma.db.expense.findMany({
      where: { id: { in: ids }, employeeId: { not: null } },
      select: { id: true },
    });
    return new Set(found.map((e) => e.id));
  }

  private async lockLive(tx: Tx, id: string) {
    const tenantId = tenantContext.requireTenantId();
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM cash_accounts
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL
      FOR UPDATE`;
    if (rows.length === 0) {
      throw new AppException(ErrorCode.CASH_ACCOUNT_NOT_FOUND, 'Cash account not found');
    }
    return tx.cashAccount.findUniqueOrThrow({ where: { id } });
  }

  /** A caisse needs a dépôt with MULTI_UNIT, and no account sits on a truck. */
  private async assertDepot(
    tx: Tx,
    input: Pick<CreateCashAccountInput, 'type' | 'warehouseId'>,
    tenantId: string,
  ): Promise<void> {
    if (input.warehouseId) {
      const w = await tx.warehouse.findFirst({
        where: { id: input.warehouseId, deletedAt: null, type: { not: WarehouseType.VEHICLE } },
        select: { id: true },
      });
      if (!w) throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Warehouse not found');
      return;
    }
    if (input.type !== CashAccountType.CAISSE) return;
    const { features } = await this.features.of(tenantId);
    if (features.includes(Feature.MULTI_UNIT)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'A caisse needs a dépôt', {
        field: 'warehouseId',
      });
    }
  }

  private async assertNameFree(tx: Tx, name: string, self: string | null): Promise<void> {
    const taken = await tx.cashAccount.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        deletedAt: null,
        ...(self ? { id: { not: self } } : {}),
      },
      select: { id: true },
    });
    if (taken) throw new AppException(ErrorCode.CASH_ACCOUNT_NAME_TAKEN, 'Name already used');
  }

  private clearDefault(tx: Tx, type: CashAccountType, warehouseId: string | null) {
    return tx.cashAccount.updateMany({
      where: { type, warehouseId, isDefault: true, deletedAt: null },
      data: { isDefault: false, version: { increment: 1 } },
    });
  }

  /** The money always needs somewhere to go: a type keeps at least one default. */
  private async assertNotLastDefault(
    tx: Tx,
    account: { id: string; type: CashAccountType },
  ): Promise<void> {
    if (account.type === CashAccountType.CCP) return;
    const others = await tx.cashAccount.count({
      where: { type: account.type, isDefault: true, deletedAt: null, id: { not: account.id } },
    });
    if (others === 0) {
      throw new AppException(ErrorCode.CASH_ACCOUNT_IS_DEFAULT, 'Choose another default first');
    }
  }
}
