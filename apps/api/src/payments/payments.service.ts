import { Injectable } from '@nestjs/common';
import {
  type BouncePaymentInput,
  type CashSummaryDto,
  CashMovementType,
  ClientLedgerType,
  type CreatePaymentInput,
  DocType,
  ErrorCode,
  money,
  type Money,
  type PaymentDto,
  type PaymentListQuery,
  type PaymentMode,
  type PaymentPage,
  PaymentStatus,
  Permission,
  type ReassignCollectorInput,
  Role,
  toMoneyString,
  type UnpaidDocumentDto,
  GeoRefType,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can, requirePermission } from '../auth/permissions';
import { ClientAccountService } from '../clients/client-account.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { GeoCheckService } from '../geo/geo-check.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { type DataScope, ScopeService } from '../sales-force/scope.service';
import { WarehousesService } from '../stock/warehouses.service';
import { CashLedgerService } from '../treasury/cash-ledger.service';

const paymentInclude = {
  client: { select: { id: true, code: true, name: true } },
  sale: { select: { id: true, number: true } },
  allocations: {
    // Rows of one versement share createdAt: order by the documents, oldest first.
    orderBy: [
      { createdAt: 'asc' },
      { sale: { documentDate: 'asc' } },
      { sale: { createdAt: 'asc' } },
    ],
    include: { sale: { select: { number: true, type: true } } },
  },
} satisfies Prisma.PaymentInclude;
type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

/** Algiers has no DST: its midnight is 23:00 UTC the day before. */
const algiersMidnight = (day: string): Date => new Date(`${day}T00:00:00+01:00`);
const nextDay = (day: string): string => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
export const algiersDay = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(d);

function toDto(
  p: PaymentWithRelations,
  users: Map<string, { id: string; fullName: string }>,
): PaymentDto {
  return {
    id: p.id,
    number: p.number,
    client: p.client,
    sale: p.sale,
    amount: toMoneyString(p.amount.toString()),
    mode: p.mode,
    status: p.status,
    reference: p.reference,
    bank: p.bank,
    dueDate: p.dueDate?.toISOString().slice(0, 10) ?? null,
    note: p.note,
    receivedBy: p.receivedBy ? (users.get(p.receivedBy) ?? null) : null,
    collectedBy: p.collectedBy ? (users.get(p.collectedBy) ?? null) : null,
    receivedAt: p.receivedAt.toISOString(),
    cancelReason: p.cancelReason,
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
    bounceReason: p.bounceReason,
    bouncedAt: p.bouncedAt?.toISOString() ?? null,
    allocations: p.allocations.map((a) => ({
      saleId: a.saleId,
      saleNumber: a.sale.number,
      saleType: a.sale.type,
      amount: toMoneyString(a.amount.toString()),
    })),
    version: p.version,
  };
}

