import { Injectable } from '@nestjs/common';
import {
  IncentiveMetric,
  metricKey,
  type MetricRef,
  type MetricScope,
  type MetricValues,
  money,
  type Money,
  scopeKey,
} from '@erp/shared';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { within } from '../reports/reports-sql';

/** A half-open instant range: [start, end). */
export interface Period {
  start: Date;
  end: Date;
}

/** Raw components of one user's figures; ratios are derived after summing (teams). */
type Components = Map<string, Money>;

/** Everyone's components for a period, plus the unit factors of PER_UNIT rules. */
export interface Figures {
  byUser: Map<string, Components>;
  factors: Map<string, Money>;
}

const LINE_METRICS = new Set<IncentiveMetric>([
  IncentiveMetric.CA_HT,
  IncentiveMetric.QTY,
  IncentiveMetric.MARGE,
]);

const ZERO = money(0);
const HUNDRED = money(100);

/** A sale whose lines are copies of BLs (a facture made from BLs): its BLs count. */
function notGrouper(alias: string): Prisma.Sql {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM sale_lines gl
    WHERE gl."saleId" = ${Prisma.raw(alias)}.id AND gl."sourceLineId" IS NOT NULL)`;
}

const sellerOf = (alias: string) =>
  Prisma.raw(`COALESCE(${alias}."sellerId", ${alias}."createdBy")`);

/**
 * The figures objectives and bonuses are measured on (phase 18), per user, from the
 * documents that already exist. Raw SQL over the indexed (tenantId, …, date) columns;
 * every fragment takes the tenant id explicitly (raw SQL bypasses the tenant extension).
 *
 * Counting rules (PR "Decisions"), chosen so an approved month is never rewritten:
 * - a sale counts at its validation; if it is cancelled later, what was left of it (not
 *   yet returned) is taken back in the month of the cancellation;
 * - an avoir counts in the month it is made, at its frozen prices, for the seller of
 *   the sale (of the BL when the avoir is on a facture made from BLs);
 * - a facture made from BLs never counts (its BLs did);
 * - a versement counts when received; a cancel or a bounce takes it back in its month;
 * - legacy sales / versements (no seller / collector) count for their creator / receiver.
 */
@Injectable()
export class IncentiveMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every user's components for these figures in the period. */
  async compute(refs: readonly MetricRef[], period: Period): Promise<Figures> {
    const tenantId = tenantContext.requireTenantId();
    const out = new Map<string, Components>();
    const add = (userId: string | null, key: string, v: Prisma.Decimal | bigint | null) => {
      if (!userId || v === null) return;
      let c = out.get(userId);
      if (!c) out.set(userId, (c = new Map<string, Money>()));
      c.set(key, (c.get(key) ?? ZERO).plus(money(v.toString())));
    };
    const metrics = new Set(refs.map((r) => r.metric));

    // Line figures, once per distinct scope.
    const scopes = new Map<string, MetricScope | undefined>();
    for (const r of refs) if (LINE_METRICS.has(r.metric)) scopes.set(scopeKey(r.scope), r.scope);
    for (const [key, scope] of scopes) {
      for (const row of await this.lineFigures(tenantId, scope, period)) {
        add(row.seller, `ht@${key}`, row.ht);
        add(row.seller, `cost@${key}`, row.cost);
        add(row.seller, `qty@${key}`, row.qty);
      }
    }

    if (metrics.has(IncentiveMetric.ENCAISSEMENT) || metrics.has(IncentiveMetric.RECOUVREMENT_PCT)) {
      for (const row of await this.collections(tenantId, period)) {
        add(row.userId, 'enc', row.enc);
        add(row.userId, 'recov', row.recov);
      }
    }
    if (metrics.has(IncentiveMetric.RECOUVREMENT_PCT)) {
      for (const row of await this.creditPart(tenantId, period)) add(row.seller, 'credit', row.credit);
    }
    if (metrics.has(IncentiveMetric.NEW_CLIENTS)) {
      for (const row of await this.newClients(tenantId, period)) add(row.seller, 'newClients', row.n);
    }
    if (metrics.has(IncentiveMetric.VISITS) || metrics.has(IncentiveMetric.STRIKE_RATE)) {
      for (const row of await this.visits(tenantId, period)) {
        add(row.sellerId, 'visits', row.visits);
        add(row.sellerId, 'productive', row.productive);
      }
    }
    if (metrics.has(IncentiveMetric.GEO_FLAGS)) {
      for (const row of await this.geoFlags(tenantId, period)) add(row.userId, 'geo', row.n);
    }
    return { byUser: out, factors: await this.unitFactors(refs) };
  }

  /**
   * The figures of one user, or of a team (the sum of its members' components, ratios
   * recomputed from the sums), keyed by `metricKey`.
   */
  values(figures: Figures, refs: readonly MetricRef[], userIds: readonly string[]): MetricValues {
    const sum = (k: string) =>
      userIds.reduce((s, id) => s.plus(figures.byUser.get(id)?.get(k) ?? ZERO), ZERO);
    const factors = figures.factors;
    const out: Record<string, string> = {};
    for (const ref of refs) {
      const s = scopeKey(ref.scope);
      let v: Money;
      switch (ref.metric) {
        case IncentiveMetric.CA_HT:
          v = sum(`ht@${s}`);
          break;
        case IncentiveMetric.MARGE:
          v = sum(`ht@${s}`).minus(sum(`cost@${s}`));
          break;
        case IncentiveMetric.QTY:
          v = sum(`qty@${s}`);
          if (ref.unitId) v = v.div(factors.get(ref.unitId) ?? money(1));
          break;
        case IncentiveMetric.ENCAISSEMENT:
          v = sum('enc');
          break;
        case IncentiveMetric.RECOUVREMENT_PCT: {
          const credit = sum('credit');
          v = credit.gt(0) ? sum('recov').div(credit).times(HUNDRED) : HUNDRED;
          break;
        }
        case IncentiveMetric.NEW_CLIENTS:
          v = sum('newClients');
          break;
        case IncentiveMetric.VISITS:
          v = sum('visits');
          break;
        case IncentiveMetric.STRIKE_RATE: {
          const visits = sum('visits');
          v = visits.gt(0) ? sum('productive').div(visits).times(HUNDRED) : ZERO;
          break;
        }
        case IncentiveMetric.GEO_FLAGS:
          v = sum('geo');
          break;
      }
      out[metricKey(ref)] = v.toString();
    }
    return out;
  }

  /** How many base units one "carton" of each PER_UNIT rule is (product unit factors). */
  private async unitFactors(refs: readonly MetricRef[]): Promise<Map<string, Money>> {
    const wanted = refs.filter((r) => r.unitId && r.scope?.productId);
    if (wanted.length === 0) return new Map();
    const units = await this.prisma.db.productUnit.findMany({
      where: {
        OR: wanted.map((r) => ({ unitId: r.unitId!, productId: r.scope!.productId! })),
      },
      select: { unitId: true, factorToBase: true },
    });
    return new Map(units.map((u) => [u.unitId, money(u.factorToBase.toString())]));
  }

  private lineFigures(tenantId: string, scope: MetricScope | undefined, p: Period) {
    const filters: Prisma.Sql[] = [];
    if (scope?.brandId) filters.push(Prisma.sql`pr."brandId" = ${scope.brandId}::uuid`);
    if (scope?.productId) filters.push(Prisma.sql`f."productId" = ${scope.productId}::uuid`);
    if (scope?.categoryId) {
      // The category and its sub-categories.
      filters.push(Prisma.sql`pr."categoryId" IN (
        WITH RECURSIVE tree AS (
          SELECT id FROM categories WHERE id = ${scope.categoryId}::uuid AND "tenantId" = ${tenantId}::uuid
          UNION SELECT c.id FROM categories c JOIN tree t ON c."parentId" = t.id
        ) SELECT id FROM tree)`);
    }
    const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;
    return this.prisma.db.$queryRaw<
      { seller: string | null; ht: Prisma.Decimal; cost: Prisma.Decimal; qty: Prisma.Decimal }[]
    >`
      SELECT f.seller, SUM(f.ht) AS ht, SUM(f.cost) AS cost, SUM(f.qty) AS qty
      FROM (
        SELECT ${sellerOf('s')} AS seller, l."productId", l."lineHt" AS ht, l."qtyBase" AS qty,
               l."qtyBase" * l."unitCostBase" AS cost
        FROM sale_lines l JOIN sales s ON s.id = l."saleId"
        WHERE s."tenantId" = ${tenantId}::uuid AND s.status IN ('VALIDATED', 'CANCELLED')
          AND ${within('s."validatedAt"', p.start, p.end)} AND l."sourceLineId" IS NULL
        UNION ALL
        SELECT ${sellerOf('s')}, l."productId", -(l."lineHt" - COALESCE(r.ht, 0)),
               -(l."qtyBase" - COALESCE(r.qty, 0)), -(l."qtyBase" - COALESCE(r.qty, 0)) * l."unitCostBase"
        FROM sale_lines l JOIN sales s ON s.id = l."saleId"
        LEFT JOIN LATERAL (
          SELECT SUM(rl."lineHt") AS ht, SUM(rl."qtyBase") AS qty
          FROM sale_return_lines rl WHERE rl."saleLineId" = l.id
        ) r ON TRUE
        WHERE s."tenantId" = ${tenantId}::uuid AND s.status = 'CANCELLED'
          AND s."validatedAt" IS NOT NULL AND ${within('s."cancelledAt"', p.start, p.end)}
          AND l."sourceLineId" IS NULL
        UNION ALL
        SELECT CASE WHEN bs.id IS NOT NULL THEN ${sellerOf('bs')} ELSE ${sellerOf('s')} END,
               rl."productId", -rl."lineHt", -rl."qtyBase",
               CASE WHEN r.disposition = 'RESTOCK' THEN -rl."qtyBase" * sl."unitCostBase" ELSE 0 END
        FROM sale_return_lines rl
        JOIN sale_returns r ON r.id = rl."returnId"
        JOIN sale_lines sl ON sl.id = rl."saleLineId"
        JOIN sales s ON s.id = r."saleId"
        LEFT JOIN sale_lines bl ON bl.id = sl."sourceLineId"
        LEFT JOIN sales bs ON bs.id = bl."saleId"
        WHERE r."tenantId" = ${tenantId}::uuid AND ${within('r."createdAt"', p.start, p.end)}
      ) f
      JOIN products pr ON pr.id = f."productId"
      ${where}
      GROUP BY f.seller`;
  }

  /** `enc`: every versement; `recov`: only those not paid at the sale (recouvrement). */
  private collections(tenantId: string, p: Period) {
    const who = Prisma.raw('COALESCE("collectedBy", "receivedBy")');
    return this.prisma.db.$queryRaw<
      { userId: string | null; enc: Prisma.Decimal; recov: Prisma.Decimal | null }[]
    >`
      SELECT f."userId", SUM(f.amount) AS enc,
             COALESCE(SUM(f.amount) FILTER (WHERE f."saleId" IS NULL), 0) AS recov
      FROM (
        SELECT ${who} AS "userId", amount, "saleId" FROM payments
        WHERE "tenantId" = ${tenantId}::uuid AND ${within('"receivedAt"', p.start, p.end)}
        UNION ALL
        SELECT ${who}, -amount, "saleId" FROM payments
        WHERE "tenantId" = ${tenantId}::uuid AND status = 'CANCELLED'
          AND ${within('"cancelledAt"', p.start, p.end)}
        UNION ALL
        SELECT ${who}, -amount, "saleId" FROM payments
        WHERE "tenantId" = ${tenantId}::uuid AND status = 'BOUNCED'
          AND ${within('"bouncedAt"', p.start, p.end)}
      ) f
      GROUP BY f."userId"`;
  }

  /** What the period's sales left on credit: TTC − paid at the sale (clients only). */
  private creditPart(tenantId: string, p: Period) {
    return this.prisma.db.$queryRaw<{ seller: string | null; credit: Prisma.Decimal }[]>`
      SELECT f.seller, SUM(f.credit) AS credit
      FROM (
        SELECT ${sellerOf('s')} AS seller, s."totalTtc" - s."paidAmount" AS credit
        FROM sales s
        WHERE s."tenantId" = ${tenantId}::uuid AND s.status IN ('VALIDATED', 'CANCELLED')
          AND s."clientId" IS NOT NULL AND ${within('s."validatedAt"', p.start, p.end)}
          AND ${notGrouper('s')}
        UNION ALL
        SELECT ${sellerOf('s')}, -(s."totalTtc" - s."paidAmount")
        FROM sales s
        WHERE s."tenantId" = ${tenantId}::uuid AND s.status = 'CANCELLED'
          AND s."clientId" IS NOT NULL AND s."validatedAt" IS NOT NULL
          AND ${within('s."cancelledAt"', p.start, p.end)} AND ${notGrouper('s')}
      ) f
      GROUP BY f.seller`;
  }

  /** Clients whose first ever validated sale falls in the period, for its seller. */
  private newClients(tenantId: string, p: Period) {
    return this.prisma.db.$queryRaw<{ seller: string | null; n: bigint }[]>`
      SELECT f.seller, COUNT(*) AS n
      FROM (
        SELECT DISTINCT ON (s."clientId") s."clientId", ${sellerOf('s')} AS seller, s."validatedAt"
        FROM sales s
        WHERE s."tenantId" = ${tenantId}::uuid AND s.status = 'VALIDATED'
          AND s."validatedAt" IS NOT NULL AND ${notGrouper('s')}
          AND s."clientId" IN (
            SELECT x."clientId" FROM sales x
            WHERE x."tenantId" = ${tenantId}::uuid AND x.status = 'VALIDATED'
              AND ${within('x."validatedAt"', p.start, p.end)} AND x."clientId" IS NOT NULL)
        ORDER BY s."clientId", s."validatedAt", s.id
      ) f
      WHERE ${within('f."validatedAt"', p.start, p.end)}
      GROUP BY f.seller`;
  }

  /** Visits (a corrected visit counts through its correction) and those with a sale or order. */
  private visits(tenantId: string, p: Period) {
    return this.prisma.db.$queryRaw<{ sellerId: string; visits: bigint; productive: bigint }[]>`
      SELECT v."sellerId", COUNT(*) AS visits,
             COUNT(*) FILTER (WHERE v.outcome IN ('SALE', 'ORDER')) AS productive
      FROM visits v
      WHERE v."tenantId" = ${tenantId}::uuid AND ${within('v."startedAt"', p.start, p.end)}
        AND NOT EXISTS (SELECT 1 FROM visits c WHERE c."correctsVisitId" = v.id)
      GROUP BY v."sellerId"`;
  }

  /** Operations a manager reviewed "not justified", by the operation's date. */
  private geoFlags(tenantId: string, p: Period) {
    return this.prisma.db.$queryRaw<{ userId: string | null; n: bigint }[]>`
      SELECT "userId", COUNT(*) AS n FROM geo_checks
      WHERE "tenantId" = ${tenantId}::uuid AND "reviewStatus" = 'NOT_JUSTIFIED'
        AND ${within('"receivedAt"', p.start, p.end)}
      GROUP BY "userId"`;
  }
}
