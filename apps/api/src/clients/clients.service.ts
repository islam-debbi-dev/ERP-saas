import { Injectable } from '@nestjs/common';
import {
  type ClientAdjustmentInput,
  type ClientDto,
  type ClientListQuery,
  type ClientPage,
  type ClientReconcileReport,
  type ClientStatementDto,
  type CreateClientInput,
  type DebtorDto,
  ErrorCode,
  money,
  type OpeningBalanceInput,
  Role,
  type StatementQuery,
  toMoneyString,
  type UpdateClientInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ClientAccountService } from './client-account.service';

const clientInclude = { balance: true } satisfies Prisma.ClientInclude;
type ClientWithBalance = Prisma.ClientGetPayload<{ include: typeof clientInclude }>;

/** Only managers decide how much credit a client gets. */
const PLAFOND_ROLES = new Set<string>([Role.OWNER, Role.MANAGER]);

function toDto(c: ClientWithBalance): ClientDto {
  const balance = c.balance?.balance.toString() ?? '0';
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    type: c.type,
    phone: c.phone,
    phone2: c.phone2,
    address: c.address,
    wilaya: c.wilaya,
    commune: c.commune,
    rc: c.rc,
    nif: c.nif,
    nis: c.nis,
    ai: c.ai,
    priceLevelId: c.priceLevelId,
    creditLimit: c.creditLimit ? toMoneyString(c.creditLimit.toString()) : null,
    notes: c.notes,
    active: c.active,
    version: c.version,
    archivedAt: c.deletedAt?.toISOString() ?? null,
    balance: toMoneyString(balance),
    hasOpening: c.balance?.hasOpening ?? false,
    overLimit: c.creditLimit !== null && money(balance).gt(c.creditLimit.toString()),
  };
}

