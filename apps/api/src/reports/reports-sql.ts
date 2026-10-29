import { Prisma } from '../generated/prisma/client';

/**
 * SQL shared by the dashboard and the reports. Raw SQL bypasses the tenant
 * extension, so every fragment takes the tenant id explicitly.
 *
 * Counting rules (PR "Decisions"):
 * - a sale counts once validated and until cancelled;
 * - a facture grouping BLs is not counted: its BLs already carry the revenue and cost;
 * - avoirs are subtracted on the day they are made, at their frozen prices, unless
 *   their sale was cancelled (the cancellation already reversed them);
 * - days are Algiers days.
 */

export interface Scope {
  tenantId: string;
  /**
   * Only the sales of these sellers (a seller: himself; a supervisor: his team; or a
   * filter). null = everyone, [] = nobody. See `sellerOf`.
   */
  sellerIds: string[] | null;
  /** Only the lines of products of this brand (phase 14). */
  brandId: string | null;
}

/**
 * Who a sale counts for: its seller (phase 14), or its creator for sales made before
 * sellers existed.
 */
export function sellerOf(alias = 's'): Prisma.Sql {
  return Prisma.raw(`COALESCE(${alias}."sellerId", ${alias}."createdBy")`);
}

/** `s` is a sale that counts in the figures. */
export function countedSale(scope: Scope, alias = 's'): Prisma.Sql {
  const s = Prisma.raw(alias);
  return Prisma.sql`${s}."tenantId" = ${scope.tenantId}::uuid
    AND ${s}.status = 'VALIDATED'
    AND NOT EXISTS (SELECT 1 FROM sales g WHERE g."tenantId" = ${s}."tenantId" AND g."invoiceId" = ${s}.id)
    ${scope.sellerIds ? Prisma.sql`AND ${sellerOf(alias)} = ANY(${scope.sellerIds}::uuid[])` : Prisma.empty}`;
}

/** A line of `p` (products alias) passes the brand filter. */
function brandFilter(scope: Scope, alias: string): Prisma.Sql {
  return scope.brandId
    ? Prisma.sql`AND ${Prisma.raw(alias)}."brandId" = ${scope.brandId}::uuid`
    : Prisma.empty;
}

/**
 * TTC of a line: its HT plus its frozen TVA, rounded to the centime. Only used when a
 * brand filter splits documents, so it can differ by a centime from the document total.
 */
function lineTtc(ht: string, rate: string, sale: string): Prisma.Sql {
  return Prisma.raw(
    `CASE WHEN ${sale}."assujettiTva" THEN ROUND(${ht} * (1 + ${rate} / 100), 2) ELSE ${ht} END`,
  );
}

/** `column` (an instant) falls in [start, end). */
export function within(column: string, start: Date, end: Date): Prisma.Sql {
  const c = Prisma.raw(column);
  return Prisma.sql`${c} >= ${start} AND ${c} < ${end}`;
}

/** The Algiers day of an instant column, as `YYYY-MM-DD`. */
export function algiersDayOf(column: string): Prisma.Sql {
  return Prisma.sql`to_char(${Prisma.raw(column)} AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD')`;
}

/** The Algiers month of an instant column, as `YYYY-MM`. */
export function algiersMonthOf(column: string): Prisma.Sql {
  return Prisma.sql`to_char(${Prisma.raw(column)} AT TIME ZONE 'Africa/Algiers', 'YYYY-MM')`;
}

/**
 * Sales and avoirs at document level, one row each: `at`, `clientId`, `seller`,
 * `docs` (1 for a sale), `ht`/`ttc` (sales) and `retHt`/`retTtc` (avoirs).
 */
export function saleDocumentFacts(scope: Scope, start: Date, end: Date): Prisma.Sql {
  if (scope.brandId) return brandDocumentFacts(scope, start, end);
  return Prisma.sql`
    SELECT s."validatedAt" AS at, s."clientId", ${sellerOf()} AS seller, 1 AS docs,
           s."totalHt" AS ht, s."totalTtc" AS ttc, 0::numeric AS "retHt", 0::numeric AS "retTtc"
    FROM sales s
    WHERE ${countedSale(scope)} AND ${within('s."validatedAt"', start, end)}
    UNION ALL
    SELECT r."createdAt", s."clientId", ${sellerOf()}, 0, 0, 0, r."totalHt", r."totalTtc"
    FROM sale_returns r JOIN sales s ON s.id = r."saleId"
    WHERE r."tenantId" = ${scope.tenantId}::uuid AND ${countedSale(scope)}
      AND ${within('r."createdAt"', start, end)}`;
}

/**
 * `saleDocumentFacts` limited to one brand: each document counts with its lines of that
 * brand only, and only if it has some.
 */
