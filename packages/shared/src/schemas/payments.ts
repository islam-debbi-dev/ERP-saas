import { z } from 'zod';
import { PAYMENT_MODES, type PaymentMode, type PaymentStatus, type SaleType } from '../enums';
import { parseDA } from '../money';
import { amountString, normalizeDecimal, fitsMoney } from './common';
import { type GeoCheckResultDto, geoInputSchema } from './geo';

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

/** A money amount strictly above zero, max 2 decimals. */
const positiveAmount = z
  .string()
  .refine((v) => {
    const parsed = parseDA(v);
    return parsed !== null && parsed.gt(0) && parsed.decimalPlaces() <= 2 && fitsMoney(parsed);
  }, 'invalid_amount')
  .transform(normalizeDecimal);

export const createPaymentSchema = z.object({
  clientId: id,
  amount: positiveAmount,
  mode: z.enum(PAYMENT_MODES).default('ESPECES'),
  /** Cheque or transfer number. */
  reference: optionalText(80),
  bank: optionalText(80),
  /** Cheque due date (date d'échéance). */
  dueDate: dateString.nullable().default(null),
  note: optionalText(255),
  /** The account the money goes through (phase 34). Omitted: the default for the mode. */
  cashAccountId: id.optional(),
  /**
   * Documents this versement pays, informational only (the balance is the ledger).
   * Omitted = automatic, oldest unpaid document first.
   */
  allocations: z
    .array(z.object({ saleId: id, amount: positiveAmount }))
    .max(100)
    .refine((a) => new Set(a.map((x) => x.saleId)).size === a.length, 'duplicate')
    .optional(),
  /** Device position (phase 17, GEO_CHECK); ignored when the module is off. */
  geo: geoInputSchema.optional(),
  /**
   * The dépôt this versement belongs to (phase 24). Omitted: the user's only dépôt, else
   * the dépôt principal.
   */
  warehouseId: id.optional(),
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const cancelPaymentSchema = z.object({ reason: z.string().trim().min(3).max(255) });
export type CancelPaymentInput = z.infer<typeof cancelPaymentSchema>;

export const bouncePaymentSchema = z.object({
  reason: z.string().trim().min(3).max(255),
  /** Frais bancaires charged to the client, posted as a separate adjustment. */
  bankFees: amountString.transform(normalizeDecimal).default('0'),
});
export type BouncePaymentInput = z.infer<typeof bouncePaymentSchema>;

export const paymentListQuerySchema = z.object({
  clientId: id.optional(),
  mode: z.enum(PAYMENT_MODES).optional(),
  status: z.enum(['VALID', 'CANCELLED', 'BOUNCED']).optional(),
  receivedBy: id.optional(),
  collectedBy: id.optional(),
  /** Only this dépôt (phase 24); one outside the user's reach gives nothing. */
  warehouseId: id.optional(),
  /**
   * Only the versements of this truck as the statistics count them (phase 37): its own,
   * and those its driver of the moment collected.
   */
  vehicleId: id.optional(),
  /** Received between these Algiers days. */
  from: dateString.optional(),
  to: dateString.optional(),
  /** `dueDate` lists cheques by échéance (chèques à encaisser). */
  sort: z.enum(['receivedAt', 'dueDate']).default('receivedAt'),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

export const cashSummaryQuerySchema = z.object({ date: dateString });
export type CashSummaryQuery = z.infer<typeof cashSummaryQuerySchema>;

// ---------------------------------------------------------------- responses

export interface PaymentAllocationDto {
  saleId: string;
  saleNumber: string | null;
  saleType: SaleType;
  amount: string;
}

export interface PaymentDto {
  id: string;
  number: string;
  client: { id: string; code: string; name: string } | null;
  sale: { id: string; number: string | null } | null;
  amount: string;
  mode: PaymentMode;
  status: PaymentStatus;
  reference: string | null;
  bank: string | null;
  dueDate: string | null;
  note: string | null;
  receivedBy: { id: string; fullName: string } | null;
  /** Who collected the money from the client (phase 14); the receiver by default for a SELLER. */
  collectedBy: { id: string; fullName: string } | null;
  receivedAt: string;
  cancelReason: string | null;
  cancelledAt: string | null;
  bounceReason: string | null;
  bouncedAt: string | null;
  allocations: PaymentAllocationDto[];
  version: number;
  /** Only on the create response (phase 17). */
  geoCheck?: GeoCheckResultDto | null;
}

export interface PaymentPage {
  items: PaymentDto[];
  nextCursor: string | null;
}

export interface UnpaidDocumentDto {
  saleId: string;
  type: SaleType;
  number: string | null;
  documentDate: string;
  totalTtc: string;
  /** Avoirs made on the document. */
  returned: string;
  /** Allocated from valid versements. */
  paid: string;
  remaining: string;
}

export interface CashSummaryDto {
  date: string;
  total: string;
  count: number;
  byMode: { mode: PaymentMode; count: number; total: string }[];
  byUser: {
    user: { id: string; fullName: string } | null;
    count: number;
    total: string;
    byMode: { mode: PaymentMode; total: string }[];
  }[];
}