/**
 * Versements: the only writer of payments and payment_allocations. The money side
 * goes through ClientAccountService. Lock order everywhere: payment rows, then the
 * client balance, then the cash balance (sales take sale and stock rows before all).
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly account: ClientAccountService,
    private readonly numbering: DocumentNumberingService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly geo: GeoCheckService,
    private readonly warehouses: WarehousesService,
    private readonly cash: CashLedgerService,
  ) {}

  // ---------------------------------------------------------------- used by sales

  /**
   * The part paid at the moment of sale. The sale posts its own ledger entry (in
   * the same transaction); this records the money and allocates it to the sale.
   */
  async recordForSaleInTx(
    tx: Tx,
    input: {
      clientId: string | null;
      saleId: string;
      amount: string;
      mode: PaymentMode;
      receivedBy: string;
      collectedBy: string | null;
      /** The sale's dépôt (phase 24). */
      warehouseId: string;
    },
  ): Promise<void> {
    const tenantId = tenantContext.requireTenantId();
    const cashAccountId = await this.cash.defaultFor(tx, input);
    const payment = await tx.payment.create({
      data: {
        tenantId,
        cashAccountId,
        number: await this.numbering.next(tx, tenantId, DocType.VER),
        clientId: input.clientId,
        saleId: input.saleId,
        amount: input.amount,
        mode: input.mode,
        receivedBy: input.receivedBy,
        collectedBy: input.collectedBy,
        warehouseId: input.warehouseId,
      },
    });
    await tx.paymentAllocation.create({
      data: { tenantId, paymentId: payment.id, saleId: input.saleId, amount: input.amount },
    });
    await this.cash.post(tx, [
      {
        cashAccountId,
        amount: input.amount,
        type: CashMovementType.VERSEMENT,
        refType: 'Payment',
        refId: payment.id,
        date: algiersDay(payment.receivedAt),
        note: payment.number,
      },
    ]);
  }

  /**
   * Cancels the sale's payments that still count (a bounced cheque was already
   * reversed) and returns their total, for the sale to reverse exactly that.
   */
  async cancelForSaleInTx(
    tx: Tx,
    saleId: string,
    user: CurrentUserInfo,
    reason: string,
  ): Promise<{ total: Money; ids: string[] }> {
    const rows = await tx.$queryRaw<{ id: string; amount: Prisma.Decimal }[]>`
      SELECT id, amount FROM payments
      WHERE "tenantId" = ${tenantContext.requireTenantId()}::uuid
        AND "saleId" = ${saleId}::uuid AND status = 'VALID'
      ORDER BY id
      FOR UPDATE`;
    if (rows.length === 0) return { total: money(0), ids: [] };
    await tx.payment.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: {
        status: PaymentStatus.CANCELLED,
        cancelReason: reason,
        cancelledBy: user.id,
        cancelledAt: new Date(),
        version: { increment: 1 },
      },
    });
    return {
      total: rows.reduce((s, r) => s.plus(r.amount.toString()), money(0)),
      ids: rows.map((r) => r.id),
    };
  }

  /** After the client balance (lock order): takes the sale's cancelled payments off the caisse. */
  async reverseCashInTx(tx: Tx, paymentIds: string[], reason: string): Promise<void> {
    for (const refId of paymentIds) {
      await this.cash.reverse(tx, { refType: 'Payment', refId, note: reason });
    }
  }

  // ---------------------------------------------------------------- versements

  async create(input: CreatePaymentInput, user: CurrentUserInfo): Promise<PaymentDto> {
    const { id, geoCheck } = await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      const client = await tx.client.findFirst({ where: { id: input.clientId, deletedAt: null } });
      if (!client) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown client', {
          field: 'clientId',
        });
      }
      await this.scope.assertClient(tx, user, client.id);
      const warehouseId = await this.warehouseFor(tx, input.warehouseId, user);
      const cashAccountId = await this.cash.resolve(
        tx,
        { requested: input.cashAccountId, mode: input.mode, warehouseId },
        user,
      );
      const number = await this.numbering.next(tx, tenantId, DocType.VER);
      const payment = await tx.payment.create({
        data: {
          tenantId,
          number,
          clientId: client.id,
          amount: input.amount,
          mode: input.mode,
          reference: input.reference,
          bank: input.bank,
          dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null,
          note: input.note,
          receivedBy: user.id,
          // A seller who takes the money collected it himself (phase 14).
          collectedBy: user.role === Role.SELLER ? user.id : null,
          warehouseId,
          cashAccountId,
        },
      });
      // Posting first locks the client balance: concurrent versements of the same
      // client compute their allocations one after the other.
      await this.account.post(tx, [
        {
          clientId: client.id,
          type: ClientLedgerType.PAYMENT,
          amount: money(input.amount).negated().toString(),
          label: number,
          refType: 'Payment',
          refId: payment.id,
          warehouseId,
        },
      ]);
      const allocations = await this.allocate(
        tx,
        client.id,
        money(input.amount),
        input.allocations,
      );
      if (allocations.length > 0) {
        await tx.paymentAllocation.createMany({
          data: allocations.map((a) => ({
            tenantId,
            paymentId: payment.id,
            saleId: a.saleId,
            amount: a.amount.toString(),
          })),
        });
      }
      await this.cash.post(tx, [
        {
          cashAccountId,
          amount: input.amount,
          type: CashMovementType.VERSEMENT,
          refType: 'Payment',
          refId: payment.id,
          date: algiersDay(payment.receivedAt),
          note: number,
        },
      ]);
      await this.audit.log(tx, {
        action: 'PAYMENT_CREATED',
        entity: 'Payment',
        entityId: payment.id,
        after: {
          number,
          clientId: client.id,
          amount: input.amount,
          mode: input.mode,
          warehouseId,
          cashAccountId,
          allocations: allocations.map((a) => ({ saleId: a.saleId, amount: a.amount.toString() })),
        },
      });
      const geoCheck = await this.geo.checkInTx(tx, {
        refType: GeoRefType.PAYMENT,
        refId: payment.id,
        refNumber: number,
        clientId: client.id,
        geo: input.geo,
        user,
      });
      return { id: payment.id, geoCheck };
    });
    return { ...(await this.get(id)), geoCheck };
  }

  /** Input mistake: the money is taken back off the account. Never deleted. */
  async cancel(id: string, reason: string, user: CurrentUserInfo): Promise<PaymentDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertInScope(tx, user, id);
      const p = await this.lockValid(tx, id);
      if (p.saleId) {
        throw new AppException(ErrorCode.PAYMENT_LINKED_TO_SALE, 'Cancel the sale instead', {
          saleId: p.saleId,
        });
      }
      // Without PAYMENT_CANCEL: only your own versement, the same day (a typing mistake).
      if (!can(user, Permission.PAYMENT_CANCEL)) {
        const sameDay = algiersDay(p.receivedAt) === algiersDay(new Date());
        if (p.receivedBy !== user.id || !sameDay) {
          throw new AppException(ErrorCode.FORBIDDEN, 'You may not cancel this payment', {
            permission: Permission.PAYMENT_CANCEL,
            rule: 'same_day_only',
          });
        }
      }
      await tx.payment.update({
        where: { id },
        data: {
          status: PaymentStatus.CANCELLED,
          cancelReason: reason,
          cancelledBy: user.id,
          cancelledAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (p.clientId) {
        await this.account.post(tx, [
          {
            clientId: p.clientId,
            type: ClientLedgerType.REVERSAL,
            amount: p.amount.toString(),
            label: p.number,
            reason,
            refType: 'Payment',
            refId: id,
            warehouseId: p.warehouseId ?? (await this.defaultWarehouseId(tx)),
          },
        ]);
      }
      await this.cash.reverse(tx, { refType: 'Payment', refId: id, note: reason });
      await this.audit.log(tx, {
        action: 'PAYMENT_CANCELLED',
        entity: 'Payment',
        entityId: id,
        before: { status: p.status },
        after: { reason },
      });
    });
    return this.get(id);
  }

  /** Chèque impayé: the debt comes back, plus the bank fees if any. */
  async bounce(id: string, input: BouncePaymentInput, user: CurrentUserInfo): Promise<PaymentDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertInScope(tx, user, id);
      const p = await this.lockValid(tx, id);
      if (p.mode !== 'CHEQUE') {
        throw new AppException(ErrorCode.PAYMENT_NOT_CHEQUE, 'Only a cheque can bounce');
      }
      if (!p.clientId) {
        throw new AppException(
          ErrorCode.VALIDATION_FAILED,
          'A counter sale cheque has no account',
          {
            rule: 'bounce_needs_client',
          },
        );
      }
      await tx.payment.update({
        where: { id },
        data: {
          status: PaymentStatus.BOUNCED,
          bounceReason: input.reason,
          bouncedBy: user.id,
          bouncedAt: new Date(),
          version: { increment: 1 },
        },
      });
      const fees = money(input.bankFees);
      const warehouseId = p.warehouseId ?? (await this.defaultWarehouseId(tx));
      await this.account.post(tx, [
        {
          clientId: p.clientId,
          type: ClientLedgerType.REVERSAL,
          amount: p.amount.toString(),
          label: p.number,
          reason: input.reason,
          refType: 'Payment',
          refId: id,
          warehouseId,
        },
        ...(fees.gt(0)
          ? [
              {
                clientId: p.clientId,
                type: ClientLedgerType.ADJUSTMENT,
                amount: fees.toString(),
                label: p.number,
                reason: input.reason,
                refType: 'Payment',
                refId: id,
                warehouseId,
              },
            ]
          : []),
      ]);
      // The bank really took the money back, today, from the account it went into.
      await this.cash.reverse(tx, {
        refType: 'Payment',
        refId: id,
        note: input.reason,
        realEvent: true,
      });
      await this.audit.log(tx, {
        action: 'PAYMENT_BOUNCED',
        entity: 'Payment',
        entityId: id,
        after: { reason: input.reason, bankFees: fees.toString() },
      });
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------- reads

  /** With a user, a versement outside his scope (phase 14) answers 404. */
  async get(id: string, user?: CurrentUserInfo): Promise<PaymentDto> {
    const scope = user ? await this.scope.of(user) : null;
    const p = await this.prisma.db.payment.findFirst({
      where: { id, ...(scope ? this.scope.paymentWhere(scope) : {}) },
      include: paymentInclude,
    });
    if (!p) throw new AppException(ErrorCode.NOT_FOUND, 'Payment not found');
    return toDto(p, await this.users([p.receivedBy, p.collectedBy]));
  }

  /**
   * Changes who collected a versement (phase 14): SALE_REASSIGN_SELLER and a reason,
   * audited with before/after. Phase 18 refuses it once the month's incentives are approved.
   */
  async reassignCollector(
    id: string,
    input: ReassignCollectorInput,
    user: CurrentUserInfo,
  ): Promise<PaymentDto> {
    requirePermission(user, Permission.SALE_REASSIGN_SELLER);
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertInScope(tx, user, id);
      const [p] = await tx.$queryRaw<
        { collectedBy: string | null; receivedAt: Date; number: string }[]
      >`SELECT "collectedBy", "receivedAt", number FROM payments
        WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
        FOR UPDATE`;
      if (!p) throw new AppException(ErrorCode.NOT_FOUND, 'Payment not found');
      await this.scope.assertSellerChangeAllowed(tx, { kind: 'PAYMENT', at: p.receivedAt });
      if (input.collectedBy) await this.scope.assertSeller(tx, input.collectedBy);
      if (input.collectedBy === p.collectedBy) return;
      await tx.payment.update({
        where: { id },
        data: { collectedBy: input.collectedBy, version: { increment: 1 } },
      });
      await this.audit.log(tx, {
        action: 'PAYMENT_COLLECTOR_REASSIGNED',
        entity: 'Payment',
        entityId: id,
        before: { collectedBy: p.collectedBy, number: p.number },
        after: { collectedBy: input.collectedBy, reason: input.reason },
      });
    });
    return this.get(id, user);
  }

  private async assertInScope(tx: Tx, user: CurrentUserInfo, id: string): Promise<void> {
    const scope = await this.scope.of(user, tx);
    if (!scope.documentUserIds && !scope.warehouseIds) return;
    const p = await tx.payment.findFirst({
      where: { id, ...this.scope.paymentWhere(scope) },
      select: { id: true },
    });
    if (!p) throw new AppException(ErrorCode.NOT_FOUND, 'Payment not found');
  }

  async list(query: PaymentListQuery, user: CurrentUserInfo): Promise<PaymentPage> {
    const scope = await this.scope.of(user);
    const where: Prisma.PaymentWhereInput = {
      AND: [
        this.scope.paymentWhere(scope),
        query.collectedBy
          ? {
              OR: [
                { collectedBy: query.collectedBy },
                { collectedBy: null, receivedBy: query.collectedBy },
              ],
            }
          : {},
        query.warehouseId ? { warehouseId: query.warehouseId } : {},
      ],
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.mode ? { mode: query.mode } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.receivedBy ? { receivedBy: query.receivedBy } : {}),
      ...(query.from || query.to
        ? {
            receivedAt: {
              ...(query.from ? { gte: algiersMidnight(query.from) } : {}),
              ...(query.to ? { lt: algiersMidnight(nextDay(query.to)) } : {}),
            },
          }
        : {}),
    };
    const orderBy: Prisma.PaymentOrderByWithRelationInput[] =
      query.sort === 'dueDate'
        ? [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]
        : [{ receivedAt: 'desc' }, { id: 'desc' }];
    const rows = await this.prisma.db.payment.findMany({
      where,
      include: paymentInclude,
      orderBy,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    const users = await this.users(page.flatMap((p) => [p.receivedBy, p.collectedBy]));
    return {
      items: page.map((p) => toDto(p, users)),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async unpaidDocuments(clientId: string, user: CurrentUserInfo): Promise<UnpaidDocumentDto[]> {
    const client = await this.prisma.db.client.findUnique({ where: { id: clientId } });
    if (!client) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
    await this.scope.assertClient(this.prisma.db, user, clientId);
    return (await this.unpaid(this.prisma.db, clientId)).map((d) => ({
      saleId: d.id,
      type: d.type,
      number: d.number,
      documentDate: d.documentDate.toISOString().slice(0, 10),
      totalTtc: toMoneyString(d.totalTtc),
      returned: toMoneyString(d.returned),
      paid: toMoneyString(d.paid),
      remaining: toMoneyString(d.remaining),
    }));
  }

  /** Journal de caisse: money received that Algiers day, by mode and by user. */
  /**
   * `statsWarehouseIds` (phase 24, dashboard): the dépôts whose cash the user sees as
   * figures, in place of those he works in.
   */
  /** The versements counted as cash between two Algiers days, both included. */
  private collectedSql(tenantId: string, scope: DataScope, from: string, to: string): Prisma.Sql {
    return Prisma.sql`"tenantId" = ${tenantId}::uuid AND status = 'VALID'
        AND ${this.scope.paymentSql(scope, 'payments')}
        AND "receivedAt" >= ${algiersMidnight(from)} AND "receivedAt" < ${algiersMidnight(nextDay(to))}`;
  }

  /** Encaissements of a period: the cash summary's figures, over several days (phase 30). */
  async collected(
    from: string,
    to: string,
    user: CurrentUserInfo,
    statsWarehouseIds?: string[] | null,
  ): Promise<{ total: string; count: number }> {
    const tenantId = tenantContext.requireTenantId();
    const base = await this.scope.of(user);
    const scope =
      statsWarehouseIds === undefined ? base : { ...base, warehouseIds: statsWarehouseIds };
    const [row] = await this.prisma.db.$queryRaw<{ count: bigint; total: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) AS count, SUM(amount) AS total
      FROM payments
      WHERE ${this.collectedSql(tenantId, scope, from, to)}`;
    return {
      total: toMoneyString(money(row?.total?.toString() ?? 0)),
      count: Number(row?.count ?? 0),
    };
  }

  /** `collected` per Algiers day (phase 33, the dashboard chart): day → total. */
  async collectedByDay(
    from: string,
    to: string,
    user: CurrentUserInfo,
    statsWarehouseIds?: string[] | null,
  ): Promise<Map<string, string>> {
    const tenantId = tenantContext.requireTenantId();
    const base = await this.scope.of(user);
    const scope =
      statsWarehouseIds === undefined ? base : { ...base, warehouseIds: statsWarehouseIds };
    const rows = await this.prisma.db.$queryRaw<{ day: string; total: Prisma.Decimal }[]>`
      SELECT to_char("receivedAt" AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD') AS day,
             SUM(amount) AS total
      FROM payments
      WHERE ${this.collectedSql(tenantId, scope, from, to)}
      GROUP BY 1`;
    return new Map(rows.map((r) => [r.day, toMoneyString(r.total.toString())]));
  }

  /** A versement by its number, in the user's scope. */
  async findByNumber(number: string, user: CurrentUserInfo): Promise<PaymentDto> {
    const scope = await this.scope.of(user);
    const p = await this.prisma.db.payment.findFirst({
      where: { number, ...this.scope.paymentWhere(scope) },
      select: { id: true },
    });
    if (!p) throw new AppException(ErrorCode.NOT_FOUND, 'Payment not found');
    return this.get(p.id, user);
  }

  async summary(
    date: string,
    user: CurrentUserInfo,
    statsWarehouseIds?: string[] | null,
  ): Promise<CashSummaryDto> {
    const tenantId = tenantContext.requireTenantId();
    const base = await this.scope.of(user);
    const scope =
      statsWarehouseIds === undefined ? base : { ...base, warehouseIds: statsWarehouseIds };
    const rows = await this.prisma.db.$queryRaw<
      { mode: PaymentMode; receivedBy: string | null; count: bigint; total: Prisma.Decimal }[]
    >`
      SELECT mode, "receivedBy", COUNT(*) AS count, SUM(amount) AS total
      FROM payments
      WHERE ${this.collectedSql(tenantId, scope, date, date)}
      GROUP BY mode, "receivedBy"
      ORDER BY mode, "receivedBy"`;
    const users = await this.users(rows.map((r) => r.receivedBy));
    const byMode = new Map<PaymentMode, { count: number; total: Money }>();
    const byUser = new Map<
      string,
      { count: number; total: Money; modes: Map<PaymentMode, Money> }
    >();
    let total = money(0);
    let count = 0;
    for (const r of rows) {
      const amount = money(r.total.toString());
      const n = Number(r.count); // a row count, not money
      total = total.plus(amount);
      count += n;
      const m = byMode.get(r.mode) ?? { count: 0, total: money(0) };
      byMode.set(r.mode, { count: m.count + n, total: m.total.plus(amount) });
      const key = r.receivedBy ?? '';
      const u = byUser.get(key) ?? {
        count: 0,
        total: money(0),
        modes: new Map<PaymentMode, Money>(),
      };
      u.count += n;
      u.total = u.total.plus(amount);
      u.modes.set(r.mode, (u.modes.get(r.mode) ?? money(0)).plus(amount));
      byUser.set(key, u);
    }
    return {
      date,
      total: toMoneyString(total),
      count,
      byMode: [...byMode].map(([mode, v]) => ({
        mode,
        count: v.count,
        total: toMoneyString(v.total),
      })),
      byUser: [...byUser].map(([userId, v]) => ({
        user: userId ? (users.get(userId) ?? null) : null,
        count: v.count,
        total: toMoneyString(v.total),
        byMode: [...v.modes].map(([mode, t]) => ({ mode, total: toMoneyString(t) })),
      })),
    };
  }

  // ---------------------------------------------------------------- internals

  /**
   * A versement's dépôt (phase 24): the one chosen (in the user's reach), else the only
   * dépôt the user works in, else the dépôt principal.
   */
  private async warehouseFor(
    tx: Tx,
    requested: string | undefined,
    user: CurrentUserInfo,
  ): Promise<string> {
    if (requested) {
      const w = await tx.warehouse.findFirst({
        where: { id: requested, deletedAt: null },
        select: { id: true },
      });
      if (!w) throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Warehouse not found');
      await this.scope.assertWarehouse(tx, user, w.id);
      return w.id;
    }
    const id = (await this.scope.onlyWarehouse(user, tx)) ?? (await this.defaultWarehouseId(tx));
    await this.scope.assertWarehouse(tx, user, id);
    return id;
  }

  private defaultWarehouseId(tx: Tx): Promise<string> {
    return this.warehouses.defaultId(tx);
  }

  private async lockValid(
    tx: Tx,
    id: string,
  ): Promise<{
    id: string;
    number: string;
    status: PaymentStatus;
    mode: PaymentMode;
    amount: Prisma.Decimal;
    clientId: string | null;
    saleId: string | null;
    receivedBy: string | null;
    receivedAt: Date;
    warehouseId: string | null;
  }> {
    const rows = await tx.$queryRaw<
      {
        id: string;
        number: string;
        status: PaymentStatus;
        mode: PaymentMode;
        amount: Prisma.Decimal;
        clientId: string | null;
        saleId: string | null;
        receivedBy: string | null;
        receivedAt: Date;
        warehouseId: string | null;
      }[]
    >`
      SELECT id, number, status, mode, amount, "clientId", "saleId", "receivedBy", "receivedAt",
             "warehouseId"
      FROM payments
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      FOR UPDATE`;
    const p = rows[0];
    if (!p) throw new AppException(ErrorCode.NOT_FOUND, 'Payment not found');
    if (p.status !== PaymentStatus.VALID) {
      throw new AppException(ErrorCode.PAYMENT_NOT_VALID, 'Payment already cancelled or bounced', {
        status: p.status,
      });
    }
    return p;
  }

  /**
   * Validated documents that moved the client account (BLs and direct factures; a
   * facture grouping BLs carries no effect of its own), oldest first, with what is
   * left to pay after avoirs and the allocations of valid versements.
   */
  private async unpaid(
    db: Tx | PrismaService['db'],
    clientId: string,
  ): Promise<
    {
      id: string;
      type: 'BL' | 'FACTURE';
      number: string | null;
      documentDate: Date;
      totalTtc: Money;
      returned: Money;
      paid: Money;
      remaining: Money;
    }[]
  > {
    const tenantId = tenantContext.requireTenantId();
    const rows = await db.$queryRaw<
      {
        id: string;
        type: 'BL' | 'FACTURE';
        number: string | null;
        documentDate: Date;
        totalTtc: Prisma.Decimal;
        returned: Prisma.Decimal;
        paid: Prisma.Decimal;
      }[]
    >`
      -- What the document asks for: TTC plus the timbre of a cash facture.
      SELECT s.id, s.type, s.number, s."documentDate", s."totalTtc" + s.timbre AS "totalTtc",
        COALESCE((SELECT SUM(r."totalTtc") FROM sale_returns r WHERE r."saleId" = s.id), 0) AS returned,
        COALESCE((SELECT SUM(a.amount) FROM payment_allocations a
                  JOIN payments p ON p.id = a."paymentId"
                  WHERE a."saleId" = s.id AND p.status = 'VALID'), 0) AS paid
      FROM sales s
      WHERE s."tenantId" = ${tenantId}::uuid AND s."clientId" = ${clientId}::uuid
        AND s.status = 'VALIDATED'
        AND NOT EXISTS (SELECT 1 FROM sales b WHERE b."invoiceId" = s.id)
      ORDER BY s."documentDate", s."createdAt", s.id`;
    return rows
      .map((r) => {
        const totalTtc = money(r.totalTtc.toString());
        const returned = money(r.returned.toString());
        const paid = money(r.paid.toString());
        return { ...r, totalTtc, returned, paid, remaining: totalTtc.minus(returned).minus(paid) };
      })
      .filter((r) => r.remaining.gt(0));
  }

  /** Manual allocations are checked against what is left; none = oldest first. */
  private async allocate(
    tx: Tx,
    clientId: string,
    amount: Money,
    manual: { saleId: string; amount: string }[] | undefined,
  ): Promise<{ saleId: string; amount: Money }[]> {
    const open = await this.unpaid(tx, clientId);
    if (manual) {
      const byId = new Map(open.map((d) => [d.id, d]));
      let sum = money(0);
      const out = manual.map((m) => {
        const doc = byId.get(m.saleId);
        const value = money(m.amount);
        if (!doc || value.gt(doc.remaining)) {
          throw new AppException(ErrorCode.ALLOCATION_INVALID, 'Cannot allocate to this document', {
            saleId: m.saleId,
            remaining: doc ? toMoneyString(doc.remaining) : null,
          });
        }
        sum = sum.plus(value);
        return { saleId: m.saleId, amount: value };
      });
      if (sum.gt(amount)) {
        throw new AppException(ErrorCode.ALLOCATION_INVALID, 'More allocated than paid', {
          allocated: toMoneyString(sum),
        });
      }
      return out;
    }
    const out: { saleId: string; amount: Money }[] = [];
    let left = amount;
    for (const doc of open) {
      if (left.lte(0)) break;
      const part = left.lt(doc.remaining) ? left : doc.remaining;
      out.push({ saleId: doc.id, amount: part });
      left = left.minus(part);
    }
    return out;
  }

  private async users(
    ids: (string | null)[],
  ): Promise<Map<string, { id: string; fullName: string }>> {
    const unique = [...new Set(ids.filter((u): u is string => !!u))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((u) => [u.id, u]));
  }
}
