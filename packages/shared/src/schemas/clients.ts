import { z } from 'zod';
import { ClientType, type ClientLedgerType } from '../enums';
import { parseDA } from '../money';
import { amountString, normalizeDecimal } from './common';
import { type ClientLocationDto } from './geo';

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

/** A signed money amount (`-2 000`, `32000.50`), max 2 decimals. */
const signedAmount = (opts: { nonZero: boolean }) =>
  z
    .string()
    .refine((v) => {
      const parsed = parseDA(v);
      if (parsed === null || parsed.decimalPlaces() > 2) return false;
      return opts.nonZero ? !parsed.isZero() : true;
    }, 'invalid_amount')
    .transform(normalizeDecimal);

const clientFields = {
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(160),
  type: z.enum([ClientType.PARTICULIER, ClientType.PROFESSIONNEL]).default(ClientType.PARTICULIER),
  phone: optionalText(40),
  phone2: optionalText(40),
  address: optionalText(255),
  wilaya: optionalText(60),
  commune: optionalText(80),
  rc: optionalText(40),
  nif: optionalText(40),
  nis: optionalText(40),
  ai: optionalText(40),
  priceLevelId: id.nullable().default(null),
  /** Plafond de crédit; null = no limit. */
  creditLimit: amountString.transform(normalizeDecimal).nullable().default(null),
  notes: optionalText(500),
  active: z.boolean().default(true),
  /** SALES_FORCE only. Omitted = unchanged (none on create); null clears it. */
  sectorId: id.nullable().optional(),
  assignedSellerId: id.nullable().optional(),
};

export const createClientSchema = z.object(clientFields);
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = z.object({ ...clientFields, version: z.number().int().min(1) });
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const clientListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  hasDebt: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  overLimit: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  sectorId: id.optional(),
  assignedSellerId: id.optional(),
  /** Only clients without a sector / without a seller. */
  unassigned: z.enum(['sector', 'seller']).optional(),
  /** `balance_desc`: who owes the most first (the dashboard's crédit card, phase 33). Default by name. */
  sort: z.enum(['name', 'balance_desc']).default('name'),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ClientListQuery = z.infer<typeof clientListQuerySchema>;

/** Can be negative (an avoir in the client's favour); zero has nothing to record. */
export const openingBalanceSchema = z.object({
  amount: signedAmount({ nonZero: true }),
  note: optionalText(255),
  /** The dépôt the debt belongs to (phase 24); omitted = the dépôt principal. */
  warehouseId: id.optional(),
});
export type OpeningBalanceInput = z.infer<typeof openingBalanceSchema>;

export const clientAdjustmentSchema = z.object({
  /** + the client owes more, - the client owes less. */
  amount: signedAmount({ nonZero: true }),
  reason: z.string().trim().min(3).max(255),
  /** The dépôt the adjustment belongs to (phase 24); omitted = the dépôt principal. */
  warehouseId: id.optional(),
});
export type ClientAdjustmentInput = z.infer<typeof clientAdjustmentSchema>;

export const statementQuerySchema = z
  .object({ from: dateString, to: dateString })
  .refine((q) => q.from <= q.to, { message: 'invalid_range', path: ['to'] });
export type StatementQuery = z.infer<typeof statementQuerySchema>;

export const debtorsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export type DebtorsQuery = z.infer<typeof debtorsQuerySchema>;

// ---------------------------------------------------------------- responses

export interface ClientDto {
  id: string;
  code: string;
  name: string;
  type: ClientType;
  phone: string | null;
  phone2: string | null;
  address: string | null;
  wilaya: string | null;
  commune: string | null;
  rc: string | null;
  nif: string | null;
  nis: string | null;
  ai: string | null;
  priceLevelId: string | null;
  creditLimit: string | null;
  sector: { id: string; name: string } | null;
  assignedSeller: { id: string; fullName: string } | null;
  notes: string | null;
  active: boolean;
  version: number;
  archivedAt: string | null;
  /** Positive = owes us; negative = credit in the client's favour. */
  balance: string;
  hasOpening: boolean;
  overLimit: boolean;
  /** Reference GPS point (phase 17); null until someone saves it. */
  location: ClientLocationDto | null;
  /**
   * What the client owes in each dépôt (phase 24, MULTI_UNIT): one account, the amounts
   * add up to `balance`. Only on the client's own page.
   */
  debtByWarehouse?: ClientDebtByWarehouseDto[];
}

export interface ClientPage {
  items: ClientDto[];
  nextCursor: string | null;
}

export interface ClientLedgerEntryDto {
  id: string;
  type: ClientLedgerType;
  amount: string;
  label: string;
  reason: string | null;
  refType: string | null;
  refId: string | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
  /** Balance right after this entry. */
  runningBalance: string;
  /** The dépôt the entry belongs to (phase 24); null before the backfill. */
  warehouse: { id: string; name: string } | null;
  /**
   * A dépôt the user does not work in: only date, type, number (`label`), amount and dépôt
   * are given; reason, refId and createdBy are null and the document cannot be opened.
   */
  reduced: boolean;
}

/** What the client owes in each dépôt (phase 24); the amounts add up to the balance. */
export interface ClientDebtByWarehouseDto {
  warehouse: { id: string; name: string } | null;
  balance: string;
}

export interface ClientStatementDto {
  client: { id: string; code: string; name: string };
  from: string;
  to: string;
  openingBalance: string;
  entries: ClientLedgerEntryDto[];
  closingBalance: string;
  totalDebit: string;
  totalCredit: string;
}

export interface DebtorDto {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  balance: string;
  creditLimit: string | null;
}

export interface ClientReconcileReport {
  checkedClients: number;
  differences: { clientId: string; cachedBalance: string; ledgerBalance: string }[];
}

export type CreditCheckStatus = 'OK' | 'WARN' | 'BLOCK';

export interface CreditCheckResult {
  status: CreditCheckStatus;
  balance: string;
  limit: string | null;
  projected: string;
}
