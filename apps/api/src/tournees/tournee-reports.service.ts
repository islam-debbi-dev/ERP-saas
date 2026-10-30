import { Injectable } from '@nestjs/common';
import {
  algiersDayBounds,
  money,
  NO_SALE_REASONS,
  type NoSaleReason,
  toMoneyString,
  type TourneeReportDto,
  type TourneeReportQuery,
  type TourneeReportRowDto,
} from '@erp/shared';
import { type CurrentUserInfo } from '../auth/auth.types';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { fromIsoDate } from '../sales/sale.mapper';
import { ScopeService } from '../sales-force/scope.service';
import { tourneeSellerIds } from './tournee-scope';

type Counts = Omit<TourneeReportRowDto, 'seller' | 'visitRate' | 'strikeRate'>;

const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);

/**
 * Tournée reports (phase 16), per seller over a period of Algiers days:
 * - taux de visite: planned stops visited (a stop = a client of a route running that
 *   weekday; routes as they are today, they are not versioned);
 * - strike rate: visits with a sale or an order, over all visits (corrected visits do not
 *   count, their correction does);
 * - orders confirmed in the period and how many were delivered, short lines;
 * - écarts of the closed sessions (an adjustment with a new count replaces the écart).
 */
@Injectable()
export class TourneeReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async report(query: TourneeReportQuery, user: CurrentUserInfo): Promise<TourneeReportDto> {
    const ids = await tourneeSellerIds(this.scope, user);
    let sellers: string[] | null = ids;
    if (query.sellerId) {
      sellers = ids && !ids.includes(query.sellerId) ? [] : [query.sellerId];
    }
    if (sellers && sellers.length === 0) return { from: query.from, to: query.to, rows: [] };
    const t = tenantContext.requireTenantId();
    const start = algiersDayBounds(query.from).start;
    const end = algiersDayBounds(query.to).end;
    const from = fromIsoDate(query.from);
    const to = fromIsoDate(query.to);
    const only = (col: string) =>
      sellers ? Prisma.sql`AND ${Prisma.raw(col)} = ANY(${sellers}::uuid[])` : Prisma.empty;

