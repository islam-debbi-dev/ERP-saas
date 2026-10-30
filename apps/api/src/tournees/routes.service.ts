import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  algiersDayBounds,
  type CreateRouteInput,
  ErrorCode,
  type NoSaleReason,
  OrderStatus,
  PaymentStatus,
  type RouteDto,
  SaleStatus,
  type RouteListQuery,
  type SetRouteStopsInput,
  type TodayDto,
  type TodayStopDto,
  toMoneyString,
  type UpdateRouteInput,
  type VisitOutcome,
  weekdayOf,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { type CurrentUserInfo } from '../auth/auth.types';
import { ClockService } from '../clock/clock.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { assertVisible, resolveTourneeSeller, tourneeSellerIds } from './tournee-scope';

const routeInclude = {
  seller: { select: { id: true, fullName: true } },
  _count: { select: { stops: true } },
} satisfies Prisma.RouteInclude;

type RouteRow = Prisma.RouteGetPayload<{ include: typeof routeInclude }>;

function toDto(r: RouteRow, stops: RouteDto['stops'] = []): RouteDto {
  return {
    id: r.id,
    name: r.name,
    seller: r.seller,
    weekdays: r.weekdays,
    active: r.active,
    stopCount: r._count.stops,
    stops,
  };
}

/**
 * Tournées (phase 16): master data, soft-deleted. The stops are an ordered list replaced
 * as a whole. A seller reads his own routes; planners manage them (a supervisor his team's).
 */
