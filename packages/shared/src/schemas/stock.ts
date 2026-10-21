import { z } from 'zod';
import { AdjustmentReason, type InventoryStatus, type StockMovementType } from '../enums';
import { parseDA } from '../money';
import { normalizeDecimal, quantityString } from './common';

const id = z.uuid();

/** A non-zero signed quantity as a string (adjustments: + adds, - removes). */
const signedQuantityString = z.string().refine((v) => {
  const parsed = parseDA(v);
  return parsed !== null && !parsed.isZero() && parsed.decimalPlaces() <= 3;
}, 'invalid_quantity');

/** A cost per unit, up to 4 decimals (a pièce cost from a carton price is 45.8333). */
const costString = z.string().refine((v) => {
  const parsed = parseDA(v);
  return parsed !== null && !parsed.isNegative() && parsed.decimalPlaces() <= 4;
}, 'invalid_amount');

/** Unique products per request: one line per product keeps the ledger readable. */
function uniqueProducts(lines: { productId: string }[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    if (seen.has(l.productId))
      ctx.addIssue({ code: 'custom', message: 'duplicate_product', path: [i, 'productId'] });
    seen.add(l.productId);
  });
}

export const openingStockSchema = z.object({
  note: z.string().trim().max(255).optional(),
  lines: z
    .array(
      z.object({
        productId: id,
        unitId: id,
        qty: quantityString({ positive: true }).transform(normalizeDecimal),
        /** Cost of one `unitId` (e.g. one carton), converted to the base unit by the API. */
        unitCost: costString.transform(normalizeDecimal),
      }),
    )
    .min(1)
    .max(200)
    .superRefine(uniqueProducts),
});
export type OpeningStockInput = z.infer<typeof openingStockSchema>;

export const adjustmentSchema = z.object({
  reason: z.enum([
    AdjustmentReason.CASSE,
    AdjustmentReason.PERTE,
    AdjustmentReason.ERREUR,
    AdjustmentReason.AUTRE,
  ]),
  note: z.string().trim().max(255).optional(),
  lines: z
    .array(
      z.object({
        productId: id,
        unitId: id,
        qty: signedQuantityString.transform(normalizeDecimal),
      }),
    )
    .min(1)
    .max(200)
    .superRefine(uniqueProducts),
});
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const createInventorySchema = z.object({ note: z.string().trim().max(255).optional() });
export type CreateInventoryInput = z.infer<typeof createInventorySchema>;

export const inventoryLinesSchema = z.object({
  lines: z
    .array(
      z
        .object({
          productId: id,
          /** Required with a quantity; not needed to remove a line. */
          unitId: id.optional(),
          /** Counted quantity in `unitId`; null removes the line. */
          qty: quantityString({ positive: false }).transform(normalizeDecimal).nullable(),
        })
        .refine((l) => l.qty === null || l.unitId !== undefined, {
          message: 'unit_required',
          path: ['unitId'],
        }),
    )
    .min(1)
    .max(500)
    .superRefine(uniqueProducts),
});
export type InventoryLinesInput = z.infer<typeof inventoryLinesSchema>;

export const stockListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  lowStock: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** Rupture: nothing left (or less than nothing). */
  outOfStock: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type StockListQuery = z.infer<typeof stockListQuerySchema>;

export const cursorQuerySchema = z.object({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

// ---------------------------------------------------------------- responses

export interface StockWarning {
  productId: string;
  /** Stock before the exit, in base unit. */
  available: string;
  /** Stock after the exit (negative), in base unit. */
  after: string;
}

export interface StockLevelDto {
  productId: string;
  reference: string;
  designation: string;
  baseUnitId: string;
  minStock: string;
  qtyBase: string;
  avgCost: string;
  value: string;
  lowStock: boolean;
  hasOpening: boolean;
  /** Largest packaging unit, for the "12 cartons + 5 pièces" display. */
  packaging: {
    unitId: string;
    unitCode: string;
    unitName: string | null;
    factorToBase: string;
  } | null;
  baseUnit: { unitCode: string; unitName: string | null; allowsDecimal: boolean };
}

export interface StockPage {
  items: StockLevelDto[];
  nextCursor: string | null;
  summary: { totalValue: string; lowStockCount: number; productCount: number };
}

export interface StockMovementDto {
  id: string;
  type: StockMovementType;
  qtyBase: string;
  unitCost: string | null;
  balanceAfter: string;
  avgCostAfter: string;
  reason: AdjustmentReason | null;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface StockMovementPage {
  items: StockMovementDto[];
  nextCursor: string | null;
}

export interface StockOperationResult {
  movements: number;
  warnings: StockWarning[];
}

export interface InventoryLineDto {
  productId: string;
  reference: string;
  designation: string;
  countedQtyBase: string;
  /** Current stock while open, frozen at validation. */
  expectedQtyBase: string;
  diffQtyBase: string;
}

export interface InventoryDto {
  id: string;
  number: string;
  status: InventoryStatus;
  note: string | null;
  createdAt: string;
  validatedAt: string | null;
  cancelledAt: string | null;
  lines: InventoryLineDto[];
}

export interface InventorySummaryDto {
  id: string;
  number: string;
  status: InventoryStatus;
  lineCount: number;
  createdAt: string;
  validatedAt: string | null;
}

export interface ReconcileReport {
  checkedProducts: number;
  differences: {
    productId: string;
    cachedQty: string;
    ledgerQty: string;
    cachedAvgCost: string;
    ledgerAvgCost: string;
    brokenChainAt: string | null;
  }[];
}
