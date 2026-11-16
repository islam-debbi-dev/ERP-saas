import { Injectable } from '@nestjs/common';
import {
  algiersDayBounds,
  type CreateVisitInput,
  ErrorCode,
  OrderStatus,
  PaymentStatus,
  SaleStatus,
  type VisitDto,
  type VisitListQuery,
  type VisitPage,
  GeoRefType,
  WarehouseType,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { GeoCheckService } from '../geo/geo-check.service';
import { type CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { VehiclesService } from '../stock/vehicles.service';
import { resolveTourneeSeller, tourneeSellerIds } from './tournee-scope';

const visitInclude = {
  seller: { select: { id: true, fullName: true } },
  client: { select: { id: true, code: true, name: true } },
  vehicle: { select: { id: true, code: true, name: true } },
  correctedBy: { select: { id: true } },
} satisfies Prisma.VisitInclude;

type VisitRow = Prisma.VisitGetPayload<{ include: typeof visitInclude }>;

function toDto(v: VisitRow): VisitDto {
  return {
    id: v.id,
    seller: v.seller,
    client: v.client,
    routeId: v.routeId,
    vehicle: v.vehicle,
    startedAt: v.startedAt.toISOString(),
    endedAt: v.endedAt?.toISOString() ?? null,
    outcome: v.outcome,
    reason: v.reason,
    note: v.note,
    saleId: v.saleId,
    orderId: v.orderId,
    paymentId: v.paymentId,
    correctsVisitId: v.correctsVisitId,
    corrected: v.correctedBy !== null,
    createdAt: v.createdAt.toISOString(),
  };
}

const invalid = (rule: string, details: Record<string, unknown> = {}) =>
  new AppException(ErrorCode.VISIT_INVALID, 'Invalid visit', { rule, ...details });

/**
 * Visites (phase 16): append-only, never updated (the tenant extension refuses it). A
 * correction is a new visit pointing to the one it replaces; only the last of a chain
 * counts. The POST is idempotent (the mobile app replays). Each visit freezes the truck its
 * seller drove when it started (phase 36): a later driver change never rewrites it.
 */
@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly geo: GeoCheckService,
    private readonly vehicles: VehiclesService,
  ) {}

  async create(input: CreateVisitInput, user: CurrentUserInfo): Promise<VisitDto> {
    const { id, geoCheck } = await this.prisma.db.$transaction(async (tx) => {
      const sellerId = await resolveTourneeSeller(tx, this.scope, user, input.sellerId);
      const client = await tx.client.findFirst({
        where: { id: input.clientId, deletedAt: null },
        select: { id: true },
      });
      if (!client) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
      await this.scope.assertClient(tx, user, input.clientId);
      const startedAt = new Date(input.startedAt);
      const { corrected, saleLeft } = await this.checkLinks(tx, input, sellerId);
      // Frozen now. A visit with a sale of this seller names the truck the goods left (none
      // when they left a dépôt): the sale and its visit never split over two trucks, even
      // when the driver changed between the door and the sale (test-36 C-1). Else a
      // correction keeps the truck of the visit it replaces, else the history at startedAt.
      const vehicleId = saleLeft
        ? saleLeft.vehicleId
        : corrected
          ? corrected.vehicleId
          : await this.vehicles.vehicleOfUserAt(sellerId, startedAt, tx);
      await this.checkRoute(tx, input.routeId, sellerId, vehicleId);
      const v = await tx.visit.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          sellerId,
          clientId: input.clientId,
          routeId: input.routeId,
          vehicleId,
          startedAt,
          endedAt: input.endedAt ? new Date(input.endedAt) : null,
          outcome: input.outcome,
          reason: input.reason,
          note: input.note,
          saleId: input.saleId,
          orderId: input.orderId,
          paymentId: input.paymentId,
          correctsVisitId: input.correctsVisitId,
          createdBy: user.id,
        },
      });
      await this.audit.log(tx, {
        action: input.correctsVisitId ? 'VISIT_CORRECTED' : 'VISIT_RECORDED',
        entity: 'Visit',
        entityId: v.id,
        after: { ...input, geo: undefined, sellerId, vehicleId },
      });
      const geoCheck = await this.geo.checkInTx(tx, {
        refType: GeoRefType.VISIT,
        refId: v.id,
        clientId: input.clientId,
        geo: input.geo,
        user,
      });
      return { id: v.id, geoCheck };
    });
    return { ...(await this.get(id, user)), geoCheck };
  }

  async get(id: string, user: CurrentUserInfo): Promise<VisitDto> {
    const ids = await tourneeSellerIds(this.scope, user);
    const v = await this.prisma.db.visit.findFirst({
      where: { id, ...(ids ? { sellerId: { in: ids } } : {}) },
      include: visitInclude,
    });
    if (!v) throw new AppException(ErrorCode.NOT_FOUND, 'Visit not found');
    return toDto(v);
  }

  async list(query: VisitListQuery, user: CurrentUserInfo): Promise<VisitPage> {
    const ids = await tourneeSellerIds(this.scope, user);
    // A seller filter outside the user's reach gives nothing, never more.
    if (query.sellerId && ids && !ids.includes(query.sellerId)) {
      return { items: [], nextCursor: null };
    }
    const startedAt: Prisma.DateTimeFilter = {};
    if (query.from) startedAt.gte = algiersDayBounds(query.from).start;
    if (query.to) startedAt.lt = algiersDayBounds(query.to).end;
    const rows = await this.prisma.db.visit.findMany({
      where: {
        ...(query.sellerId ? { sellerId: query.sellerId } : ids ? { sellerId: { in: ids } } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
        ...(query.from || query.to ? { startedAt } : {}),
      },
      include: visitInclude,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toDto),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * The route of a visit is one of the seller's: an old seller route of his, or the route
   * of the truck he drove then (or drives now, for a visit typed in later).
   */
  private async checkRoute(
    tx: Tx,
    routeId: string | null,
    sellerId: string,
    vehicleId: string | null,
  ): Promise<void> {
    if (!routeId) return;
    const r = await tx.route.findFirst({
      where: { id: routeId, deletedAt: null },
      select: { sellerId: true, vehicleId: true },
    });
    if (!r) throw invalid('route_not_of_seller');
    if (!r.vehicleId) {
      if (r.sellerId !== sellerId) throw invalid('route_not_of_seller');
      return;
    }
    if (r.vehicleId === vehicleId) return;
    const current = await this.vehicles.currentVehicleOf(sellerId, tx);
    if (current?.id !== r.vehicleId) throw invalid('route_not_of_seller');
  }

  /**
   * Every id the visit points to must exist, be live, and belong to this seller and client.
   * Returns the visit being corrected, when there is one, and where the linked sale left
   * from when it is a sale of this seller (`vehicleId` null = a dépôt, not a truck).
   */
  private async checkLinks(
    tx: Tx,
    input: CreateVisitInput,
    sellerId: string,
  ): Promise<{
    corrected: { vehicleId: string | null } | null;
    saleLeft: { vehicleId: string | null } | null;
  }> {
    let saleLeft: { vehicleId: string | null } | null = null;
    if (input.saleId) {
      const s = await tx.sale.findFirst({
        where: { id: input.saleId },
        select: {
          clientId: true,
          status: true,
          sellerId: true,
          warehouse: { select: { id: true, type: true } },
        },
      });
      if (!s || s.clientId !== input.clientId || s.status !== SaleStatus.VALIDATED) {
        throw invalid('sale_not_of_client');
      }
      if (s.sellerId === sellerId && s.warehouse) {
        saleLeft = {
          vehicleId: s.warehouse.type === WarehouseType.VEHICLE ? s.warehouse.id : null,
        };
      }
    }
    if (input.orderId) {
      const o = await tx.order.findFirst({
        where: { id: input.orderId },
        select: { clientId: true, sellerId: true, status: true },
      });
      if (
        !o ||
        o.clientId !== input.clientId ||
        o.sellerId !== sellerId ||
        o.status === OrderStatus.CANCELLED
      ) {
        throw invalid('order_not_of_client');
      }
    }
    if (input.paymentId) {
      const p = await tx.payment.findFirst({
        where: { id: input.paymentId },
        select: { clientId: true, status: true },
      });
      if (!p || p.clientId !== input.clientId || p.status !== PaymentStatus.VALID) {
        throw invalid('payment_not_of_client');
      }
    }
    if (input.correctsVisitId) {
      // Locked so two corrections of the same visit cannot both pass the check.
      const rows = await tx.$queryRaw<
        { sellerId: string; clientId: string; vehicleId: string | null }[]
      >`
        SELECT "sellerId", "clientId", "vehicleId" FROM visits
        WHERE id = ${input.correctsVisitId}::uuid
          AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
        FOR UPDATE`;
      const target = rows[0];
      if (!target || target.sellerId !== sellerId || target.clientId !== input.clientId) {
        throw invalid('corrects_other_visit');
      }
      const already = await tx.visit.findFirst({
        where: { correctsVisitId: input.correctsVisitId },
        select: { id: true },
      });
      if (already) throw invalid('already_corrected', { visitId: already.id });
      return { corrected: { vehicleId: target.vehicleId }, saleLeft };
    }
    return { corrected: null, saleLeft };
  }
}
