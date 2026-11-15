import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  algiersDayBounds,
  type ConvertRoutesResultDto,
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
import { VehiclesService } from '../stock/vehicles.service';
import { resolveTourneeSeller, routeVisible, routeWhere, tourneeRouteReach } from './tournee-scope';

const routeInclude = {
  seller: { select: { id: true, fullName: true } },
  vehicle: {
    select: {
      id: true,
      code: true,
      name: true,
      wilayaCode: true,
      vehicleType: { select: { id: true, code: true, name: true, activity: true } },
      assignedUser: { select: { id: true, fullName: true } },
    },
  },
  _count: { select: { stops: true } },
} satisfies Prisma.RouteInclude;

type RouteRow = Prisma.RouteGetPayload<{ include: typeof routeInclude }>;

function toDto(
  r: RouteRow,
  stops: RouteDto['stops'] = [],
  start: RouteDto['start'] = null,
): RouteDto {
  return {
    id: r.id,
    name: r.name,
    seller: r.seller,
    vehicle: r.vehicle
      ? {
          id: r.vehicle.id,
          code: r.vehicle.code,
          name: r.vehicle.name,
          wilayaCode: r.vehicle.wilayaCode,
          type: r.vehicle.vehicleType,
          driver: r.vehicle.assignedUser,
        }
      : null,
    weekdays: r.weekdays,
    active: r.active,
    stopCount: r._count.stops,
    stops,
    start,
  };
}

/**
 * Tournées (phase 16): master data, soft-deleted. The stops are an ordered list replaced
 * as a whole. A tournée is planned for a truck (phase 36): whoever drives it today does it,
 * with no edit when the driver changes. Old routes stay planned for a seller. Planners
 * manage them within the reach written in `tournee-scope.ts`; a seller reads his own.
 */
