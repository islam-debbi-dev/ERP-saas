import { z } from 'zod';
import { CASH_ACCOUNT_TYPES, type CashAccountType, type CashMovementType } from '../treasury';
import { parseDA } from '../money';
import { amountString, normalizeDecimal, fitsMoney } from './common';

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

const signedAmount = z
  .string()
  .trim()
  .regex(/^-?\d{1,10}([.,]\d{1,2})?$/, 'invalid_amount')
  .transform(normalizeDecimal);

const accountFields = {
  name: z.string().trim().min(2).max(80),
  type: z.enum(CASH_ACCOUNT_TYPES),
  /** Required for a caisse with MULTI_UNIT. An account with no dépôt is for managers only. */
  warehouseId: id.nullable().default(null),
  bankName: optionalText(80),
  rib: optionalText(30),
  isDefault: z.boolean().default(false),
};

export const createCashAccountSchema = z.object(accountFields);
export type CreateCashAccountInput = z.infer<typeof createCashAccountSchema>;

export const updateCashAccountSchema = z.object({
  name: accountFields.name,
  bankName: accountFields.bankName,
  rib: accountFields.rib,
  isDefault: z.boolean(),
  version: z.number().int().min(1),
});
export type UpdateCashAccountInput = z.infer<typeof updateCashAccountSchema>;

export const cashAccountListQuerySchema = z.object({
  /** The accounts this user may put money in, for a form; else those he may look at. */
  pick: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  archived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type CashAccountListQuery = z.infer<typeof cashAccountListQuerySchema>;

export const cashOpeningSchema = z.object({
  /** Signed: a bank account can open overdrawn. */
  amount: signedAmount,
  date: dateString,
  note: optionalText(255),
});
export type CashOpeningInput = z.infer<typeof cashOpeningSchema>;

export const cashCountSchema = z.object({
  /** What the user counted in the till. */
  counted: amountString.transform(normalizeDecimal),
  /** Required as soon as the count differs from the balance. */
  reason: optionalText(255),
});
export type CashCountInput = z.infer<typeof cashCountSchema>;

export const createCashTransferSchema = z
  .object({
    fromAccountId: id,
    toAccountId: id,
    amount: positiveAmount,
    note: optionalText(255),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: 'same_account',
    path: ['toAccountId'],
  });
export type CreateCashTransferInput = z.infer<typeof createCashTransferSchema>;

export const cancelCashTransferSchema = z.object({ reason: z.string().trim().min(3).max(255) });
export type CancelCashTransferInput = z.infer<typeof cancelCashTransferSchema>;

export const cashMovementListQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  cursor: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CashMovementListQuery = z.infer<typeof cashMovementListQuerySchema>;

export const treasurySummaryQuerySchema = z.object({
  /** Balances at the end of this Algiers day, and its cash in / out. Default: today. */
  date: dateString.optional(),
});
export type TreasurySummaryQuery = z.infer<typeof treasurySummaryQuerySchema>;

export interface CashAccountDto {
  id: string;
  name: string;
  type: CashAccountType;
  warehouse: { id: string; name: string } | null;
  bankName: string | null;
  rib: string | null;
  isDefault: boolean;
  currency: string;
  /** Null until the solde initial is entered. */
  openingDate: string | null;
  /** Null without TREASURY_VIEW: a seller picks an account, he does not see what is in it. */
  balance: string | null;
  archivedAt: string | null;
  version: number;
}

export interface CashMovementDto {
  id: string;
  type: CashMovementType;
  /** Signed: + in, - out. */
  amount: string;
  date: string;
  /** Null when the document is hidden from this user (a salary, without SALARY_VIEW). */
  refType: string | null;
  refId: string | null;
  note: string | null;
  /** False when dated before the opening: shown, not in the balance. */
  counted: boolean;
  /** The balance after this movement; null when it does not count. */
  runningBalance: string | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface CashMovementPage {
  items: CashMovementDto[];
  nextCursor: string | null;
}

export interface CashTransferDto {
  id: string;
  number: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  amount: string;
  date: string;
  note: string | null;
  status: 'VALID' | 'CANCELLED';
  cancelReason: string | null;
  cancelledAt: string | null;
}

export interface CashCountDto {
  id: string;
  cashAccountId: string;
  counted: string;
  expected: string;
  ecart: string;
  reason: string | null;
  alert: boolean;
  createdAt: string;
}

export interface TreasuryAccountSummary {
  account: Pick<CashAccountDto, 'id' | 'name' | 'type' | 'warehouse' | 'isDefault' | 'openingDate'>;
  balance: string;
  cashIn: string;
  cashOut: string;
}

export interface TreasurySummaryDto {
  date: string;
  accounts: TreasuryAccountSummary[];
  /** One row per dépôt; `warehouse` null for the accounts with no dépôt. */
  byWarehouse: { warehouse: { id: string; name: string } | null; balance: string }[];
  /** Caisses / banks and CCP. */
  totals: { caisses: string; banques: string; cashIn: string; cashOut: string };
  /** Comptages of the last 30 days whose écart reached the tenant's threshold. */
  alerts: (CashCountDto & { account: { id: string; name: string } })[];
}

export interface TreasuryReconcileDto {
  ok: boolean;
  differences: { account: { id: string; name: string }; cached: string; ledger: string }[];
}

/** Balances of the accounts a figure covers (dashboard, overview). */
export interface CashBalances {
  caisses: string;
  banques: string;
}
