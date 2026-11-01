import { z } from 'zod';
import { ClientType } from '../enums';
import { PackagingEntryType } from '../packaging';
import {
  PromotionClientScope,
  PromotionTarget,
  PromotionType,
  PROMOTION_CLIENT_SCOPES,
  PROMOTION_TARGETS,
} from '../promotions';
import { amountString, normalizeDecimal, percentString, quantityString } from './common';
import { saleLineInputSchema } from './sales';

const id = z.uuid();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');
const positiveQty = quantityString({ positive: true }).transform(normalizeDecimal);

// ---------------------------------------------------------------- promotions

const promotionBase = {
  name: z.string().trim().min(2).max(80),
  validFrom: dateString,
  validTo: dateString,
  active: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(0),
  clientScope: z.enum(PROMOTION_CLIENT_SCOPES).default(PromotionClientScope.ALL),
  priceLevelId: id.nullable().default(null),
  sectorId: id.nullable().default(null),
  clientIds: z.array(id).max(500).default([]),
};

const freeUnitsFields = z.object({
  ...promotionBase,
  type: z.literal(PromotionType.FREE_UNITS),
  buyProductId: id,
  buyUnitId: id,
  buyQty: positiveQty,
  /** Omitted = the product bought. */
  freeProductId: id.nullable().default(null),
  freeUnitId: id,
  freeQty: positiveQty,
  repeatable: z.boolean().default(true),
});

const percentFields = z.object({
  ...promotionBase,
  type: z.literal(PromotionType.PERCENT_DISCOUNT),
  target: z.enum(PROMOTION_TARGETS),
  productIds: z.array(id).max(500).default([]),
  brandId: id.nullable().default(null),
  categoryId: id.nullable().default(null),
  discountPct: percentString(2)
    .transform(normalizeDecimal)
    .refine((v) => v !== '0', 'invalid_rate'),
  /** In the product's base unit; null = any quantity. */
  minQtyBase: positiveQty.nullable().default(null),
});

type ScopeShape = {
  validFrom: string;
  validTo: string;
  clientScope: PromotionClientScope;
  priceLevelId: string | null;
  sectorId: string | null;
  clientIds: string[];
};

function checkScope(p: ScopeShape, ctx: z.RefinementCtx): void {
  if (p.validFrom > p.validTo) {
    ctx.addIssue({ code: 'custom', message: 'invalid_range', path: ['validTo'] });
  }
  if (p.clientScope === PromotionClientScope.PRICE_LEVEL && !p.priceLevelId) {
    ctx.addIssue({ code: 'custom', message: 'required', path: ['priceLevelId'] });
  }
  if (p.clientScope === PromotionClientScope.SECTOR && !p.sectorId) {
    ctx.addIssue({ code: 'custom', message: 'required', path: ['sectorId'] });
  }
  if (p.clientScope === PromotionClientScope.CLIENTS && p.clientIds.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'required', path: ['clientIds'] });
  }
}

export const promotionInputSchema = z
  .discriminatedUnion('type', [freeUnitsFields, percentFields])
  .superRefine((p, ctx) => {
    checkScope(p, ctx);
    if (p.type === PromotionType.PERCENT_DISCOUNT) {
      if (p.target === PromotionTarget.PRODUCTS && p.productIds.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'required', path: ['productIds'] });
      }
      if (p.target === PromotionTarget.BRAND && !p.brandId) {
        ctx.addIssue({ code: 'custom', message: 'required', path: ['brandId'] });
      }
      if (p.target === PromotionTarget.CATEGORY && !p.categoryId) {
        ctx.addIssue({ code: 'custom', message: 'required', path: ['categoryId'] });
      }
    }
  });
export type PromotionInput = z.infer<typeof promotionInputSchema>;
export type PromotionInputRaw = z.input<typeof promotionInputSchema>;

export const updatePromotionSchema = z.object({
  promotion: promotionInputSchema,
  version: z.number().int().min(1),
});
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;

