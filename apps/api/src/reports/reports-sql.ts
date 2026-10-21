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
  /** Only the sales this user made (a seller looking at his own figures). */
  sellerId: string | null;
}

/** `s` is a sale that counts in the figures. */
export function countedSale(scope: Scope, alias = 's'): Prisma.Sql {
  const s = Prisma.raw(alias);
  return Prisma.sql`${s}."tenantId" = ${scope.tenantId}::uuid
    AND ${s}.status = 'VALIDATED'
    AND NOT EXISTS (SELECT 1 FROM sales g WHERE g."tenantId" = ${s}."tenantId" AND g."invoiceId" = ${s}.id)
    ${scope.sellerId ? Prisma.sql`AND ${s}."createdBy" = ${scope.sellerId}::uuid` : Prisma.empty}`;
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
  return Prisma.sql`
    SELECT s."validatedAt" AS at, s."clientId", s."createdBy" AS seller, 1 AS docs,
           s."totalHt" AS ht, s."totalTtc" AS ttc, 0::numeric AS "retHt", 0::numeric AS "retTtc"
    FROM sales s
    WHERE ${countedSale(scope)} AND ${within('s."validatedAt"', start, end)}
    UNION ALL
    SELECT r."createdAt", s."clientId", s."createdBy", 0, 0, 0, r."totalHt", r."totalTtc"
    FROM sale_returns r JOIN sales s ON s.id = r."saleId"
    WHERE r."tenantId" = ${scope.tenantId}::uuid AND ${countedSale(scope)}
      AND ${within('r."createdAt"', start, end)}`;
}

/**
 * Sales and avoirs at line level: `at`, `productId`, `saleId` (null for an avoir),
 * signed `qty` (base unit) and `ht`, `retHt`, and `cost` at the CUMP frozen on the
 * sale line. A DAMAGED return gives the revenue back but not the cost: the goods
 * are lost, so their cost stays in the margin.
 */
export function saleLineFacts(scope: Scope, start: Date, end: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT s."validatedAt" AS at, l."productId", s.id AS "saleId", l."qtyBase" AS qty,
           l."lineHt" AS ht, 0::numeric AS "retHt", l."qtyBase" * l."unitCostBase" AS cost
    FROM sale_lines l JOIN sales s ON s.id = l."saleId"
    WHERE l."tenantId" = ${scope.tenantId}::uuid AND ${countedSale(scope)}
      AND ${within('s."validatedAt"', start, end)}
    UNION ALL
    SELECT r."createdAt", rl."productId", NULL, -rl."qtyBase", 0, rl."lineHt",
           CASE WHEN r.disposition = 'RESTOCK' THEN -rl."qtyBase" * sl."unitCostBase" ELSE 0 END
    FROM sale_return_lines rl
    JOIN sale_returns r ON r.id = rl."returnId"
    JOIN sale_lines sl ON sl.id = rl."saleLineId"
    JOIN sales s ON s.id = r."saleId"
    WHERE rl."tenantId" = ${scope.tenantId}::uuid AND ${countedSale(scope)}
      AND ${within('r."createdAt"', start, end)}`;
}
