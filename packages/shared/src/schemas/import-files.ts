import { z } from 'zod';
import {
  ALLOCATION_METHODS,
  type AllocationMethod,
  IMPORT_COST_TYPES,
  type ImportCostType,
  type ImportFileStatus,
} from '../landed-cost';
import { PAYMENT_MODES, type PaymentMode, type PurchaseStatus } from '../enums';
import { parseDA } from '../money';
import {
  amountString,
  currencyCode,
  exchangeRateString,
  normalizeDecimal,
  searchText,
} from './common';

/** Phase 22 (IMPORT_COSTS): dossiers d'importation and their costs. */

const id = z.uuid();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');

const positiveAmount = z
  .string()
  .refine((v) => {
    const parsed = parseDA(v);
    return parsed !== null && parsed.gt(0) && parsed.decimalPlaces() <= 2;
  }, 'invalid_amount')
  .transform(normalizeDecimal);

const importFileFields = {
  /** B/L, LTA or the importer's own reference. */
  reference: optionalText(60),
  containerNo: optionalText(40),
  arrivalDate: dateString.nullable().default(null),
  note: optionalText(255),
};

export const createImportFileSchema = z.object(importFileFields);
export type CreateImportFileInput = z.infer<typeof createImportFileSchema>;

export const updateImportFileSchema = z.object({
  ...importFileFields,
  version: z.number().int().min(1),
});
export type UpdateImportFileInput = z.infer<typeof updateImportFileSchema>;

export const attachPurchaseSchema = z.object({ purchaseId: id });
export type AttachPurchaseInput = z.infer<typeof attachPurchaseSchema>;

export const importCostSchema = z
  .object({
    type: z.enum(IMPORT_COST_TYPES),
    label: optionalText(120),
    /** The transitaire / transporteur we owe it to: its account is posted now. */
    supplierId: id.nullable().default(null),
    /** Must be the supplier's currency when there is one. */
    currency: currencyCode.default('DZD'),
    /** In `currency`, TVA included. */
    amount: positiveAmount,
    /** DZD per 1 unit; required when `currency` is not DZD. */
    exchangeRate: exchangeRateString.optional(),
    /** The TVA inside the amount, in DZD (recoverable for an assujetti tenant). */
    tvaAmount: amountString.transform(normalizeDecimal).default('0'),
    method: z.enum(ALLOCATION_METHODS).default('VALUE'),
    /** MANUAL only: { purchaseLineId: DZD amount }, summing to the allocated amount. */
    manualSplit: z
      .record(z.uuid(), amountString.transform(normalizeDecimal))
      .nullable()
      .default(null),
    /** Paid now, without a supplier (douane at the port): the money leaves an account. */
    paid: z.boolean().default(false),
    mode: z.enum(PAYMENT_MODES).default('ESPECES'),
    /** Omitted: the default for the mode. */
    cashAccountId: id.optional(),
  })
  .refine((c) => !c.paid || c.supplierId === null, {
    message: 'paid_cost_has_no_supplier',
    path: ['paid'],
  })
  .refine((c) => c.currency === 'DZD' || c.exchangeRate !== undefined, {
    message: 'exchange_rate_required',
    path: ['exchangeRate'],
  })
  .refine((c) => c.method !== 'MANUAL' || c.manualSplit !== null, {
    message: 'manual_split_required',
    path: ['manualSplit'],
  });
export type ImportCostInput = z.infer<typeof importCostSchema>;

export const cancelImportCostSchema = z.object({ reason: z.string().trim().min(3).max(255) });
export type CancelImportCostInput = z.infer<typeof cancelImportCostSchema>;

export const importFileListQuerySchema = z.object({
  status: z.enum(['OPEN', 'CLOSED', 'CANCELLED']).optional(),
  search: searchText().optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ImportFileListQuery = z.infer<typeof importFileListQuerySchema>;

export interface ImportCostDto {
  id: string;
  type: ImportCostType;
  label: string | null;
  supplier: { id: string; name: string } | null;
  currency: string;
  amountCurrency: string | null;
  exchangeRate: string;
  /** DZD, TVA included. */
  amount: string;
  tvaAmount: string;
  /** What enters the coût de revient (VAT rule applied). */
  allocated: string;
  method: AllocationMethod;
  manualSplit: Record<string, string> | null;
  isLate: boolean;
  /** Paid now from an account (phase 34); null when it is owed or a supplier's. */
  paidFrom: { id: string; name: string } | null;
  mode: PaymentMode | null;
  createdAt: string;
  cancelledAt: string | null;
}

export interface ImportFilePurchaseDto {
  id: string;
  number: string | null;
  status: PurchaseStatus;
  supplier: { id: string; name: string };
  documentDate: string;
  currency: string;
  exchangeRate: string;
  totalCurrency: string | null;
  totalTtc: string;
  lineCount: number;
}

export interface ImportFileSummaryDto {
  id: string;
  number: string;
  status: ImportFileStatus;
  reference: string | null;
  containerNo: string | null;
  arrivalDate: string | null;
  purchaseCount: number;
  /** Goods in DZD + allocated costs. */
  totalLanded: string;
  createdAt: string;
  closedAt: string | null;
}

export interface ImportFileDto extends ImportFileSummaryDto {
  note: string | null;
  version: number;
  purchases: ImportFilePurchaseDto[];
  costs: ImportCostDto[];
  totalGoods: string;
  totalCosts: string;
}

export interface ImportFilePage {
  items: ImportFileSummaryDto[];
  nextCursor: string | null;
}

export interface LandedCostPreviewLineDto {
  purchaseLineId: string;
  purchaseNumber: string | null;
  productId: string;
  reference: string;
  designation: string;
  qtyBase: string;
  baseUnitCode: string;
  currency: string;
  /** The supplier's line amount in its currency (foreign BRs). */
  valueCurrency: string | null;
  /** FOB in DZD (TVA added under IFU, as for any BR). */
  value: string;
  /** Share of each active cost, same order as `costs`. */
  shares: string[];
  landedTotal: string;
  /** Coût de revient of one base unit (null once nothing is left to compute). */
  landedUnitCost: string | null;
  /** CUMP now, to compare. */
  currentCump: string;
}

export interface LandedCostPreviewDto {
  status: ImportFileStatus;
  costs: {
    id: string;
    type: ImportCostType;
    label: string | null;
    method: AllocationMethod;
    allocated: string;
    isLate: boolean;
  }[];
  lines: LandedCostPreviewLineDto[];
  /** Costs that cannot be allocated as they are (missing weight, wrong manual split). */
  problems: { costId: string; code: string; details: Record<string, unknown> }[];
  totalGoods: string;
  totalCosts: string;
  totalLanded: string;
}
