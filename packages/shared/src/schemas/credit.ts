import { z } from 'zod';
import {
  PAYMENT_MODES,
  type PaymentMode,
  ShareDocType,
  type SupplierLedgerType,
  type SupplierPaymentStatus,
} from '../enums';
import { parseDA } from '../money';
import { exchangeRateString, normalizeDecimal, fitsMoney } from './common';

/** Phase 21, crédit avancé: supplier accounts, aging, reminders, share links. */

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
    return parsed !== null && parsed.gt(0) && parsed.decimalPlaces() <= 2 && fitsMoney(parsed);
  }, 'invalid_amount')
  .transform(normalizeDecimal);

// ---------------------------------------------------------------- règlements fournisseur

export const createSupplierPaymentSchema = z.object({
  supplierId: id,
  /** In the supplier's currency: DZD, or its foreign currency (phase 22). */
  amount: positiveAmount,
  /** Phase 22: required for a foreign supplier (DZD per 1 unit). */
  exchangeRate: exchangeRateString.optional(),
  mode: z.enum(PAYMENT_MODES).default('ESPECES'),
  /** Cheque or transfer number. */
  reference: optionalText(80),
  bank: optionalText(80),
  /** Cheque due date (échéance). */
  dueDate: dateString.nullable().default(null),
  note: optionalText(255),
  /** Phase 26: the dépôt that pays (figures per dépôt); else the user's only one. */
  warehouseId: id.optional(),
  /** The account the money goes through (phase 34). Omitted: the default for the mode. */
  cashAccountId: id.optional(),
});
export type CreateSupplierPaymentInput = z.infer<typeof createSupplierPaymentSchema>;

export const cancelSupplierPaymentSchema = z.object({ reason: z.string().trim().min(3).max(255) });
export type CancelSupplierPaymentInput = z.infer<typeof cancelSupplierPaymentSchema>;

export const supplierPaymentListQuerySchema = z.object({
  supplierId: id.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SupplierPaymentListQuery = z.infer<typeof supplierPaymentListQuerySchema>;

export interface SupplierPaymentPage {
  items: SupplierPaymentDto[];
  nextCursor: string | null;
}

export interface SupplierPaymentDto {
  id: string;
  number: string;
  supplier: { id: string; code: string | null; name: string };
  /** In DZD. */
  amount: string;
  currency: string;
  amountCurrency: string | null;
  exchangeRate: string | null;
  mode: PaymentMode;
  status: SupplierPaymentStatus;
  reference: string | null;
  bank: string | null;
  dueDate: string | null;
  note: string | null;
  paidBy: { id: string; fullName: string } | null;
  paidAt: string;
  cancelReason: string | null;
  cancelledAt: string | null;
  /** The account it went through (phase 34). */
  cashAccount: { id: string; name: string } | null;
  /** Paid at reception of this BR: it is cancelled with the BR, never alone. */
  purchase: { id: string; number: string | null } | null;
}

// ---------------------------------------------------------------- supplier ledger

export const supplierLedgerQuerySchema = z.object({
  /** The id of the last entry of the previous page (newest first). */
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SupplierLedgerQuery = z.infer<typeof supplierLedgerQuerySchema>;

export interface SupplierLedgerEntryDto {
  id: string;
  type: SupplierLedgerType;
  /** Signed: + we owe more, - we owe less. */
  amount: string;
  /** Phase 22: the amount in the supplier's currency (foreign entries), else null. */
  currency: string;
  amountCurrency: string | null;
  label: string;
  reason: string | null;
  refType: string | null;
  refId: string | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
  /** The balance right after this entry. */
  runningBalance: string;
  /** Same in the supplier's currency ("0.00" for DZD suppliers). */
  runningBalanceCurrency: string;
}

export interface SupplierLedgerPage {
  balance: string;
  currency: string;
  balanceCurrency: string;
  items: SupplierLedgerEntryDto[];
  nextCursor: string | null;
}

export interface SupplierBalanceDto {
  supplier: { id: string; code: string | null; name: string; phone: string | null };
  balance: string;
}

export interface SupplierBalancesDto {
  /** What we owe (positive balances only). */
  totalOwed: string;
  items: SupplierBalanceDto[];
}

export const supplierStatementQuerySchema = z
  .object({ from: dateString, to: dateString })
  .refine((q) => q.from <= q.to, { message: 'invalid_range', path: ['to'] });
export type SupplierStatementQuery = z.infer<typeof supplierStatementQuerySchema>;

export interface SupplierStatementDto {
  supplier: { id: string; code: string | null; name: string; currency: string };
  from: string;
  to: string;
  openingBalance: string;
  openingBalanceCurrency: string;
  entries: Omit<SupplierLedgerEntryDto, 'createdBy'>[];
  closingBalance: string;
  closingBalanceCurrency: string;
  totalDebit: string;
  totalCredit: string;
}

// ---------------------------------------------------------------- aging

export const agingQuerySchema = z.object({
  /** Algiers day the aging is computed at; default today. */
  asOf: dateString.optional(),
});
export type AgingQuery = z.infer<typeof agingQuerySchema>;

/** Days late: 0–30, 31–60, 61–90, over 90. */
export const AGING_BUCKETS = ['d0_30', 'd31_60', 'd61_90', 'd90'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export interface AgingRowDto {
  party: { id: string; code: string | null; name: string; phone: string | null };
  /** The ledger balance; the buckets always sum to it. */
  balance: string;
  buckets: Record<AgingBucket, string>;
  /** Age in days of the oldest amount still owed; null when nothing is owed. */
  oldestDays: number | null;
}

export interface AgingReportDto {
  kind: 'clients' | 'suppliers';
  asOf: string;
  rows: AgingRowDto[];
  totals: { balance: string; buckets: Record<AgingBucket, string> };
}

export interface ClientToRemindDto {
  client: { id: string; code: string; name: string; phone: string | null };
  balance: string;
  /** Day of the oldest document still unpaid. */
  oldestDate: string;
  oldestDays: number;
}

export interface ClientsToRemindDto {
  /** The tenant's threshold, in days. */
  reminderDays: number;
  items: ClientToRemindDto[];
}

// ---------------------------------------------------------------- share links

/** Days a share link stays valid. */
export const SHARE_LINK_TTL_DAYS = 7;

export const createShareLinkSchema = z.discriminatedUnion('docType', [
  z.object({ docType: z.literal(ShareDocType.FACTURE), docId: id }),
  z
    .object({
      docType: z.literal(ShareDocType.RELEVE),
      /** The client. */
      docId: id,
      from: dateString,
      to: dateString,
    })
    .refine((q) => q.from <= q.to, { message: 'invalid_range', path: ['to'] }),
]);
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;

export interface ShareLinkDto {
  id: string;
  /** Full URL to send; shown once, never stored in clear. */
  url: string;
  expiresAt: string;
}

// ---------------------------------------------------------------- cheques à échéance

export interface DueChequeDto {
  id: string;
  number: string;
  /** Client (versement) or supplier (règlement). */
  party: { id: string; name: string } | null;
  amount: string;
  reference: string | null;
  bank: string | null;
  dueDate: string;
}

export interface DueChequesDto {
  /** Today and the 6 days after (Algiers). */
  from: string;
  to: string;
  client: { count: number; total: string; items: DueChequeDto[] };
  supplier: { count: number; total: string; items: DueChequeDto[] };
}