/** Algiers has no DST: midnight there is 23:00 UTC the day before. */
function algiersDayStart(date: string): Prisma.Sql {
  return Prisma.sql`((${date}::date)::timestamp AT TIME ZONE 'Africa/Algiers')`;
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly account: ClientAccountService,
    private readonly audit: AuditService,
  ) {}

  /** Raw SQL picks the page (filters compare balance with plafond); Prisma loads the rows. */
  async list(query: ClientListQuery): Promise<ClientPage> {
    const tenantId = tenantContext.requireTenantId();
    const filters: Prisma.Sql[] = [
      Prisma.sql`c."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`c."deletedAt" IS NULL`,
    ];
    const search = query.search?.trim();
    if (search) {
      const like = `%${search.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
      filters.push(
        Prisma.sql`(c.code ILIKE ${like} OR c.name ILIKE ${like} OR c.phone ILIKE ${like} OR c.phone2 ILIKE ${like})`,
      );
    }
    if (query.hasDebt) filters.push(Prisma.sql`COALESCE(b.balance, 0) > 0`);
    if (query.overLimit)
      filters.push(
        Prisma.sql`c."creditLimit" IS NOT NULL AND COALESCE(b.balance, 0) > c."creditLimit"`,
      );
    const cursor = query.cursor
      ? Prisma.sql`AND (c.name, c.id) > (SELECT x.name, x.id FROM clients x WHERE x.id = ${query.cursor}::uuid AND x."tenantId" = ${tenantId}::uuid)`
      : Prisma.empty;
    const ids = await this.prisma.db.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
      WHERE ${Prisma.join(filters, ' AND ')} ${cursor}
      ORDER BY c.name, c.id
      LIMIT ${query.limit + 1}`;
    const pageIds = ids.slice(0, query.limit).map((r) => r.id);
    const rows = await this.prisma.db.client.findMany({
      where: { id: { in: pageIds } },
      include: clientInclude,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      items: pageIds.flatMap((id) => {
        const c = byId.get(id);
        return c ? [toDto(c)] : [];
      }),
      nextCursor: ids.length > query.limit ? (pageIds.at(-1) ?? null) : null,
    };
  }

  async get(id: string): Promise<ClientDto> {
    const c = await this.prisma.db.client.findUnique({ where: { id }, include: clientInclude });
    if (!c) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
    return toDto(c);
  }

  async create(input: CreateClientInput, user: CurrentUserInfo): Promise<ClientDto> {
    if (input.creditLimit !== null && !PLAFOND_ROLES.has(user.role)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Only a manager can set a credit limit', {
        field: 'creditLimit',
      });
    }
    return this.withCodeErrors(() =>
      this.prisma.db.$transaction(async (tx) => {
        await this.checkPriceLevel(tx, input.priceLevelId);
        const c = await tx.client.create({
          data: { ...input, tenantId: tenantContext.requireTenantId() },
          include: clientInclude,
        });
        await this.audit.log(tx, {
          action: 'CLIENT_CREATED',
          entity: 'Client',
          entityId: c.id,
          after: c,
        });
        return toDto(c);
      }),
    );
  }

  /** Compare-and-swap on `version`: two people editing the same client cannot overwrite each other. */
  async update(id: string, input: UpdateClientInput, user: CurrentUserInfo): Promise<ClientDto> {
    return this.withCodeErrors(() =>
      this.prisma.db.$transaction(async (tx) => {
        const before = await tx.client.findFirst({ where: { id, deletedAt: null } });
        if (!before) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
        const limitChanged =
          (before.creditLimit?.toString() ?? null) !==
          (input.creditLimit === null ? null : money(input.creditLimit).toString());
        if (limitChanged && !PLAFOND_ROLES.has(user.role)) {
          throw new AppException(
            ErrorCode.FORBIDDEN,
            'Only a manager can change the credit limit',
            {
              field: 'creditLimit',
            },
          );
        }
        await this.checkPriceLevel(tx, input.priceLevelId);
        const { version, ...data } = input;
        const { count } = await tx.client.updateMany({
          where: { id, version, deletedAt: null },
          data: { ...data, version: { increment: 1 } },
        });
        if (count === 0) {
          throw new AppException(ErrorCode.CLIENT_MODIFIED, 'Client changed since it was read', {
            currentVersion: before.version,
          });
        }
        const after = await tx.client.findUniqueOrThrow({ where: { id }, include: clientInclude });
        await this.audit.log(tx, {
          action: 'CLIENT_UPDATED',
          entity: 'Client',
          entityId: id,
          before,
          after,
        });
        return toDto(after);
      }),
    );
  }

  /** Soft delete; the account history stays. */
  async archive(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await tx.client.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
      await tx.client.update({
        where: { id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.audit.log(tx, {
        action: 'CLIENT_ARCHIVED',
        entity: 'Client',
        entityId: id,
        before,
      });
    });
  }

  /** Once per client. Negative = the client starts with credit in his favour. */
  async openingBalance(id: string, input: OpeningBalanceInput): Promise<ClientDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.liveClient(tx, id);
      await this.account.post(tx, [
        { clientId: id, type: 'OPENING', amount: input.amount, label: input.note ?? '' },
      ]);
      await this.audit.log(tx, {
        action: 'CLIENT_OPENING_BALANCE',
        entity: 'Client',
        entityId: id,
        after: { amount: input.amount, note: input.note },
      });
    });
    return this.get(id);
  }

  async adjust(id: string, input: ClientAdjustmentInput): Promise<ClientDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.liveClient(tx, id);
      await this.account.post(tx, [
        {
          clientId: id,
          type: 'ADJUSTMENT',
          amount: input.amount,
          label: input.reason,
          reason: input.reason,
        },
      ]);
      await this.audit.log(tx, {
        action: 'CLIENT_ADJUSTED',
        entity: 'Client',
        entityId: id,
        after: { amount: input.amount, reason: input.reason },
      });
    });
    return this.get(id);
  }

  /**
   * Relevé de compte. Day boundaries are in Algiers time; the running balance is
   * computed by Postgres (window function), not by loading the history in memory.
   */
  async statement(id: string, query: StatementQuery): Promise<ClientStatementDto> {
    const client = await this.prisma.db.client.findUnique({
      where: { id },
      select: { id: true, code: true, name: true },
    });
    if (!client) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
    const tenantId = tenantContext.requireTenantId();
    const start = algiersDayStart(query.from);
    const end = Prisma.sql`(((${query.to}::date + 1))::timestamp AT TIME ZONE 'Africa/Algiers')`;

    const [opening] = await this.prisma.db.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT SUM(amount) AS total FROM client_ledger_entries
      WHERE "tenantId" = ${tenantId}::uuid AND "clientId" = ${id}::uuid AND "createdAt" < ${start}`;
    const openingBalance = money(opening?.total?.toString() ?? '0');

    const rows = await this.prisma.db.$queryRaw<
      {
        id: string;
        type: ClientStatementDto['entries'][number]['type'];
        amount: Prisma.Decimal;
        label: string;
        reason: string | null;
        refType: string | null;
        refId: string | null;
        createdBy: string | null;
        createdAt: Date;
        running: Prisma.Decimal;
      }[]
    >`
      SELECT id, type, amount, label, reason, "refType", "refId", "createdBy", "createdAt",
             ${openingBalance.toString()}::numeric + SUM(amount) OVER (ORDER BY "createdAt", seq) AS running
      FROM client_ledger_entries
      WHERE "tenantId" = ${tenantId}::uuid AND "clientId" = ${id}::uuid
        AND "createdAt" >= ${start} AND "createdAt" < ${end}
      ORDER BY "createdAt", seq`;

    const userIds = [
      ...new Set(rows.map((r) => r.createdBy).filter((u): u is string => Boolean(u))),
    ];
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    let debit = money(0);
    let credit = money(0);
    for (const r of rows) {
      const a = money(r.amount.toString());
      if (a.gt(0)) debit = debit.plus(a);
      else credit = credit.plus(a.abs());
    }
    return {
      client,
      from: query.from,
      to: query.to,
      openingBalance: toMoneyString(openingBalance),
      entries: rows.map((r) => ({
        id: r.id,
        type: r.type,
        amount: toMoneyString(r.amount.toString()),
        label: r.label,
        reason: r.reason,
        refType: r.refType,
        refId: r.refId,
        createdBy: r.createdBy ? (byId.get(r.createdBy) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        runningBalance: toMoneyString(r.running.toString()),
      })),
      closingBalance: toMoneyString(openingBalance.plus(debit).minus(credit)),
      totalDebit: toMoneyString(debit),
      totalCredit: toMoneyString(credit),
    };
  }

  /** Who owes the most (dashboard, phase 10). */
  async debtors(limit: number): Promise<DebtorDto[]> {
    const rows = await this.prisma.db.clientBalance.findMany({
      where: { balance: { gt: 0 }, client: { deletedAt: null } },
      orderBy: { balance: 'desc' },
      take: limit,
      include: { client: true },
    });
    return rows.map((r) => ({
      id: r.client.id,
      code: r.client.code,
      name: r.client.name,
      phone: r.client.phone,
      balance: toMoneyString(r.balance.toString()),
      creditLimit: r.client.creditLimit ? toMoneyString(r.client.creditLimit.toString()) : null,
    }));
  }

  /** Cache vs ledger. An empty `differences` list means they agree. */
  async reconcile(): Promise<ClientReconcileReport> {
    const tenantId = tenantContext.requireTenantId();
    const rows = await this.prisma.db.$queryRaw<
      { clientId: string; cached: Prisma.Decimal; ledger: Prisma.Decimal }[]
    >`
      SELECT b."clientId", b.balance AS cached, COALESCE(SUM(e.amount), 0) AS ledger
      FROM client_balances b
      LEFT JOIN client_ledger_entries e ON e."clientId" = b."clientId"
      WHERE b."tenantId" = ${tenantId}::uuid
      GROUP BY b."clientId", b.balance`;
    return {
      checkedClients: rows.length,
      differences: rows
        .filter((r) => !money(r.cached.toString()).eq(r.ledger.toString()))
        .map((r) => ({
          clientId: r.clientId,
          cachedBalance: toMoneyString(r.cached.toString()),
          ledgerBalance: toMoneyString(r.ledger.toString()),
        })),
    };
  }

  private async liveClient(tx: Tx, id: string): Promise<void> {
    const c = await tx.client.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!c) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
  }

  private async checkPriceLevel(tx: Tx, priceLevelId: string | null): Promise<void> {
    if (!priceLevelId) return;
    const level = await tx.priceLevel.findUnique({ where: { id: priceLevelId } });
    if (!level)
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown price level', {
        field: 'priceLevelId',
      });
  }

  private async withCodeErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(ErrorCode.CLIENT_CODE_TAKEN, 'Client code already used');
      }
      throw err;
    }
  }
}