    const [stops, visits, orders, closings] = await Promise.all([
      this.prisma.db.$queryRaw<{ sellerId: string; planned: bigint; visited: bigint }[]>`
        WITH days AS (
          SELECT d::date AS day, EXTRACT(DOW FROM d)::int AS dow
          FROM generate_series(${from}::date, ${to}::date, interval '1 day') d
        ),
        planned AS (
          SELECT DISTINCT r."sellerId", days.day, rs."clientId"
          FROM routes r
          JOIN route_stops rs ON rs."routeId" = r.id
          JOIN days ON days.dow = ANY(r.weekdays)
          WHERE r."tenantId" = ${t}::uuid AND r."deletedAt" IS NULL AND r.active
            ${only('r."sellerId"')}
        ),
        visited AS (
          SELECT DISTINCT v."sellerId", (v."startedAt" AT TIME ZONE 'Africa/Algiers')::date AS day,
            v."clientId"
          FROM visits v
          WHERE v."tenantId" = ${t}::uuid AND v."startedAt" >= ${start} AND v."startedAt" < ${end}
            AND NOT EXISTS (SELECT 1 FROM visits c WHERE c."correctsVisitId" = v.id)
        )
        SELECT p."sellerId", COUNT(*) AS planned, COUNT(v."clientId") AS visited
        FROM planned p
        LEFT JOIN visited v ON v."sellerId" = p."sellerId" AND v.day = p.day
          AND v."clientId" = p."clientId"
        GROUP BY p."sellerId"`,
      this.prisma.db.$queryRaw<
        { sellerId: string; outcome: string; reason: NoSaleReason | null; n: bigint }[]
      >`
        SELECT v."sellerId", v.outcome::text AS outcome, v.reason, COUNT(*) AS n
        FROM visits v
        WHERE v."tenantId" = ${t}::uuid AND v."startedAt" >= ${start} AND v."startedAt" < ${end}
          AND NOT EXISTS (SELECT 1 FROM visits c WHERE c."correctsVisitId" = v.id)
          ${only('v."sellerId"')}
        GROUP BY 1, 2, 3`,
      this.prisma.db.$queryRaw<
        {
          sellerId: string;
          orders: bigint;
          ordersTtc: Prisma.Decimal;
          delivered: bigint;
          deliveredTtc: Prisma.Decimal;
          shortLines: bigint;
        }[]
      >`
        SELECT o."sellerId",
          COUNT(*) AS orders,
          COALESCE(SUM(o."totalTtc"), 0) AS "ordersTtc",
          COUNT(*) FILTER (WHERE o.status = 'DELIVERED') AS delivered,
          COALESCE(SUM(s."totalTtc") FILTER (WHERE o.status = 'DELIVERED'), 0) AS "deliveredTtc",
          COALESCE(SUM((SELECT COUNT(*) FROM order_lines l
            WHERE l."orderId" = o.id AND l."qtyNotDelivered" > 0)), 0) AS "shortLines"
        FROM orders o
        LEFT JOIN sales s ON s.id = o."saleId"
        WHERE o."tenantId" = ${t}::uuid AND o."sellerId" IS NOT NULL
          AND o."confirmedAt" >= ${start} AND o."confirmedAt" < ${end}
          AND o.status <> 'CANCELLED'
          ${only('o."sellerId"')}
        GROUP BY o."sellerId"`,
      this.prisma.db.$queryRaw<{ sellerId: string; closings: bigint; ecart: Prisma.Decimal }[]>`
        SELECT s."sellerId", COUNT(*) AS closings,
          COALESCE(SUM(COALESCE((
            SELECT a.ecart FROM seller_sessions a
            WHERE a."adjustsSessionId" = s.id AND a.ecart IS NOT NULL
            ORDER BY a."createdAt" DESC, a.id DESC LIMIT 1), s.ecart)), 0) AS ecart
        FROM seller_sessions s
        WHERE s."tenantId" = ${t}::uuid AND s."adjustsSessionId" IS NULL
          AND s.status = 'CLOSED' AND s.date >= ${from}::date AND s.date <= ${to}::date
          ${only('s."sellerId"')}
        GROUP BY s."sellerId"`,
    ]);

    const rows = new Map<string, Counts>();
    const row = (id: string): Counts => {
      let r = rows.get(id);
      if (!r) {
        r = {
          plannedStops: 0,
          visitedStops: 0,
          visits: 0,
          productiveVisits: 0,
          noSale: Object.fromEntries(NO_SALE_REASONS.map((k) => [k, 0])) as Counts['noSale'],
          orders: 0,
          ordersTtc: '0.00',
          delivered: 0,
          deliveredTtc: '0.00',
          shortLines: 0,
          closings: 0,
          ecart: '0.00',
        };
        rows.set(id, r);
      }
      return r;
    };
    for (const s of stops) {
      const r = row(s.sellerId);
      r.plannedStops = Number(s.planned);
      r.visitedStops = Number(s.visited);
    }
    for (const v of visits) {
      const r = row(v.sellerId);
      const n = Number(v.n);
      r.visits += n;
      if (v.outcome === 'SALE' || v.outcome === 'ORDER') r.productiveVisits += n;
      if (v.reason) r.noSale[v.reason] += n;
    }
    for (const o of orders) {
      const r = row(o.sellerId);
      r.orders = Number(o.orders);
      r.ordersTtc = toMoneyString(o.ordersTtc.toString());
      r.delivered = Number(o.delivered);
      r.deliveredTtc = toMoneyString(o.deliveredTtc.toString());
      r.shortLines = Number(o.shortLines);
    }
    for (const c of closings) {
      const r = row(c.sellerId);
      r.closings = Number(c.closings);
      r.ecart = toMoneyString(money(c.ecart.toString()));
    }

    const users = await this.prisma.db.user.findMany({
      where: { id: { in: [...rows.keys()] } },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
    return {
      from: query.from,
      to: query.to,
      rows: users.map((u) => {
        const r = row(u.id);
        return {
          seller: u,
          ...r,
          visitRate: ratio(r.visitedStops, r.plannedStops),
          strikeRate: ratio(r.productiveVisits, r.visits),
        };
      }),
    };
  }
}