export const PROMOTION_STATUSES = ['active', 'upcoming', 'ended'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

export const promotionListQuerySchema = z.object({
  status: z.enum(PROMOTION_STATUSES).default('active'),
});
export type PromotionListQuery = z.infer<typeof promotionListQuerySchema>;

export const promotionIdParamSchema = z.object({ id });

export interface PromotionDto {
  id: string;
  name: string;
  type: PromotionType;
  validFrom: string;
  validTo: string;
  active: boolean;
  priority: number;
  /** Today (Algiers) against the dates and `active`: active, upcoming or ended. */
  status: PromotionStatus;
  clientScope: PromotionClientScope;
  priceLevelId: string | null;
  sectorId: string | null;
  clients: { id: string; code: string; name: string }[];
  buyProduct: { id: string; reference: string; designation: string } | null;
  buyUnitId: string | null;
  buyQty: string | null;
  freeProduct: { id: string; reference: string; designation: string } | null;
  freeUnitId: string | null;
  freeQty: string | null;
  repeatable: boolean;
  target: PromotionTarget | null;
  products: { id: string; reference: string; designation: string }[];
  brandId: string | null;
  categoryId: string | null;
  discountPct: string | null;
  minQtyBase: string | null;
  version: number;
  createdAt: string;
}

// ---------------------------------------------------------------- pricing preview

export const pricingPreviewSchema = z.object({
  clientId: id.nullable().default(null),
  lines: z.array(saleLineInputSchema).min(1).max(300),
});
export type PricingPreviewInput = z.infer<typeof pricingPreviewSchema>;

/** A line as the API prices it: paid lines in input order, each followed by its free line. */
export interface PricedLineDto {
  position: number;
  productId: string;
  unitId: string;
  designation: string;
  unitCode: string;
  unitName: string | null;
  qty: string;
  qtyBase: string;
  listPriceHt: string | null;
  unitPriceHt: string;
  discountPct: string;
  tvaRate: string;
  lineHt: string;
  isFree: boolean;
  promotion: { id: string; name: string } | null;
  /** Position of the paid line this free line comes from. */
  freeOfPosition: number | null;
  /** Index of the input line this priced line comes from. */
  inputIndex: number;
}

export interface PricingPreviewDto {
  lines: PricedLineDto[];
  totalHt: string;
  totalTva: string;
  totalTtc: string;
}

// ---------------------------------------------------------------- emballages

export const packagingTypeInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  depositValue: amountString.transform(normalizeDecimal).nullable().default(null),
});
export type PackagingTypeInput = z.infer<typeof packagingTypeInputSchema>;

export interface PackagingTypeDto {
  id: string;
  name: string;
  depositValue: string | null;
  productCount: number;
}

/** A product's packaging (product form). */
export const productPackagingInputSchema = z
  .array(
    z.object({
      packagingTypeId: id,
      qtyBasePerPackaging: positiveQty,
    }),
  )
  .max(10)
  .refine((l) => new Set(l.map((p) => p.packagingTypeId)).size === l.length, 'duplicate');
export type ProductPackagingInput = z.infer<typeof productPackagingInputSchema>;

export interface ProductPackagingDto {
  packagingTypeId: string;
  name: string;
  qtyBasePerPackaging: string;
}

/** Manual movement: empties brought back, or a correction (managers). */
export const packagingMovementSchema = z
  .object({
    clientId: id,
    packagingTypeId: id,
    type: z.enum([PackagingEntryType.RETURN, PackagingEntryType.ADJUST]),
    /** RETURN: count brought back (> 0). ADJUST: signed, + the client has more. */
    qty: z.number().int().min(-100_000).max(100_000),
    note: z.string().trim().max(255).nullable().default(null),
  })
  .superRefine((m, ctx) => {
    if (m.qty === 0 || (m.type === PackagingEntryType.RETURN && m.qty < 0)) {
      ctx.addIssue({ code: 'custom', message: 'invalid_quantity', path: ['qty'] });
    }
    if (m.type === PackagingEntryType.ADJUST && !m.note) {
      ctx.addIssue({ code: 'custom', message: 'required', path: ['note'] });
    }
  });
