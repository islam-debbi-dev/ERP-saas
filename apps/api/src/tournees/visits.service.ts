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
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { type CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { resolveTourneeSeller, tourneeSellerIds } from './tournee-scope';

const visitInclude = {
  seller: { select: { id: true, fullName: true } },
  client: { select: { id: true, code: true, name: true } },
  correctedBy: { select: { id: true } },
} satisfies Prisma.VisitInclude;

type VisitRow = Prisma.VisitGetPayload<{ include: typeof visitInclude }>;

function toDto(v: VisitRow): VisitDto {
  return {
    id: v.id,
    seller: v.seller,
    client: v.client,
    routeId: v.routeId,
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
 * counts. The POST is idempotent (the mobile app replays).
 */
@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateVisitInput, user: CurrentUserInfo): Promise<VisitDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const sellerId = await resolveTourneeSeller(tx, this.scope, user, input.sellerId);
      const client = await tx.client.findFirst({
        where: { id: input.clientId, deletedAt: null },
        select: { id: true },
      });
      if (!client) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
      await this.scope.assertClient(tx, user, input.clientId);
      await this.checkLinks(tx, input, sellerId);
      const v = await tx.visit.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          sellerId,
          clientId: input.clientId,
          routeId: input.routeId,
          startedAt: new Date(input.startedAt),
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
        after: { ...input, sellerId },
      });
      return v.id;
    });
    return this.get(id, user);
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

  /** Every id the visit points to must exist, be live, and belong to this seller and client. */
  private async checkLinks(tx: Tx, input: CreateVisitInput, sellerId: string): Promise<void> {
    if (input.routeId) {
      const r = await tx.route.findFirst({
        where: { id: input.routeId, deletedAt: null },
        select: { sellerId: true },
      });
      if (!r || r.sellerId !== sellerId) throw invalid('route_not_of_seller');
    }
    if (input.saleId) {
      const s = await tx.sale.findFirst({
        where: { id: input.saleId },
        select: { clientId: true, status: true },
      });
      if (!s || s.clientId !== input.clientId || s.status !== SaleStatus.VALIDATED) {
        throw invalid('sale_not_of_client');
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
      const rows = await tx.$queryRaw<{ sellerId: string; clientId: string }[]>`
        SELECT "sellerId", "clientId" FROM visits
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
    }
  }
}