@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  async list(query: RouteListQuery, user: CurrentUserInfo): Promise<RouteDto[]> {
    const ids = await tourneeSellerIds(this.scope, user);
    const rows = await this.prisma.db.route.findMany({
      where: {
        deletedAt: null,
        ...(ids ? { sellerId: { in: ids } } : {}),
        ...(query.sellerId ? { sellerId: query.sellerId } : {}),
        ...(query.weekday !== undefined ? { weekdays: { has: query.weekday } } : {}),
      },
      include: routeInclude,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    // A sellerId filter outside the user's reach gives nothing, never more.
    return rows.filter((r) => !ids || ids.includes(r.sellerId)).map((r) => toDto(r));
  }

  async get(id: string, user: CurrentUserInfo): Promise<RouteDto> {
    const r = await this.prisma.db.route.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...routeInclude,
        stops: {
          orderBy: { position: 'asc' },
          include: {
            client: {
              select: { id: true, code: true, name: true, commune: true, phone: true },
            },
          },
        },
      },
    });
    if (!r) throw new AppException(ErrorCode.ROUTE_NOT_FOUND, 'Route not found');
    assertVisible(
      await tourneeSellerIds(this.scope, user),
      [r.sellerId],
      ErrorCode.ROUTE_NOT_FOUND,
    );
    return toDto(
      r,
      r.stops.map((s) => ({ position: s.position, client: s.client })),
    );
  }

  async create(input: CreateRouteInput, user: CurrentUserInfo): Promise<RouteDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const sellerId = await resolveTourneeSeller(tx, this.scope, user, input.sellerId);
      const r = await tx.route.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          name: input.name,
          sellerId,
          weekdays: input.weekdays,
          active: input.active,
        },
      });
      await this.audit.log(tx, {
        action: 'ROUTE_CREATED',
        entity: 'Route',
        entityId: r.id,
        after: { ...input, sellerId },
      });
      return r.id;
    });
    return this.get(id, user);
  }

  async update(id: string, input: UpdateRouteInput, user: CurrentUserInfo): Promise<RouteDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.live(tx, id, user);
      const sellerId =
        input.sellerId !== undefined
          ? await resolveTourneeSeller(tx, this.scope, user, input.sellerId)
          : undefined;
      await tx.route.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(sellerId !== undefined ? { sellerId } : {}),
          ...(input.weekdays !== undefined ? { weekdays: input.weekdays } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      await this.audit.log(tx, {
        action: 'ROUTE_UPDATED',
        entity: 'Route',
        entityId: id,
        before: {
          name: before.name,
          sellerId: before.sellerId,
          weekdays: before.weekdays,
          active: before.active,
        },
        after: input,
      });
    });
    return this.get(id, user);
  }

  async archive(id: string, user: CurrentUserInfo): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.live(tx, id, user);
      await tx.route.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
      await this.audit.log(tx, { action: 'ROUTE_ARCHIVED', entity: 'Route', entityId: id });
    });
  }

  /** Replaces the ordered stops. Clients must be live and within the user's scope. */
  async setStops(id: string, input: SetRouteStopsInput, user: CurrentUserInfo): Promise<RouteDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.live(tx, id, user);
      // Serializes two editors of the same route.
      await tx.$queryRaw`
        SELECT id FROM routes
        WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
        FOR UPDATE`;
      if (input.clientIds.length > 0) {
        const scope = await this.scope.of(user, tx);
        const found = await tx.client.count({
          where: {
            id: { in: input.clientIds },
            deletedAt: null,
            ...this.scope.clientWhere(scope),
          },
        });
        if (found !== input.clientIds.length) {
          throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown client on the route', {
            field: 'clientIds',
          });
        }
      }
      const before = await tx.routeStop.findMany({
        where: { routeId: id },
        orderBy: { position: 'asc' },
        select: { clientId: true },
      });
      // Stops are planning data, not history: visits keep their own routeId.
      await tx.routeStop.deleteMany({ where: { routeId: id } });
      if (input.clientIds.length > 0) {
        const tenantId = tenantContext.requireTenantId();
        await tx.routeStop.createMany({
          data: input.clientIds.map((clientId, i) => ({
            tenantId,
            routeId: id,
            clientId,
            position: i + 1,
          })),
        });
      }
      await this.audit.log(tx, {
        action: 'ROUTE_STOPS_SET',
        entity: 'Route',
        entityId: id,
        before: before.map((s) => s.clientId),
        after: input.clientIds,
      });
    });
    return this.get(id, user);
  }

  /**
   * The caller's tournée of today (Algiers): stops of his active routes running on this
   * weekday, in route then stop order, each client once.
   */
  async today(user: CurrentUserInfo): Promise<TodayDto> {
    const day = algiersDay(this.clock.now());
    const weekday = weekdayOf(day);
    const routes = await this.prisma.db.route.findMany({
      where: { sellerId: user.id, active: true, deletedAt: null, weekdays: { has: weekday } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: {
        stops: {
          orderBy: { position: 'asc' },
          include: {
            client: {
              select: {
                id: true,
                code: true,
                name: true,
                phone: true,
                address: true,
                commune: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });
    const seen = new Set<string>();
    const stops: Omit<
      TodayStopDto,
      'balance' | 'lastVisit' | 'lastSale' | 'visitedToday' | 'today'
    >[] = [];
    for (const r of routes) {
      for (const s of r.stops) {
        if (s.client.deletedAt || seen.has(s.clientId)) continue;
        seen.add(s.clientId);
        const { deletedAt: _archived, ...client } = s.client;
        stops.push({ routeId: r.id, position: s.position, client });
      }
    }
    const clientIds = [...seen];
    const [balances, lastVisits, lastSales, visitedToday, docs] = await Promise.all([
      this.balances(clientIds),
      this.lastVisits(clientIds),
      this.lastSales(clientIds),
      this.visitedOn(user.id, day, clientIds),
      this.documentsOn(user.id, day, clientIds),
    ]);
    const out: TodayStopDto[] = stops.map((s) => ({
      ...s,
      balance: balances.get(s.client.id) ?? '0.00',
      lastVisit: lastVisits.get(s.client.id) ?? null,
      lastSale: lastSales.get(s.client.id) ?? null,
      visitedToday: visitedToday.has(s.client.id),
      today: docs.get(s.client.id) ?? { saleId: null, orderId: null, paymentId: null },
    }));
    return {
      day,
      weekday,
      routes: routes.map((r) => ({ id: r.id, name: r.name })),
      stops: out,
      planned: out.length,
      visited: out.filter((s) => s.visitedToday).length,
    };
  }

  private async live(tx: Tx, id: string, user: CurrentUserInfo) {
    const r = await tx.route.findFirst({ where: { id, deletedAt: null } });
    if (!r) throw new AppException(ErrorCode.ROUTE_NOT_FOUND, 'Route not found');
    assertVisible(
      await tourneeSellerIds(this.scope, user, tx),
      [r.sellerId],
      ErrorCode.ROUTE_NOT_FOUND,
    );
    return r;
  }

  private async balances(clientIds: string[]): Promise<Map<string, string>> {
    if (clientIds.length === 0) return new Map();
    const rows = await this.prisma.db.clientBalance.findMany({
      where: { clientId: { in: clientIds } },
      select: { clientId: true, balance: true },
    });
    return new Map(rows.map((r) => [r.clientId, toMoneyString(r.balance.toString())]));
  }

  /** The latest visit that still counts (not corrected), whoever made it. */
  private async lastVisits(clientIds: string[]): Promise<Map<string, TodayStopDto['lastVisit']>> {
    if (clientIds.length === 0) return new Map();
    const tenantId = tenantContext.requireTenantId();
    const rows = await this.prisma.db.$queryRaw<
      {
        clientId: string;
        id: string;
        outcome: VisitOutcome;
        reason: NoSaleReason | null;
        startedAt: Date;
      }[]
    >`
      SELECT DISTINCT ON (v."clientId") v."clientId", v.id, v.outcome, v.reason, v."startedAt"
      FROM visits v
      WHERE v."tenantId" = ${tenantId}::uuid
        AND v."clientId" = ANY(${clientIds}::uuid[])
        AND NOT EXISTS (SELECT 1 FROM visits c WHERE c."correctsVisitId" = v.id)
      ORDER BY v."clientId", v."startedAt" DESC, v.id DESC`;
    return new Map(
      rows.map((r) => [
        r.clientId,
        { id: r.id, outcome: r.outcome, reason: r.reason, startedAt: r.startedAt.toISOString() },
      ]),
    );
  }

  private async lastSales(clientIds: string[]): Promise<Map<string, TodayStopDto['lastSale']>> {
    if (clientIds.length === 0) return new Map();
    const tenantId = tenantContext.requireTenantId();
    const rows = await this.prisma.db.$queryRaw<
      {
        clientId: string;
        id: string;
        number: string | null;
        totalTtc: Prisma.Decimal;
        validatedAt: Date;
      }[]
    >`
      SELECT DISTINCT ON (s."clientId") s."clientId", s.id, s.number, s."totalTtc", s."validatedAt"
      FROM sales s
      WHERE s."tenantId" = ${tenantId}::uuid
        AND s."clientId" = ANY(${clientIds}::uuid[])
        AND s.status = 'VALIDATED' AND s."validatedAt" IS NOT NULL
      ORDER BY s."clientId", s."validatedAt" DESC, s.id DESC`;
    return new Map(
      rows.map((r) => [
        r.clientId,
        {
          id: r.id,
          number: r.number,
          totalTtc: toMoneyString(r.totalTtc.toString()),
          validatedAt: r.validatedAt.toISOString(),
        },
      ]),
    );
  }

  /** The seller's latest sale, order and versement of the day per client (visit links). */
  private async documentsOn(
    sellerId: string,
    day: string,
    clientIds: string[],
  ): Promise<Map<string, TodayStopDto['today']>> {
    const out = new Map<string, TodayStopDto['today']>();
    if (clientIds.length === 0) return out;
    const { start, end } = algiersDayBounds(day);
    const [sales, orders, payments] = await Promise.all([
      this.prisma.db.sale.findMany({
        where: {
          clientId: { in: clientIds },
          sellerId,
          status: SaleStatus.VALIDATED,
          validatedAt: { gte: start, lt: end },
        },
        orderBy: { validatedAt: 'asc' },
        select: { id: true, clientId: true },
      }),
      this.prisma.db.order.findMany({
        where: {
          clientId: { in: clientIds },
          sellerId,
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: start, lt: end },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, clientId: true },
      }),
      this.prisma.db.payment.findMany({
        where: {
          clientId: { in: clientIds },
          collectedBy: sellerId,
          saleId: null,
          status: PaymentStatus.VALID,
          receivedAt: { gte: start, lt: end },
        },
        orderBy: { receivedAt: 'asc' },
        select: { id: true, clientId: true },
      }),
    ]);
    const slot = (clientId: string) => {
      let d = out.get(clientId);
      if (!d) {
        d = { saleId: null, orderId: null, paymentId: null };
        out.set(clientId, d);
      }
      return d;
    };
    // Ascending order: the last one written wins.
    for (const s of sales) if (s.clientId) slot(s.clientId).saleId = s.id;
    for (const o of orders) slot(o.clientId).orderId = o.id;
    for (const p of payments) if (p.clientId) slot(p.clientId).paymentId = p.id;
    return out;
  }

  private async visitedOn(
    sellerId: string,
    day: string,
    clientIds: string[],
  ): Promise<Set<string>> {
    if (clientIds.length === 0) return new Set();
    const { start, end } = algiersDayBounds(day);
    const rows = await this.prisma.db.visit.findMany({
      where: { sellerId, clientId: { in: clientIds }, startedAt: { gte: start, lt: end } },
      select: { clientId: true },
      distinct: ['clientId'],
    });
    return new Set(rows.map((r) => r.clientId));
  }
}
