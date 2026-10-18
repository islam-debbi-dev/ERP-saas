import { DEFAULT_PRICE_LEVEL_NAMES, DEFAULT_UNITS } from '@erp/shared';

/**
 * Minimal shape of a Prisma client or transaction, so the same code runs from a
 * Nest service (tenant-scoped client) and from the seed script (plain client).
 */
interface CatalogDefaultsClient {
  unit: {
    createMany(args: {
      data: { tenantId: string; code: string; allowsDecimal: boolean }[];
      skipDuplicates: boolean;
    }): PromiseLike<unknown>;
  };
  priceLevel: {
    createMany(args: {
      data: { tenantId: string; position: number; name: string }[];
      skipDuplicates: boolean;
    }): PromiseLike<unknown>;
  };
}

/** Default unit catalog. Safe to run twice (skipDuplicates on the unique keys). */
export async function createDefaultUnits(
  db: CatalogDefaultsClient,
  tenantId: string,
): Promise<void> {
  await db.unit.createMany({
    data: DEFAULT_UNITS.map((u) => ({ tenantId, code: u.code, allowsDecimal: u.allowsDecimal })),
    skipDuplicates: true,
  });
}

/**
 * Makes sure price levels 1..count exist. Never deletes: lowering the count only
 * hides levels, so their prices come back if the count goes up again.
 */
export async function ensurePriceLevels(
  db: CatalogDefaultsClient,
  tenantId: string,
  count: number,
): Promise<void> {
  await db.priceLevel.createMany({
    data: DEFAULT_PRICE_LEVEL_NAMES.slice(0, count).map((name, i) => ({
      tenantId,
      position: i + 1,
      name,
    })),
    skipDuplicates: true,
  });
}