export type PackagingMovementInput = z.infer<typeof packagingMovementSchema>;

export const clientPackagingQuerySchema = z.object({
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ClientPackagingQuery = z.infer<typeof clientPackagingQuerySchema>;

export interface PackagingBalanceDto {
  packagingTypeId: string;
  name: string;
  balance: number;
  depositValue: string | null;
}

export interface PackagingEntryDto {
  id: string;
  /** Cursor for the next page. */
  seq: string;
  packagingTypeId: string;
  packagingName: string;
  type: PackagingEntryType;
  qty: number;
  /** Count of this packaging after the entry. */
  balanceAfter: number;
  label: string;
  note: string | null;
  refType: string | null;
  refId: string | null;
  createdAt: string;
}

export interface ClientPackagingDto {
  clientId: string;
  balances: PackagingBalanceDto[];
  /** Newest first. */
  entries: PackagingEntryDto[];
  nextCursor: string | null;
}

export interface PackagingMovementResultDto {
  entry: PackagingEntryDto;
  balance: number;
  /** The client now has a negative count (more brought back than recorded). */
  negative: boolean;
}

// ---------------------------------------------------------------- sell-out

export const sellOutQuerySchema = z
  .object({
    from: dateString,
    to: dateString,
    brandId: id.optional(),
    sectorId: id.optional(),
    sellerId: id.optional(),
    clientType: z.enum([ClientType.PARTICULIER, ClientType.PROFESSIONNEL]).optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'invalid_range', path: ['to'] });
export type SellOutQuery = z.infer<typeof sellOutQuerySchema>;

/**
 * Columns of the sell-out export, in order. The keys and the French titles are a contract
 * with the brands that receive the file every month: never rename or reorder them, only
 * append new ones at the end.
 */
export const SELL_OUT_COLUMNS = [
  { key: 'month', title: 'Mois' },
  { key: 'brand', title: 'Marque' },
  { key: 'reference', title: 'Référence' },
  { key: 'designation', title: 'Désignation' },
  { key: 'unit', title: 'Unité' },
  { key: 'sector', title: 'Secteur' },
  { key: 'seller', title: 'Vendeur' },
  { key: 'clientType', title: 'Type client' },
  { key: 'qtySold', title: 'Qté vendue' },
  { key: 'qtyFree', title: 'Qté gratuite (UG)' },
  { key: 'qtyReturned', title: 'Qté retournée' },
  { key: 'qtyNet', title: 'Qté nette' },
  { key: 'salesHt', title: 'Ventes HT' },
  { key: 'returnsHt', title: 'Retours HT' },
  { key: 'netHt', title: 'Net HT' },
  { key: 'freeValueHt', title: 'Valeur gratuités HT' },
] as const;
export type SellOutColumnKey = (typeof SELL_OUT_COLUMNS)[number]['key'];

export interface SellOutRowDto {
  month: string;
  brandId: string | null;
  brand: string | null;
  productId: string;
  reference: string;
  designation: string;
  /** The product's base unit code (quantities are in it). */
  unit: string;
  sectorId: string | null;
  sector: string | null;
  sellerId: string | null;
  seller: string | null;
  clientType: ClientType | null;
  qtySold: string;
  qtyFree: string;
  qtyReturned: string;
  qtyNet: string;
  salesHt: string;
  returnsHt: string;
  netHt: string;
  freeValueHt: string;
}

export interface SellOutDto {
  from: string;
  to: string;
  rows: SellOutRowDto[];
  totals: Pick<
    SellOutRowDto,
    | 'qtySold'
    | 'qtyFree'
    | 'qtyReturned'
    | 'qtyNet'
    | 'salesHt'
    | 'returnsHt'
    | 'netHt'
    | 'freeValueHt'
  >;
  /** More rows than the screen shows; the export has them all. */
  truncated: boolean;
}
