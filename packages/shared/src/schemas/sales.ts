import { z } from 'zod';
import {
  type PaymentStatus,
  PAYMENT_MODES,
  ReturnDisposition,
  type SaleStatus,
  SaleType,
} from '../enums';
import { amountString, normalizeDecimal, percentString, quantityString } from './common';

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
const paymentMode = z.enum(PAYMENT_MODES);

export const saleLineInputSchema = z.object({
  productId: id,
  unitId: id,
  qty: quantityString({ positive: true }).transform(normalizeDecimal),
  /** Price HT of one `unitId`. Omitted = the price of the client's level. */
  unitPriceHt: amountString.transform(normalizeDecimal).optional(),
  /** Remise in percent. Any discount counts as a price override. */
  discountPct: percentString(2).transform(normalizeDecimal).default('0'),
});
export type SaleLineInput = z.infer<typeof saleLineInputSchema>;

const saleFields = {
  type: z.enum([SaleType.BL, SaleType.FACTURE]).default(SaleType.BL),
  /** null = client comptoir (cash sale, nothing on credit). */
  clientId: id.nullable().default(null),
  documentDate: dateString,
  note: optionalText(255),
  lines: z.array(saleLineInputSchema).max(300),
  /**
   * Who made the sale (phase 14). Office roles pick it; a SELLER's sales are always his.
   * Omitted = the creator if he is a SELLER, else none (unchanged on update).
   */
  sellerId: id.nullable().optional(),
  /**
   * The dépôt the goods leave from (phase 15, WAREHOUSES). Omitted = unchanged (none on
   * create); null = decided at validation: the seller's truck if he has one, else MAIN.
   */
  warehouseId: id.nullable().optional(),
};

export const createSaleSchema = z.object(saleFields);
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const updateSaleSchema = z.object({ ...saleFields, version: z.number().int().min(1) });
export type UpdateSaleInput = z.infer<typeof updateSaleSchema>;

const paymentFields = {
  /** What the client hands over now. Above TTC, the difference is change given back. */
  paidAmount: amountString.transform(normalizeDecimal).default('0'),
  paymentMode: paymentMode.default('ESPECES'),
  /** Validate over the plafond in BLOCK mode (managers only). */
  forceCredit: z.boolean().default(false),
};

export const validateSaleSchema = z.object(paymentFields);
export type ValidateSaleInput = z.infer<typeof validateSaleSchema>;

export const quickSaleSchema = z.object({
  ...saleFields,
  lines: saleFields.lines.min(1),
  ...paymentFields,
});
export type QuickSaleInput = z.infer<typeof quickSaleSchema>;

export const cancelSaleSchema = z.object({ reason: z.string().trim().min(3).max(255) });
export type CancelSaleInput = z.infer<typeof cancelSaleSchema>;

export const saleReturnSchema = z.object({
  /** Where the goods come back to; omitted = the dépôt the sale left from. */
  warehouseId: id.optional(),
  disposition: z.enum([ReturnDisposition.RESTOCK, ReturnDisposition.DAMAGED]),
  reason: z.string().trim().min(3).max(255),
  lines: z
    .array(
      z.object({
        saleLineId: id,
        qty: quantityString({ positive: true }).transform(normalizeDecimal),
      }),
    )
    .min(1)
    .max(300),
});
export type SaleReturnInput = z.infer<typeof saleReturnSchema>;

export const invoiceFromBlsSchema = z.object({
  saleIds: z
    .array(id)
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'duplicate'),
  documentDate: dateString,
});
export type InvoiceFromBlsInput = z.infer<typeof invoiceFromBlsSchema>;