function brandDocumentFacts(scope: Scope, start: Date, end: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT s."validatedAt" AS at, s."clientId", ${sellerOf()} AS seller, 1 AS docs,
           x.ht, x.ttc, 0::numeric AS "retHt", 0::numeric AS "retTtc"
    FROM sales s
    JOIN LATERAL (
      SELECT SUM(l."lineHt") AS ht, SUM(${lineTtc('l."lineHt"', 'l."tvaRate"', 's')}) AS ttc
      FROM sale_lines l JOIN products p ON p.id = l."productId"
      WHERE l."saleId" = s.id ${brandFilter(scope, 'p')}
    ) x ON x.ht IS NOT NULL
    WHERE ${countedSale(scope)} AND ${within('s."validatedAt"', start, end)}
    UNION ALL
    SELECT r."createdAt", s."clientId", ${sellerOf()}, 0, 0, 0, x.ht, x.ttc
    FROM sale_returns r JOIN sales s ON s.id = r."saleId"
    JOIN LATERAL (
      SELECT SUM(rl."lineHt") AS ht, SUM(${lineTtc('rl."lineHt"', 'sl."tvaRate"', 's')}) AS ttc
      FROM sale_return_lines rl
      JOIN sale_lines sl ON sl.id = rl."saleLineId"
      JOIN products p ON p.id = rl."productId"
      WHERE rl."returnId" = r.id ${brandFilter(scope, 'p')}
    ) x ON x.ht IS NOT NULL
    WHERE r."tenantId" = ${scope.tenantId}::uuid AND ${countedSale(scope)}
      AND ${within('r."createdAt"', start, end)}`;
}

/**
 * Sales and avoirs at line level: `at`, `productId`, `brandId`, `saleId` (null for an
 * avoir), signed `qty` (base unit) and `ht`, `retHt`, `ttc`, `retTtc` (line TTC, see
 * `lineTtc`), and `cost` at the CUMP frozen on the sale line. A DAMAGED return gives the
 * revenue back but not the cost: the goods are lost, so their cost stays in the margin.
 */
export function saleLineFacts(scope: Scope, start: Date, end: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT s."validatedAt" AS at, l."productId", p."brandId", s.id AS "saleId", l."qtyBase" AS qty,
           l."lineHt" AS ht, 0::numeric AS "retHt",
           ${lineTtc('l."lineHt"', 'l."tvaRate"', 's')} AS ttc, 0::numeric AS "retTtc",
           l."qtyBase" * l."unitCostBase" AS cost
    FROM sale_lines l JOIN sales s ON s.id = l."saleId" JOIN products p ON p.id = l."productId"
    WHERE l."tenantId" = ${scope.tenantId}::uuid AND ${countedSale(scope)}
      AND ${within('s."validatedAt"', start, end)} ${brandFilter(scope, 'p')}
    UNION ALL
    SELECT r."createdAt", rl."productId", p."brandId", NULL, -rl."qtyBase", 0, rl."lineHt",
           0, ${lineTtc('rl."lineHt"', 'sl."tvaRate"', 's')},
           CASE WHEN r.disposition = 'RESTOCK' THEN -rl."qtyBase" * sl."unitCostBase" ELSE 0 END
    FROM sale_return_lines rl
    JOIN sale_returns r ON r.id = rl."returnId"
    JOIN sale_lines sl ON sl.id = rl."saleLineId"
    JOIN sales s ON s.id = r."saleId"
    JOIN products p ON p.id = rl."productId"
    WHERE rl."tenantId" = ${scope.tenantId}::uuid AND ${countedSale(scope)}
      AND ${within('r."createdAt"', start, end)} ${brandFilter(scope, 'p')}`;
}

/**
 * Each user's team (phase 14): his nearest SUPERVISOR going up `managerId`, himself
 * included. Users under no supervisor have no row. Use as a CTE named `team_of`.
 */
export function teamOfCte(tenantId: string): Prisma.Sql {
  return Prisma.sql`
    WITH RECURSIVE chain AS (
      SELECT u.id AS "userId", u.id AS anc, u.role, u."managerId", 0 AS depth
      FROM users u WHERE u."tenantId" = ${tenantId}::uuid
      UNION ALL
      SELECT c."userId", m.id, m.role, m."managerId", c.depth + 1
      FROM chain c JOIN users m ON m.id = c."managerId"
      WHERE c.role <> 'SUPERVISOR' AND c.depth < 50
    ),
    team_of AS (
      SELECT DISTINCT ON ("userId") "userId", anc AS "teamId"
      FROM chain WHERE role = 'SUPERVISOR' ORDER BY "userId", depth
    )`;
}
