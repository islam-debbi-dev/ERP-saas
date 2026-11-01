import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type ClientAdjustmentInput,
  type ClientBulkAssignInput,
  type ClientBulkAssignResultDto,
  type ClientDebtByWarehouseDto,
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
import { chunks } from '../common/chunks';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { type DataScope, ScopeService } from '../sales-force/scope.service';
import { WarehousesService } from '../stock/warehouses.service';
import { SectorsService } from '../sales-force/sectors.service';
import { ClientAccountService } from './client-account.service';

const clientInclude = {
  balance: true,
  sector: { select: { id: true, name: true } },
  assignedSeller: { select: { id: true, fullName: true } },
} satisfies Prisma.ClientInclude;
type ClientWithBalance = Prisma.ClientGetPayload<{ include: typeof clientInclude }>;

/** Only managers decide how much credit a client gets. */
const PLAFOND_ROLES = new Set<string>([Role.OWNER, Role.MANAGER]);

/** Who sets a client's sector and seller (phase 14). A supervisor only within his team. */
const ASSIGNER_ROLES = new Set<string>([Role.OWNER, Role.MANAGER, Role.SUPERVISOR]);

type Assignment = { sectorId?: string | null; assignedSellerId?: string | null };

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
    sector: c.sector,
    assignedSeller: c.assignedSeller,
    notes: c.notes,
    active: c.active,
    version: c.version,
    archivedAt: c.deletedAt?.toISOString() ?? null,
    balance: toMoneyString(balance),
    hasOpening: c.balance?.hasOpening ?? false,
    overLimit: c.creditLimit !== null && money(balance).gt(c.creditLimit.toString()),
    location:
      c.lat !== null && c.lng !== null
        ? {
            lat: c.lat.toNumber(),
            lng: c.lng.toNumber(),
            accuracyM: c.geoAccuracyM,
            setAt: c.geoSetAt?.toISOString() ?? null,
            setById: c.geoSetBy,
          }
        : null,
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
    private readonly scope: ScopeService,
    private readonly sectors: SectorsService,
    private readonly warehouses: WarehousesService,
  ) {}

  /** Raw SQL picks the page (filters compare balance with plafond); Prisma loads the rows. */
  async list(query: ClientListQuery, user: CurrentUserInfo): Promise<ClientPage> {
    const tenantId = tenantContext.requireTenantId();
    const scope = await this.scope.of(user);
    const filters: Prisma.Sql[] = [
      Prisma.sql`c."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`c."deletedAt" IS NULL`,
      this.scope.clientSql(scope, 'c'),
    ];
    if (query.sectorId) filters.push(Prisma.sql`c."sectorId" = ${query.sectorId}::uuid`);
    if (query.assignedSellerId)
      filters.push(Prisma.sql`c."assignedSellerId" = ${query.assignedSellerId}::uuid`);
    if (query.unassigned === 'sector') filters.push(Prisma.sql`c."sectorId" IS NULL`);
    if (query.unassigned === 'seller') filters.push(Prisma.sql`c."assignedSellerId" IS NULL`);
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

  /**
   * Outside the user's scope (phase 14) the client does not exist for him: 404. Without
   * a user (internal reads, share links) it is not scoped.
   */
  async get(id: string, user?: CurrentUserInfo): Promise<ClientDto> {
    const scope = user ? await this.scope.of(user) : null;
    const c = await this.prisma.db.client.findFirst({
      where: { id, ...(scope ? this.scope.clientWhere(scope) : {}) },
      include: clientInclude,
    });
    if (!c) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
    const dto = toDto(c);
    if (await this.warehouses.multiUnitOn()) dto.debtByWarehouse = await this.debtByWarehouse(id);
    return dto;
  }

  /**
   * One client account, split by the dépôt each entry belongs to (phase 24). The parts add
   * up to the balance; entries without a dépôt (before the backfill) count for the
   * dépôt principal, as the backfill will decide.
   */
  async debtByWarehouse(id: string): Promise<ClientDebtByWarehouseDto[]> {
    const tenantId = tenantContext.requireTenantId();
    const rows = await this.prisma.db.$queryRaw<
      { id: string | null; name: string | null; balance: Prisma.Decimal }[]
    >`
      SELECT w.id, w.name, SUM(e.amount) AS balance
      FROM client_ledger_entries e
      LEFT JOIN warehouses w ON w.id = COALESCE(e."warehouseId", (
        SELECT d.id FROM warehouses d WHERE d."tenantId" = ${tenantId}::uuid AND d."isDefault"))
      WHERE e."tenantId" = ${tenantId}::uuid AND e."clientId" = ${id}::uuid
      GROUP BY w.id, w.name
      HAVING SUM(e.amount) <> 0
      ORDER BY w.name`;
    return rows.map((r) => ({
      warehouse: r.id ? { id: r.id, name: r.name ?? '' } : null,
      balance: toMoneyString(r.balance.toString()),
    }));
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
        const { sectorId, assignedSellerId, ...fields } = input;
        const assignment = await this.assignment(tx, user, { sectorId, assignedSellerId }, null);
        const c = await tx.client.create({
          data: { ...fields, ...assignment, tenantId: tenantContext.requireTenantId() },
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
      this.prisma.db.$transaction((tx) => this.updateInTx(tx, id, input, user)),
    );
  }

  /** `update` inside the caller's transaction (Excel import). */
  async updateInTx(
    tx: Tx,
    id: string,
    input: UpdateClientInput,
    user: CurrentUserInfo,
  ): Promise<ClientDto> {
    const scope = await this.scope.of(user, tx);
    const before = await tx.client.findFirst({
      where: { id, deletedAt: null, ...this.scope.clientWhere(scope) },
    });
    if (!before) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
    const limitChanged =
      (before.creditLimit?.toString() ?? null) !==
      (input.creditLimit === null ? null : money(input.creditLimit).toString());
    if (limitChanged && !PLAFOND_ROLES.has(user.role)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Only a manager can change the credit limit', {
        field: 'creditLimit',
      });
    }
    await this.checkPriceLevel(tx, input.priceLevelId);
    const { version, sectorId, assignedSellerId, ...data } = input;
    const assignment = await this.assignment(tx, user, { sectorId, assignedSellerId }, before);
    const { count } = await tx.client.updateMany({
      where: { id, version, deletedAt: null },
      data: { ...data, ...assignment, version: { increment: 1 } },
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
  }

  /**
   * Sets the sector and/or the seller of many clients in one transaction (SALES_FORCE,
   * managers). Each changed client gets its own audit row with before/after.
   */
  async bulkAssign(input: ClientBulkAssignInput): Promise<ClientBulkAssignResultDto> {
    return this.prisma.db.$transaction(async (tx) => {
      if (input.sectorId) await this.sectors.findLive(tx, input.sectorId);
      if (input.assignedSellerId) await this.scope.assertSeller(tx, input.assignedSellerId);
      // Lock in id order: two bulk assigns on overlapping clients cannot deadlock.
      const ids = [...input.clientIds].sort();
      const before = await tx.$queryRaw<
        { id: string; sectorId: string | null; assignedSellerId: string | null }[]
      >`SELECT id, "sectorId", "assignedSellerId" FROM clients
        WHERE id = ANY(${ids}::uuid[]) AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
          AND "deletedAt" IS NULL
        ORDER BY id FOR UPDATE`;
      if (before.length !== ids.length) {
        const found = new Set(before.map((c) => c.id));
        throw new AppException(ErrorCode.NOT_FOUND, 'Client not found', {
          clientIds: ids.filter((id) => !found.has(id)),
        });
      }
      const data: Assignment = {};
      if (input.sectorId !== undefined) data.sectorId = input.sectorId;
      if (input.assignedSellerId !== undefined) data.assignedSellerId = input.assignedSellerId;
      const changed = before.filter(
        (c) =>
          (data.sectorId !== undefined && c.sectorId !== data.sectorId) ||
          (data.assignedSellerId !== undefined && c.assignedSellerId !== data.assignedSellerId),
      );
      if (changed.length === 0) return { updated: 0 };
      await tx.client.updateMany({
        where: { id: { in: changed.map((c) => c.id) } },
        data: { ...data, version: { increment: 1 } },
      });
      await this.audit.logMany(
        tx,
        changed.map((c) => ({
          action: 'CLIENT_ASSIGNED',
          entity: 'Client',
          entityId: c.id,
          before: { sectorId: c.sectorId, assignedSellerId: c.assignedSellerId },
          after: {
            sectorId: data.sectorId === undefined ? c.sectorId : data.sectorId,
            assignedSellerId:
              data.assignedSellerId === undefined ? c.assignedSellerId : data.assignedSellerId,
          },
        })),
      );
      return { updated: changed.length };
    });
  }

  /** Clients (archived included) by code, for matching imported rows. */
  async byCodes(tx: Tx, codes: string[]): Promise<Map<string, ClientDto>> {
    const out = new Map<string, ClientDto>();
    for (const chunk of chunks([...new Set(codes)])) {
      const rows = await tx.client.findMany({
        where: { code: { in: chunk } },
        include: clientInclude,
      });
      for (const c of rows) out.set(c.code, toDto(c));
    }
    return out;
  }

  /**
   * Creates many clients in the caller's transaction with batched inserts
   * (Excel import, managers only: plafonds are allowed). Returns ids in order.
   */
  async createManyInTx(tx: Tx, inputs: CreateClientInput[]): Promise<string[]> {
    if (inputs.length === 0) return [];
    const tenantId = tenantContext.requireTenantId();
    for (const priceLevelId of new Set(inputs.map((i) => i.priceLevelId))) {
      await this.checkPriceLevel(tx, priceLevelId);
    }
    const rows = inputs.map((input) => ({ ...input, id: randomUUID(), tenantId }));
    await this.withCodeErrors(async () => {
      for (const chunk of chunks(rows)) await tx.client.createMany({ data: chunk });
    });
    await this.audit.logMany(
      tx,
      rows.map((r) => ({ action: 'CLIENT_CREATED', entity: 'Client', entityId: r.id, after: r })),
    );
    return rows.map((r) => r.id);
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
  async openingBalance(
    id: string,
    input: OpeningBalanceInput,
    user: CurrentUserInfo,
  ): Promise<ClientDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.liveClient(tx, id);
      const warehouseId = await this.ledgerWarehouse(tx, input.warehouseId, user);
      await this.account.post(tx, [
        {
          clientId: id,
          type: 'OPENING',
          amount: input.amount,
          label: input.note ?? '',
          warehouseId,
        },
      ]);
      await this.audit.log(tx, {
        action: 'CLIENT_OPENING_BALANCE',
        entity: 'Client',
        entityId: id,
        after: { amount: input.amount, note: input.note, warehouseId },
      });
    });
    return this.get(id);
  }

  async adjust(
    id: string,
    input: ClientAdjustmentInput,
    user: CurrentUserInfo,
  ): Promise<ClientDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.liveClient(tx, id);
      const warehouseId = await this.ledgerWarehouse(tx, input.warehouseId, user);
      await this.account.post(tx, [
        {
          clientId: id,
          type: 'ADJUSTMENT',
          amount: input.amount,
          label: input.reason,
          reason: input.reason,
          warehouseId,
        },
      ]);
      await this.audit.log(tx, {
        action: 'CLIENT_ADJUSTED',
        entity: 'Client',
        entityId: id,
        after: { amount: input.amount, reason: input.reason, warehouseId },
      });
    });
    return this.get(id);
  }

  /**
   * Relevé de compte. Day boundaries are in Algiers time; the running balance is
   * computed by Postgres (window function), not by loading the history in memory.
   */
  async statement(
    id: string,
    query: StatementQuery,
    user?: CurrentUserInfo,
  ): Promise<ClientStatementDto> {
    const scope = user ? await this.scope.of(user) : null;
    const client = await this.prisma.db.client.findFirst({
      where: { id, ...(scope ? this.scope.clientWhere(scope) : {}) },
      select: { id: true, code: true, name: true },
    });
    if (!client) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
    const tenantId = tenantContext.requireTenantId();
    // Phase 24: one account, every line, but a line of a dépôt the user does not work in
    // only shows its date, type, number, amount and dépôt.
    const reach = scope?.warehouseIds ?? null;
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
        warehouseId: string | null;
        warehouseName: string | null;
      }[]
    >`
      SELECT e.id, e.type, e.amount, e.label, e.reason, e."refType", e."refId", e."createdBy",
             e."createdAt",
             ${openingBalance.toString()}::numeric + SUM(e.amount) OVER (ORDER BY e."createdAt", e.seq) AS running,
             w.id AS "warehouseId", w.name AS "warehouseName"
      FROM client_ledger_entries e
      LEFT JOIN warehouses w ON w.id = COALESCE(e."warehouseId", (
        SELECT d.id FROM warehouses d WHERE d."tenantId" = ${tenantId}::uuid AND d."isDefault"))
      WHERE e."tenantId" = ${tenantId}::uuid AND e."clientId" = ${id}::uuid
        AND e."createdAt" >= ${start} AND e."createdAt" < ${end}
      ORDER BY e."createdAt", e.seq`;

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
      entries: rows.map((r) => {
        const reduced = reach !== null && !(r.warehouseId && reach.includes(r.warehouseId));
        return {
          id: r.id,
          type: r.type,
          amount: toMoneyString(r.amount.toString()),
          // The label is the document number (or the note of an adjustment): the number
          // stays, a free note of another dépôt does not.
          label: reduced && r.refType === null ? '' : r.label,
          reason: reduced ? null : r.reason,
          refType: r.refType,
          refId: reduced ? null : r.refId,
          createdBy: !reduced && r.createdBy ? (byId.get(r.createdBy) ?? null) : null,
          createdAt: r.createdAt.toISOString(),
          runningBalance: toMoneyString(r.running.toString()),
          warehouse: r.warehouseId ? { id: r.warehouseId, name: r.warehouseName ?? '' } : null,
          reduced,
        };
      }),
      closingBalance: toMoneyString(openingBalance.plus(debit).minus(credit)),
      totalDebit: toMoneyString(debit),
      totalCredit: toMoneyString(credit),
    };
  }

  /**
   * The dépôt an opening balance or an adjustment belongs to (phase 24): the one chosen,
   * else the user's only dépôt, else the dépôt principal; always in the user's reach.
   */
  private async ledgerWarehouse(
    tx: Tx,
    requested: string | undefined,
    user: CurrentUserInfo,
  ): Promise<string> {
    const id = requested
      ? await this.warehouses.resolve(tx, requested)
      : ((await this.scope.onlyWarehouse(user, tx)) ?? (await this.warehouses.defaultId(tx)));
    await this.scope.assertWarehouse(tx, user, id);
    return id;
  }

  /** Who owes the most (dashboard, phase 10). */
  async debtors(limit: number, scope?: DataScope): Promise<DebtorDto[]> {
    const rows = await this.prisma.db.clientBalance.findMany({
      where: {
        balance: { gt: 0 },
        client: { deletedAt: null, ...(scope ? this.scope.clientWhere(scope) : {}) },
      },
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

  /** Crédit clients for the dashboard: what is owed, and who is over the plafond. */
  async creditSummary(limit: number): Promise<{
    total: string;
    debtorCount: number;
    overLimitCount: number;
    overLimit: DebtorDto[];
  }> {
    const tenantId = tenantContext.requireTenantId();
    const [totals] = await this.prisma.db.$queryRaw<
      { total: Prisma.Decimal | null; debtors: bigint; overLimit: bigint }[]
    >`
      SELECT SUM(b.balance) AS total, COUNT(*) AS debtors,
             COUNT(*) FILTER (WHERE c."creditLimit" IS NOT NULL AND b.balance > c."creditLimit") AS "overLimit"
      FROM client_balances b JOIN clients c ON c.id = b."clientId"
      WHERE b."tenantId" = ${tenantId}::uuid AND b.balance > 0 AND c."deletedAt" IS NULL`;
    const over = await this.prisma.db.$queryRaw<
      {
        id: string;
        code: string;
        name: string;
        phone: string | null;
        balance: Prisma.Decimal;
        creditLimit: Prisma.Decimal;
      }[]
    >`
      SELECT c.id, c.code, c.name, c.phone, b.balance, c."creditLimit"
      FROM client_balances b JOIN clients c ON c.id = b."clientId"
      WHERE b."tenantId" = ${tenantId}::uuid AND c."deletedAt" IS NULL
        AND c."creditLimit" IS NOT NULL AND b.balance > c."creditLimit"
      ORDER BY b.balance - c."creditLimit" DESC, c.id
      LIMIT ${limit}`;
    return {
      total: toMoneyString(totals?.total?.toString() ?? '0'),
      debtorCount: Number(totals?.debtors ?? 0),
      overLimitCount: Number(totals?.overLimit ?? 0),
      overLimit: over.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        phone: r.phone,
        balance: toMoneyString(r.balance.toString()),
        creditLimit: toMoneyString(r.creditLimit.toString()),
      })),
    };
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

  /**
   * The sector and seller to store on a create (`before` null) or an update; a key left
   * out keeps the stored value. Outside SALES_FORCE they cannot be set. A seller cannot
   * move a client, and a client he creates is assigned to him (else ASSIGNED_ONLY would
   * hide it from him at once); a supervisor assigns within his team.
   */
  private async assignment(
    tx: Tx,
    user: CurrentUserInfo,
    wanted: Assignment,
    before: { sectorId: string | null; assignedSellerId: string | null } | null,
  ): Promise<Assignment> {
    const changes = (k: keyof Assignment) =>
      wanted[k] !== undefined && wanted[k] !== (before?.[k] ?? null);
    if (!(await this.scope.salesForceOn(user.tenantId))) {
      if (changes('sectorId') || changes('assignedSellerId')) {
        throw new AppException(ErrorCode.FEATURE_NOT_IN_PLAN, 'This module is not in your plan', {
          feature: 'SALES_FORCE',
        });
      }
      return {};
    }
    const out: Assignment = {};
    const selfDefault =
      before === null && (user.role === Role.SELLER || user.role === Role.SUPERVISOR);
    if (!ASSIGNER_ROLES.has(user.role)) {
      const ownSeller =
        wanted.assignedSellerId === undefined || wanted.assignedSellerId === user.id;
      if ((before !== null && changes('sectorId')) || (changes('assignedSellerId') && !ownSeller)) {
        throw new AppException(ErrorCode.FORBIDDEN, 'Only a manager assigns clients', {
          field: changes('sectorId') ? 'sectorId' : 'assignedSellerId',
        });
      }
    }
    if (changes('sectorId')) {
      if (wanted.sectorId) await this.sectors.findLive(tx, wanted.sectorId);
      out.sectorId = wanted.sectorId;
    }
    if (changes('assignedSellerId')) {
      const sellerId = wanted.assignedSellerId ?? null;
      if (sellerId) {
        await this.scope.assertSeller(tx, sellerId);
        if (
          user.role === Role.SUPERVISOR &&
          !(await this.scope.teamIds(user.id, tx)).includes(sellerId)
        ) {
          throw new AppException(ErrorCode.FORBIDDEN, 'This seller is not in your team', {
            field: 'assignedSellerId',
          });
        }
      }
      out.assignedSellerId = sellerId;
    } else if (selfDefault && wanted.assignedSellerId === undefined) {
      out.assignedSellerId = user.id;
    }
    return out;
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
