import { type ProductDto, type ProductUnitDto, toMoneyString, toQtyString } from '@erp/shared';
import type { Prisma } from '../generated/prisma/client';

/** What the product queries load: live units with their catalog unit, and prices. */
export const productInclude = {
  units: { where: { deletedAt: null }, include: { unit: true }, orderBy: { factorToBase: 'asc' } },
  prices: true,
} satisfies Prisma.ProductInclude;

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
type UnitRow = ProductWithRelations['units'][number];

export function toUnitDto(u: UnitRow): ProductUnitDto {
  return {
    id: u.id,
    unitId: u.unitId,
    unitCode: u.unit.code,
    unitName: u.unit.name,
    allowsDecimal: u.unit.allowsDecimal,
    factorToBase: toQtyString(u.factorToBase),
    barcode: u.barcode,
    isDefaultSale: u.isDefaultSale,
    isDefaultPurchase: u.isDefaultPurchase,
  };
}

export function toProductDto(p: ProductWithRelations): ProductDto {
  const unitIdByProductUnit = new Map(p.units.map((u) => [u.id, u.unitId]));
  return {
    id: p.id,
    reference: p.reference,
    designation: p.designation,
    categoryId: p.categoryId,
    baseUnitId: p.baseUnitId,
    tvaRate: p.tvaRate.toFixed(2),
    minStock: toQtyString(p.minStock),
    active: p.active,
    version: p.version,
    archivedAt: p.deletedAt?.toISOString() ?? null,
    units: p.units.map(toUnitDto),
    prices: p.prices
      .filter((pr) => unitIdByProductUnit.has(pr.productUnitId))
      .map((pr) => ({
        unitId: unitIdByProductUnit.get(pr.productUnitId) ?? '',
        priceLevelId: pr.priceLevelId,
        priceHt: toMoneyString(pr.priceHt),
      })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