@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly vehicles: VehiclesService,
  ) {}

  async list(query: RouteListQuery, user: CurrentUserInfo): Promise<RouteDto[]> {
    const reach = await tourneeRouteReach(this.scope, this.vehicles, user);
    const rows = await this.prisma.db.route.findMany({
      where: {
        // A filter outside the user's reach gives nothing, never more.
        AND: [
          { deletedAt: null },
          routeWhere(reach),
          query.sellerId ? { sellerId: query.sellerId } : {},
          query.vehicleId ? { vehicleId: query.vehicleId } : {},
          query.weekday !== undefined ? { weekdays: { has: query.weekday } } : {},
        ],
      },
      include: routeInclude,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => toDto(r));
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
              select: {
                id: true,
                code: true,
                name: true,
                commune: true,
                phone: true,
                lat: true,
                lng: true,
              },
            },
          },
        },
      },
    });
    if (!r || !routeVisible(await tourneeRouteReach(this.scope, this.vehicles, user), r)) {
      throw new AppException(ErrorCode.ROUTE_NOT_FOUND, 'Route not found');
    }
    return toDto(
      r,
      r.stops.map((s) => ({
        position: s.position,
        client: {
          ...s.client,
          lat: s.client.lat?.toNumber() ?? null,
          lng: s.client.lng?.toNumber() ?? null,
        },
      })),
      r.vehicleId
        ? await this.vehicles.startPoint(r.vehicleId)
        : r.sellerId
          ? await this.scope.sellerDepotPoint(r.sellerId)
          : null,
    );
  }

  async create(input: CreateRouteInput, user: CurrentUserInfo): Promise<RouteDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const owner = await this.resolveOwner(tx, user, input.vehicleId, input.sellerId);
      const r = await tx.route.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          name: input.name,
          ...owner,
          weekdays: input.weekdays,
          active: input.active,
        },
      });
      await this.audit.log(tx, {
        action: 'ROUTE_CREATED',
        entity: 'Route',
        entityId: r.id,
        after: { ...input, ...owner },
      });
      return r.id;
    });
    return this.get(id, user);
  }

  async update(id: string, input: UpdateRouteInput, user: CurrentUserInfo): Promise<RouteDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.live(tx, id, user);
      // A vehicle wins over a seller; a route never ends up with neither.
      const vehicleId = input.vehicleId !== undefined ? input.vehicleId : before.vehicleId;
      const sellerId = vehicleId
        ? null
        : input.sellerId !== undefined
          ? input.sellerId
          : before.sellerId;
      const ownerChanged = vehicleId !== before.vehicleId || sellerId !== before.sellerId;
      const owner = ownerChanged
        ? await this.resolveOwner(tx, user, vehicleId ?? undefined, sellerId ?? undefined)
        : null;
      await tx.route.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(owner ?? {}),
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
          vehicleId: before.vehicleId,
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

  /**
   * "Convertir en tournée véhicule": an old seller route becomes the route of the truck its
   * seller drives now. Refused when he drives none. Converting twice changes nothing.
   */
  async convertToVehicle(id: string, user: CurrentUserInfo): Promise<RouteDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.live(tx, id, user);
      const done = await this.convert(tx, [id]);
      if (done.skipped > 0) {
        throw new AppException(ErrorCode.SELLER_HAS_NO_VEHICLE, 'This seller drives no truck');
      }
    });
    return this.get(id, user);
  }

  /** Every seller route in the user's reach whose seller drives a truck. Idempotent. */
  async convertAllToVehicle(user: CurrentUserInfo): Promise<ConvertRoutesResultDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const reach = await tourneeRouteReach(this.scope, this.vehicles, user, tx);
      const rows = await tx.route.findMany({
        where: { AND: [{ deletedAt: null, vehicleId: null }, routeWhere(reach)] },
        select: { id: true },
      });
      return this.convert(
        tx,
        rows.map((r) => r.id),
      );
    });
  }

  /** Under the row locks (in id order): the routes still planned for a seller get his truck. */
  private async convert(tx: Tx, ids: string[]): Promise<ConvertRoutesResultDto> {
    if (ids.length === 0) return { converted: 0, skipped: 0 };
    const rows = await tx.$queryRaw<{ id: string; sellerId: string | null }[]>`
      SELECT id, "sellerId" FROM routes
      WHERE id = ANY(${ids}::uuid[]) AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
        AND "deletedAt" IS NULL AND "vehicleId" IS NULL
      ORDER BY id
      FOR UPDATE`;
    const trucks = await this.vehicles.currentVehiclesOf(
      [...new Set(rows.map((r) => r.sellerId).filter((s): s is string => s !== null))],
      tx,
    );
    let converted = 0;
    for (const r of rows) {
      const truck = r.sellerId ? trucks.get(r.sellerId) : undefined;
      if (!truck) continue;
      await tx.route.update({
        where: { id: r.id },
        data: { vehicleId: truck.id, sellerId: null },
      });
      await this.audit.log(tx, {
        action: 'ROUTE_CONVERTED',
        entity: 'Route',
        entityId: r.id,
        before: { sellerId: r.sellerId, vehicleId: null },
        after: { sellerId: null, vehicleId: truck.id },
      });
      converted += 1;
    }
    return { converted, skipped: rows.length - converted };
  }

  /**
   * Who a tournée is planned for: a live truck in the planner's reach (the seller is then
   * ignored and stored null), else a seller as before phase 36. Neither: ROUTE_NEEDS_OWNER.
   */
  private async resolveOwner(
    tx: Tx,
    user: CurrentUserInfo,
    vehicleId: string | undefined,
    sellerId: string | undefined,
  ): Promise<{ vehicleId: string | null; sellerId: string | null }> {
    if (vehicleId) {
      await this.vehicles.assertVehicle(tx, vehicleId);
      await this.vehicles.assertPlanned(tx, user, vehicleId);
      return { vehicleId, sellerId: null };
    }
    if (!sellerId) {
      throw new AppException(
        ErrorCode.ROUTE_NEEDS_OWNER,
        'A route is planned for a vehicle or for a seller',
      );
    }
    return {
      vehicleId: null,
      sellerId: await resolveTourneeSeller(tx, this.scope, user, sellerId),
    };
  }

  /**
   * Replaces the ordered stops. Clients must be live and within the user's scope.
   * With `baseClientIds`, only if the route still holds that list (409 otherwise).
   */
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
      // Under the row lock: the list the caller started from must still be the list.
      const base = input.baseClientIds;
      if (
        base &&
        (base.length !== before.length || base.some((c, i) => c !== before[i]!.clientId))
      ) {
        throw new AppException(
          ErrorCode.ROUTE_STOPS_CHANGED,
          'The stops of this route changed since they were read',
        );
      }
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
   * The caller's tournée of today (Algiers): the active routes of this weekday planned for
   * the truck he drives now, plus his old seller routes; stops in route then stop order,
   * each client once. A new driver sees the truck's tournée at once, with no route edit.
   */
  async today(user: CurrentUserInfo): Promise<TodayDto> {
    const day = algiersDay(this.clock.now());
    const weekday = weekdayOf(day);
    const vehicle = await this.vehicles.currentVehicleOf(user.id);
    const routes = await this.prisma.db.route.findMany({
      where: {
        active: true,
        deletedAt: null,
        weekdays: { has: weekday },
        OR: [
          { vehicleId: null, sellerId: user.id },
          ...(vehicle ? [{ vehicleId: vehicle.id }] : []),
        ],
      },
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
                lat: true,
                lng: true,
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
        const { deletedAt: _archived, lat, lng, ...client } = s.client;
        stops.push({
          routeId: r.id,
          position: s.position,
          client: { ...client, lat: lat?.toNumber() ?? null, lng: lng?.toNumber() ?? null },
        });
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
      vehicle,
      routes: routes.map((r) => ({ id: r.id, name: r.name })),
      stops: out,
      planned: out.length,
      visited: out.filter((s) => s.visitedToday).length,
    };
  }

  private async live(tx: Tx, id: string, user: CurrentUserInfo) {
    const r = await tx.route.findFirst({ where: { id, deletedAt: null } });
    if (!r || !routeVisible(await tourneeRouteReach(this.scope, this.vehicles, user, tx), r)) {
      throw new AppException(ErrorCode.ROUTE_NOT_FOUND, 'Route not found');
    }
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
