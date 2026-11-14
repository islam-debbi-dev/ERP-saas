import { z } from 'zod';
import { PAYMENT_MODES, type PaymentMode, type PurchaseStatus } from '../enums';
import { parseDA } from '../money';
import {
  amountString,
  currencyCode,
  exchangeRateString,
  normalizeDecimal,
  quantityString,
  searchText,
  fitsMoney,
} from './common';

const id = z.uuid();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null);

/** A cost per unit, up to 4 decimals (prices per kg or per piece can need them). */
const costString = z.string().refine((v) => {
  const parsed = parseDA(v);
  return (
    parsed !== null && !parsed.isNegative() && parsed.decimalPlaces() <= 4 && fitsMoney(parsed)
  );
}, 'invalid_amount');

/** ISO date `YYYY-MM-DD` (a document date, no time). */
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');

// ---------------------------------------------------------------- suppliers

export const supplierSchema = z.object({
  /** Matches the Excel import "Fournisseurs et soldes". Optional. */
  code: optionalText(30),
  name: z.string().trim().min(1).max(120),
  phone: optionalText(40),
  address: optionalText(255),
  rc: optionalText(40),
  nif: optionalText(40),
  nis: optionalText(40),
  ai: optionalText(40),
  notes: optionalText(500),
  /** Currency of its BRs and account (phase 22, IMPORT_COSTS). Fixed once it has entries. */
  currency: currencyCode.default('DZD'),
});
export type SupplierInput = z.infer<typeof supplierSchema>;
const patchText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
/** Only the keys sent change (no defaults: a missing key must not clear a stored value). */
export const updateSupplierSchema = z
  .object({
    code: patchText(30),
    name: z.string().trim().min(1).max(120).optional(),
    phone: patchText(40),
    address: patchText(255),
    rc: patchText(40),
    nif: patchText(40),
    nis: patchText(40),
    ai: patchText(40),
    notes: patchText(500),
    currency: currencyCode.optional(),
  })
  .strict();
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export interface SupplierDto {
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  rc: string | null;
  nif: string | null;
  nis: string | null;
  ai: string | null;
  notes: string | null;
  archivedAt: string | null;
  /** Positive = we owe the supplier; negative = credit in our favour. */
  balance: string;
  currency: string;
  /** The balance in the supplier's currency (foreign suppliers; "0.00" for DZD). */
  balanceCurrency: string;
  hasOpening: boolean;
}