export const saleListQuerySchema = z.object({
  type: z.enum([SaleType.BL, SaleType.FACTURE]).optional(),
  status: z.enum(['DRAFT', 'VALIDATED', 'CANCELLED']).optional(),
  clientId: id.optional(),
  sellerId: id.optional(),
  /** Only BLs not yet grouped in a facture. */
  notInvoiced: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  from: dateString.optional(),
  to: dateString.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SaleListQuery = z.infer<typeof saleListQuerySchema>;

export const pricePreviewQuerySchema = z.object({
  clientId: id.optional(),
  productUnitId: id,
});
export type PricePreviewQuery = z.infer<typeof pricePreviewQuerySchema>;

// ---------------------------------------------------------------- responses

export interface SaleLineDto {
  id: string;
  position: number;
  productId: string;
  unitId: string;
  designation: string;
  unitCode: string;
  unitName: string | null;
  factorToBase: string;
  qty: string;
  qtyBase: string;
  /** Price of the client's level when the line was entered (null = none defined). */
  listPriceHt: string | null;
  unitPriceHt: string;
  discountPct: string;
  tvaRate: string;
  lineHt: string;
  /** Already brought back by the client, in base unit. */
  returnedQtyBase: string;
}

export interface SaleReturnDto {
  id: string;
  number: string;
  disposition: ReturnDisposition;
  reason: string;
  totalHt: string;
  totalTva: string;
  totalTtc: string;
  createdAt: string;
  lines: {
    saleLineId: string;
    qty: string;
    qtyBase: string;
    unitPriceHt: string;
    discountPct: string;
    tvaRate: string;
    lineHt: string;
  }[];
}

export interface SalePaymentDto {
  id: string;
  number: string;
  amount: string;
  mode: string;
  status: PaymentStatus;
  receivedAt: string;
}

export interface SaleClientDto {
  id: string;
  code: string;
  name: string;
}

/** Client name, address and legal IDs frozen at validation (what documents print). */
export interface SaleClientSnapshot {
  code: string;
  name: string;
  type?: string;
  phone: string | null;
  address: string | null;
  wilaya: string | null;
  commune: string | null;
  rc: string | null;
  nif: string | null;
  nis: string | null;
  ai: string | null;
}

export interface SaleDto {
  id: string;
  type: SaleType;
  number: string | null;
  status: SaleStatus;
  client: SaleClientDto | null;
  clientSnapshot: SaleClientSnapshot | null;
  documentDate: string;
  note: string | null;
  priceLevelId: string | null;
  assujettiTva: boolean;
  totalHt: string;
  totalTva: string;
  totalTtc: string;
  tvaByRate: { rate: string; baseHt: string; tva: string }[];
  timbre: string;
  paidAmount: string;
  paymentMode: string | null;
  /** The facture this BL was grouped in. */
  invoice: { id: string; number: string | null } | null;
  /** BLs grouped in this facture. */
  sourceBls: { id: string; number: string | null }[];
  creditOverride: boolean;
  cancelReason: string | null;
  version: number;
  /** The stored seller (phase 14); null on older sales and when none was picked. */
  sellerId: string | null;
  /** Who the sale counts for: the seller, else its creator. */
  seller: { id: string; fullName: string } | null;
  /** The dépôt it left from (validated) or the one chosen so far (draft). */
  warehouse: { id: string; name: string } | null;
  createdAt: string;
  validatedAt: string | null;
  cancelledAt: string | null;
  lines: SaleLineDto[];
  returns: SaleReturnDto[];
  payments: SalePaymentDto[];
}

export interface SaleSummaryDto {
  id: string;
  type: SaleType;
  number: string | null;
  status: SaleStatus;
  client: SaleClientDto | null;
  documentDate: string;
  totalTtc: string;
  paidAmount: string;
  invoice: { id: string; number: string | null } | null;
  seller: { id: string; fullName: string } | null;
  lineCount: number;
}

export interface SalePage {
  items: SaleSummaryDto[];
  nextCursor: string | null;
}

export type SaleWarning =
  | {
      kind: 'NEGATIVE_STOCK';
      productId: string;
      available: string;
      after: string;
      warehouseId?: string;
    }
  | { kind: 'CREDIT_LIMIT'; balance: string; limit: string; projected: string; forced: boolean };

export interface SaleResultDto {
  sale: SaleDto;
  warnings: SaleWarning[];
  /** Change given back: what was handed over above the TTC. */
  change: string;
}

export interface PricePreviewDto {
  productUnitId: string;
  priceLevelId: string | null;
  /** null when no price is set for this unit at this level. */
  priceHt: string | null;
}
