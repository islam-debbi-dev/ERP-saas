import { z } from 'zod';
import { qty } from '../quantity';
import { amountString, normalizeDecimal, percentString, quantityString } from './common';

const name = (max: number) => z.string().trim().min(1).max(max);
const id = z.uuid();

// ---------------------------------------------------------------- categories

export const createCategorySchema = z.object({
  name: name(80),
  /** One level of nesting: the parent must itself be a top-level category. */
  parentId: id.nullable().default(null),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema.partial().strict();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export interface CategoryDto {
  id: string;
  name: string;
  parentId: string | null;
  children: CategoryDto[];
}

// ---------------------------------------------------------------- units and price levels

export const createUnitSchema = z.object({
  name: name(40),
  allowsDecimal: z.boolean(),
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;

export interface UnitDto {
  id: string;
  /** Stable code of a default unit (translated in the UI), or `CUSTOM-…`. */
  code: string;
  /** Free-text name, only for custom units. */
  name: string | null;
  allowsDecimal: boolean;
}

export const renamePriceLevelSchema = z.object({ name: name(40) }).strict();
export type RenamePriceLevelInput = z.infer<typeof renamePriceLevelSchema>;

export interface PriceLevelDto {
  id: string;
  position: number;
  name: string;
}

// ---------------------------------------------------------------- products

const barcode = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[\w\-.]+$/, 'invalid_barcode')
  .nullable()
  .default(null);

export const productUnitInputSchema = z.object({
  unitId: id,
  factorToBase: quantityString({ positive: true }).transform(normalizeDecimal),
  barcode,
  isDefaultSale: z.boolean().default(false),
  isDefaultPurchase: z.boolean().default(false),
});
export type ProductUnitInput = z.infer<typeof productUnitInputSchema>;

export const productPriceInputSchema = z.object({
  unitId: id,
  priceLevelId: id,
  priceHt: amountString.transform(normalizeDecimal),
});
export type ProductPriceInput = z.infer<typeof productPriceInputSchema>;

/** Codes for the rules below, reported in `details.issues[].message`. */
export const PRODUCT_RULES = {
  baseUnitMissing: 'base_unit_missing',
  baseFactorNotOne: 'base_factor_not_one',
  duplicateUnit: 'duplicate_unit',
  duplicateBarcode: 'duplicate_barcode',
  defaultSale: 'exactly_one_default_sale',
  defaultPurchase: 'exactly_one_default_purchase',
  priceUnknownUnit: 'price_unknown_unit',
  duplicatePrice: 'duplicate_price',
} as const;

const productFields = {
  reference: name(40),
  designation: name(160),
  categoryId: id.nullable().default(null),
  /** Omitted = unchanged on update (none on create). */
  brandId: id.nullable().optional(),
  baseUnitId: id,
  tvaRate: percentString(2).transform(normalizeDecimal),
  minStock: quantityString({ positive: false }).transform(normalizeDecimal).default('0'),
  active: z.boolean().default(true),
  units: z.array(productUnitInputSchema).min(1).max(10),
  prices: z.array(productPriceInputSchema).max(50).default([]),
};

type ProductShape = {
  baseUnitId: string;
  units: ProductUnitInput[];
  prices: ProductPriceInput[];
};

/**
 * Rules that need no database: the base unit is listed with factor 1, units and
 * barcodes are unique, exactly one default sale and purchase unit, prices refer
 * to listed units. The API adds the rules that need the unit catalog.
 */
function checkProduct(p: ProductShape, ctx: z.RefinementCtx): void {
  const issue = (message: string, path: (string | number)[]) =>
    ctx.addIssue({ code: 'custom', message, path });

  const base = p.units.find((u) => u.unitId === p.baseUnitId);
  if (!base) issue(PRODUCT_RULES.baseUnitMissing, ['units']);
  else if (!qty(base.factorToBase).eq(1)) issue(PRODUCT_RULES.baseFactorNotOne, ['units']);

  const unitIds = new Set<string>();
  const barcodes = new Set<string>();
  p.units.forEach((u, i) => {
    if (unitIds.has(u.unitId)) issue(PRODUCT_RULES.duplicateUnit, ['units', i, 'unitId']);
    unitIds.add(u.unitId);
    if (u.barcode) {
      if (barcodes.has(u.barcode)) issue(PRODUCT_RULES.duplicateBarcode, ['units', i, 'barcode']);
      barcodes.add(u.barcode);
    }
  });
  if (p.units.filter((u) => u.isDefaultSale).length !== 1)
    issue(PRODUCT_RULES.defaultSale, ['units']);
  if (p.units.filter((u) => u.isDefaultPurchase).length !== 1) {
    issue(PRODUCT_RULES.defaultPurchase, ['units']);
  }

  const priceKeys = new Set<string>();
  p.prices.forEach((price, i) => {
    if (!unitIds.has(price.unitId)) issue(PRODUCT_RULES.priceUnknownUnit, ['prices', i, 'unitId']);
    const key = `${price.unitId}:${price.priceLevelId}`;
    if (priceKeys.has(key)) issue(PRODUCT_RULES.duplicatePrice, ['prices', i]);
    priceKeys.add(key);
  });
}

export const createProductSchema = z.object(productFields).superRefine(checkProduct);
export type CreateProductInput = z.infer<typeof createProductSchema>;

/** Full replacement of the product, units and prices, guarded by `version`. */
export const updateProductSchema = z
  .object({ ...productFields, version: z.number().int().min(1) })
  .superRefine(checkProduct);
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  categoryId: id.optional(),
  brandId: id.optional(),
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export interface ProductUnitDto {
  id: string;
  unitId: string;
  unitCode: string;
  unitName: string | null;
  allowsDecimal: boolean;
  factorToBase: string;
  barcode: string | null;
  isDefaultSale: boolean;
  isDefaultPurchase: boolean;
}

export interface ProductPriceDto {
  unitId: string;
  priceLevelId: string;
  priceHt: string;
}

export interface ProductDto {
  id: string;
  reference: string;
  designation: string;
  categoryId: string | null;
  brandId: string | null;
  brandName: string | null;
  baseUnitId: string;
  tvaRate: string;
  minStock: string;
  active: boolean;
  version: number;
  archivedAt: string | null;
  units: ProductUnitDto[];
  prices: ProductPriceDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductPage {
  items: ProductDto[];
  nextCursor: string | null;
}

export interface BarcodeMatchDto {
  product: ProductDto;
  /** The unit whose barcode was scanned (pièce or carton…). */
  unit: ProductUnitDto;
}