export const supplierListQuerySchema = z.object({
  search: searchText().optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;

export interface SupplierPage {
  items: SupplierDto[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------- bon de réception

export const purchaseLineInputSchema = z.object({
  productId: id,
  unitId: id,
  qty: quantityString({ positive: true }).transform(normalizeDecimal),
  /**
   * Cost HT of one `unitId` (e.g. one carton), in the BR currency: the supplier's
   * price for a foreign BR (the API converts it at `exchangeRate`).
   */
  unitCost: costString.transform(normalizeDecimal),
});
export type PurchaseLineInput = z.infer<typeof purchaseLineInputSchema>;

const purchaseFields = {
  supplierId: id,
  documentDate: dateString,
  supplierRef: optionalText(60),
  note: optionalText(255),
  /** Paid to the supplier at reception; the rest goes on the supplier account. */
  paidAmount: amountString.transform(normalizeDecimal).default('0'),
  /** How the paid part left (phase 34): it becomes a règlement when the BR is validated. */
  paidMode: z.enum(PAYMENT_MODES).default('ESPECES'),
  /** The account it left from. Omitted: the default for the mode. */
  paidCashAccountId: id.nullable().optional(),
  lines: z.array(purchaseLineInputSchema).max(300),
  /**
   * The dépôt receiving the goods (phase 15, WAREHOUSES). Omitted = unchanged (none on
   * create); null = the default MAIN.
   */
  warehouseId: id.nullable().optional(),
  /**
   * Phase 22 (IMPORT_COSTS): DZD per 1 unit of the supplier's currency; required for a
   * foreign supplier, ignored for DZD. The BR currency is always the supplier's.
   */
  exchangeRate: exchangeRateString.optional(),
  /** Phase 22: the open dossier d'importation this BR belongs to. Omitted = unchanged. */
  importFileId: id.nullable().optional(),
};

export const createPurchaseSchema = z.object(purchaseFields);
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

export const updatePurchaseSchema = z.object({
  ...purchaseFields,
  version: z.number().int().min(1),
});
export type UpdatePurchaseInput = z.infer<typeof updatePurchaseSchema>;

export const validatePurchaseSchema = z.object({
  /** Selling prices the user chose to change on the validation screen. Never automatic. */
  priceUpdates: z
    .array(
      z.object({
        productId: id,
        unitId: id,
        priceLevelId: id,
        priceHt: amountString.transform(normalizeDecimal),
      }),
    )
    .max(500)
    .default([]),
});
export type ValidatePurchaseInput = z.infer<typeof validatePurchaseSchema>;

export const purchaseReturnSchema = z.object({
  /** The dépôt the goods leave from; omitted = the one the BR was received into. */
  warehouseId: id.optional(),
  note: optionalText(255),
  lines: z
    .array(
      z.object({
        purchaseLineId: id,
        qty: quantityString({ positive: true }).transform(normalizeDecimal),
      }),
    )
    .min(1)
    .max(300),
});
export type PurchaseReturnInput = z.infer<typeof purchaseReturnSchema>;

export const purchaseListQuerySchema = z.object({
  status: z.enum(['DRAFT', 'IN_TRANSIT', 'VALIDATED', 'CANCELLED']).optional(),
  supplierId: id.optional(),
  importFileId: id.optional(),
  /** Only this dépôt (phase 24); one outside the user's reach gives nothing. */
  warehouseId: id.optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PurchaseListQuery = z.infer<typeof purchaseListQuerySchema>;

export interface PurchaseLineDto {
  id: string;
  position: number;
  productId: string;
  unitId: string;
  designation: string;
  unitCode: string;
  unitName: string | null;
  factorToBase: string;
  tvaRate: string;
  qty: string;
  qtyBase: string;
  unitCost: string;
  lineHt: string;
  /** The supplier's price of one unit in the BR currency (foreign BRs only). */
  unitCostCurrency: string | null;
  /** Coût de revient of one base unit, once its dossier is closed. */
  landedUnitCostBase: string | null;
  /** Already returned to the supplier, in base unit. */
  returnedQtyBase: string;
}

export interface PurchaseReturnDto {
  id: string;
  number: string;
  note: string | null;
  totalHt: string;
  totalTva: string;
  totalTtc: string;
  createdAt: string;
  lines: { purchaseLineId: string; qty: string; qtyBase: string; lineHt: string }[];
}

export interface PurchaseDto {
  id: string;
  number: string | null;
  status: PurchaseStatus;
  supplier: { id: string; name: string };
  documentDate: string;
  supplierRef: string | null;
  note: string | null;
  totalHt: string;
  totalTva: string;
  totalTtc: string;
  tvaByRate: { rate: string; baseHt: string; tva: string }[];
  paidAmount: string;
  paidMode: PaymentMode;
  paidCashAccount: { id: string; name: string } | null;
  /** The dépôt that received (or will receive) the goods. */
  warehouse: { id: string; name: string } | null;
  currency: string;
  exchangeRate: string;
  /** Total in the BR currency (foreign BRs only). */
  totalCurrency: string | null;
  importFile: { id: string; number: string; status: string } | null;
  version: number;
  createdAt: string;
  validatedAt: string | null;
  cancelledAt: string | null;
  lines: PurchaseLineDto[];
  returns: PurchaseReturnDto[];
}

export interface PurchaseSummaryDto {
  id: string;
  number: string | null;
  status: PurchaseStatus;
  supplier: { id: string; name: string };
  documentDate: string;
  totalTtc: string;
  currency: string;
  totalCurrency: string | null;
  lineCount: number;
}

export interface PurchasePage {
  items: PurchaseSummaryDto[];
  nextCursor: string | null;
}
