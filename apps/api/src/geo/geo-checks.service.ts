import { Injectable } from '@nestjs/common';
import {
  addDays,
  algiersDayBounds,
  daysInMonth,
  ErrorCode,
  type GeoCheckDto,
  type GeoCheckListQuery,
  type GeoCheckPage,
  type GeoFlag,
  type GeoReportDto,
  type GeoReportRowDto,
  GeoReviewStatus,
  GeoStatus,
  type ReviewGeoCheckInput,
  Role,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';

const geoCheckInclude = {
  client: { select: { id: true, code: true, name: true } },
  reviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { note: true } },
} satisfies Prisma.GeoCheckInclude;
type GeoCheckRow = Prisma.GeoCheckGetPayload<{ include: typeof geoCheckInclude }>;

/** Statuses that needed a note, i.e. the "opérations signalées". */
const FLAGGED: GeoStatus[] = [
  GeoStatus.NO_SIGNAL,
  GeoStatus.MOCKED,
  GeoStatus.LOW_ACCURACY,
  GeoStatus.FAR,
];

/**
 * Flagged operations (phase 17): the list a manager reviews, the verdicts (append-only
 * GeoCheckReview rows, cached on the GeoCheck in the same transaction) and the monthly
 * report per seller that the incentive gates of phase 18 read.
 */
@Injectable()
export class GeoChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(query: GeoCheckListQuery, user: CurrentUserInfo): Promise<GeoCheckPage> {
    const ids = await this.reach(user);
    if (query.sellerId && ids && !ids.includes(query.sellerId)) {
      return { items: [], nextCursor: null };
    }
    const receivedAt: Prisma.DateTimeFilter = {};
    if (query.from) receivedAt.gte = algiersDayBounds(query.from).start;
    if (query.to) receivedAt.lt = algiersDayBounds(query.to).end;
    const rows = await this.prisma.db.geoCheck.findMany({
      where: {
        ...(query.sellerId ? { userId: query.sellerId } : ids ? { userId: { in: ids } } : {}),
        ...(query.status
          ? { status: query.status }
          : query.flaggedOnly
            ? { status: { in: FLAGGED } }
            : {}),
        ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
        ...(query.from || query.to ? { receivedAt } : {}),
      },
      include: geoCheckInclude,
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: await this.toDtos(page),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(id: string, user: CurrentUserInfo): Promise<GeoCheckDto> {
    const ids = await this.reach(user);
    const row = await this.prisma.db.geoCheck.findFirst({
      where: { id, ...(ids ? { userId: { in: ids } } : {}) },
      include: geoCheckInclude,
    });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Geo check not found');
    const [dto] = await this.toDtos([row]);
    return dto!;
  }

  /** A new verdict row; a later verdict replaces the cached one, history stays. */
  async review(
    id: string,
    input: ReviewGeoCheckInput,
    user: CurrentUserInfo,
  ): Promise<GeoCheckDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ reviewStatus: GeoReviewStatus }[]>`
        SELECT "reviewStatus" FROM geo_checks
        WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
        FOR UPDATE`;
      const before = locked[0];
      if (!before) throw new AppException(ErrorCode.NOT_FOUND, 'Geo check not found');
      const now = new Date();
      await tx.geoCheckReview.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          geoCheckId: id,
          verdict: input.verdict,
          note: input.note || null,
          reviewedBy: user.id,
          createdAt: now,
        },
      });
      await tx.geoCheck.update({
        where: { id },
        data: { reviewStatus: input.verdict, reviewedBy: user.id, reviewedAt: now },
      });
      await this.audit.log(tx, {
        action: 'GEO_CHECK_REVIEWED',
        entity: 'GeoCheck',
        entityId: id,
        before: { reviewStatus: before.reviewStatus },
        after: { reviewStatus: input.verdict, note: input.note ?? null },
      });
    });
    return this.get(id, user);
  }

  /** One row per user who had a check in the month (Africa/Algiers), busiest first. */
  async report(month: string, user: CurrentUserInfo): Promise<GeoReportDto> {
    const ids = await this.reach(user);
    const [year, m] = month.split('-').map(Number) as [number, number];
    const first = `${month}-01`;
    const start = algiersDayBounds(first).start;
    const end = algiersDayBounds(addDays(first, daysInMonth(year, m))).start;
    const groups = await this.prisma.db.geoCheck.groupBy({
      by: ['userId', 'status', 'reviewStatus'],
      where: {
        receivedAt: { gte: start, lt: end },
        userId: ids ? { in: ids } : { not: null },
      },
      _count: { _all: true },
    });
    const rows = new Map<string, Omit<GeoReportRowDto, 'user'>>();
    for (const g of groups) {
      if (!g.userId) continue;
      const r = rows.get(g.userId) ?? {
        total: 0,
        ok: 0,
        flagged: 0,
        far: 0,
        mocked: 0,
        notJustified: 0,
        pendingReview: 0,
      };
      const n = g._count._all;
      r.total += n;
      if (g.status === GeoStatus.OK) r.ok += n;
      if (FLAGGED.includes(g.status)) {
        r.flagged += n;
        if (g.reviewStatus === GeoReviewStatus.NONE) r.pendingReview += n;
      }
      if (g.status === GeoStatus.FAR) r.far += n;
      if (g.status === GeoStatus.MOCKED) r.mocked += n;
      if (g.reviewStatus === GeoReviewStatus.NOT_JUSTIFIED) r.notJustified += n;
      rows.set(g.userId, r);
    }
    const users = await this.users([...rows.keys()]);
    return {
      month,
      rows: [...rows.entries()]
        .map(([id, r]) => ({ user: users.get(id) ?? { id, fullName: '' }, ...r }))
        .sort((a, b) => b.flagged - a.flagged || b.total - a.total),
    };
  }

  /** Whose operations the user sees: a supervisor his team, managers everyone. */
  private async reach(user: CurrentUserInfo): Promise<string[] | null> {
    return user.role === Role.SUPERVISOR ? this.scope.teamIds(user.id) : null;
  }

  private async users(ids: string[]): Promise<Map<string, { id: string; fullName: string }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((u) => [u.id, u]));
  }

  private async toDtos(rows: GeoCheckRow[]): Promise<GeoCheckDto[]> {
    const users = await this.users([
      ...new Set(rows.flatMap((r) => [r.userId, r.reviewedBy]).filter((x): x is string => !!x)),
    ]);
    return rows.map((r) => ({
      id: r.id,
      refType: r.refType,
      refId: r.refId,
      refNumber: r.refNumber,
      user: r.userId ? (users.get(r.userId) ?? null) : null,
      client: r.client
        ? {
            id: r.client.id,
            code: r.client.code,
            name: r.client.name,
            // The point the distance was measured from, not today's.
            lat: r.clientLat?.toNumber() ?? null,
            lng: r.clientLng?.toNumber() ?? null,
          }
        : null,
      lat: r.lat?.toNumber() ?? null,
      lng: r.lng?.toNumber() ?? null,
      accuracyM: r.accuracyM,
      isMocked: r.isMocked,
      capturedAt: r.capturedAt?.toISOString() ?? null,
      receivedAt: r.receivedAt.toISOString(),
      distanceM: r.distanceM,
      status: r.status,
      flags: r.flags as GeoFlag[],
      note: r.note,
      reviewStatus: r.reviewStatus,
      reviewedBy: r.reviewedBy ? (users.get(r.reviewedBy) ?? null) : null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewNote: r.reviews[0]?.note ?? null,
    }));
  }
}
