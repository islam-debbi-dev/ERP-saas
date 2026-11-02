import { Prisma } from '../generated/prisma/client';

/**
 * The dépôt (business unit, phase 24) a row counts for in the figures: a truck's rows are
 * its dépôt's, a row without a dépôt (before the backfills) is the dépôt principal's.
 * The one definition, shared by the overview, the aging per dépôt and the stock per dépôt.
 *
 * `join` goes in the FROM clause; `unit` is the dépôt id expression.
 */
export function businessUnit(
  column: string,
  defaultWarehouseId: string | null,
  alias = 'bu',
): { join: Prisma.Sql; unit: Prisma.Sql } {
  const w = Prisma.raw(alias);
  const col = Prisma.raw(column);
  return {
    join: Prisma.sql`LEFT JOIN warehouses ${w} ON ${w}.id = ${col}`,
    unit: Prisma.sql`COALESCE(CASE WHEN ${w}.type = 'VEHICLE' AND ${w}."parentWarehouseId" IS NOT NULL
      THEN ${w}."parentWarehouseId" ELSE ${w}.id END, ${defaultWarehouseId}::uuid)`,
  };
}
