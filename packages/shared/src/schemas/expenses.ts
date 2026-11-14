import { z } from 'zod';
import {
  type ExpenseCategoryKey,
  type ExpenseStatus,
  PAYMENT_MODES,
  type PaymentMode,
  RENT_PERIODS,
  type RentPeriod,
} from '../enums';
import { parseDA } from '../money';
import { type RentAlert, type RentSlotStatus } from '../rent';
import { normalizeDecimal, fitsMoney } from './common';

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

// ---------------------------------------------------------------- categories

export const expenseCategorySchema = z.object({ name: z.string().trim().min(1).max(60) });
export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>;

export interface ExpenseCategoryDto {
  id: string;
  name: string;
  /** Seeded categories keep their key whatever their name; `RENT` is Loyer. */
  key: ExpenseCategoryKey | null;
  archived: boolean;
}

// ---------------------------------------------------------------- expenses (dépenses)

export const createExpenseSchema = z
  .object({
    /** The day the money left (Algiers). Default: today. */
    date: dateString.optional(),
    /** Required with MULTI_UNIT (default: the user's only dépôt); optional otherwise. */
    warehouseId: id.nullable().optional(),
    /** Omitted on a rent payment: the Loyer category. */
    categoryId: id.optional(),
    amount: positiveAmount,
    mode: z.enum(PAYMENT_MODES).default('ESPECES'),
    /** Cheque or transfer number, invoice number. */
    reference: optionalText(80),
    /** Who was paid (free text). */
    payee: optionalText(120),
    /** The period this charge covers, both days included (optional). */
    periodStart: dateString.nullable().default(null),
    periodEnd: dateString.nullable().default(null),
    note: optionalText(255),
    /** A rent payment: the contract it pays, for whole periods of it. */
    rentContractId: id.nullable().default(null),
    /** The account it was paid from (phase 34). Omitted: the default for the mode. */
    cashAccountId: id.optional(),
  })
  .refine((e) => (e.periodStart === null) === (e.periodEnd === null), {
    message: 'period_incomplete',
    path: ['periodEnd'],
  })
  .refine((e) => !e.periodStart || !e.periodEnd || e.periodEnd >= e.periodStart, {
    message: 'period_inverted',
    path: ['periodEnd'],
  })
  .refine((e) => !!e.categoryId || !!e.rentContractId, {
    message: 'required',
    path: ['categoryId'],
  })
  .refine((e) => !e.rentContractId || !!e.periodStart, {
    message: 'required',
    path: ['periodStart'],
  });
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const cancelExpenseSchema = z.object({ reason: z.string().trim().min(3).max(255) });
export type CancelExpenseInput = z.infer<typeof cancelExpenseSchema>;

export const expenseListQuerySchema = z.object({
  /** Only this dépôt; one outside the user's reach gives nothing. */
  warehouseId: id.optional(),
  categoryId: id.optional(),
  rentContractId: id.optional(),
  mode: z.enum(PAYMENT_MODES).optional(),
  status: z.enum(['VALID', 'CANCELLED']).optional(),
  /** Paid between these Algiers days (included). */
  from: dateString.optional(),
  to: dateString.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;

export interface ExpenseDto {
  id: string;
  number: string;
  date: string;
  warehouse: { id: string; name: string } | null;
  category: { id: string; name: string; key: ExpenseCategoryKey | null };
  amount: string;
  mode: PaymentMode;
  reference: string | null;
  payee: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  note: string | null;
  rentContractId: string | null;
  status: ExpenseStatus;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
  cancelReason: string | null;
  cancelledAt: string | null;
}

export interface ExpensePage {
  items: ExpenseDto[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------- rent contracts (baux)

const rentContractFields = {
  landlordName: z.string().trim().min(1).max(120),
  landlordPhone: optionalText(30),
  amount: positiveAmount,
  period: z.enum(RENT_PERIODS),
  startDate: dateString,
  endDate: dateString.nullable().default(null),
  note: optionalText(255),
};

export const createRentContractSchema = z
  .object({
    /** Default: the dépôt principal. */
    warehouseId: id.optional(),
    ...rentContractFields,
  })
  .refine((c) => !c.endDate || c.endDate >= c.startDate, {
    message: 'period_inverted',
    path: ['endDate'],
  });
export type CreateRentContractInput = z.infer<typeof createRentContractSchema>;

/** Only before its first payment: then a new rent is a new contract. */
export const updateRentContractSchema = createRentContractSchema;
export type UpdateRentContractInput = z.infer<typeof updateRentContractSchema>;

export const closeRentContractSchema = z.object({ endDate: dateString });
export type CloseRentContractInput = z.infer<typeof closeRentContractSchema>;

export const rentContractListQuerySchema = z.object({
  warehouseId: id.optional(),
  /** Contracts still running (no end, or ending today or later). */
  current: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type RentContractListQuery = z.infer<typeof rentContractListQuerySchema>;

export interface RentContractDto {
  id: string;
  warehouse: { id: string; name: string };
  landlordName: string;
  landlordPhone: string | null;
  amount: string;
  period: RentPeriod;
  startDate: string;
  endDate: string | null;
  note: string | null;
  /** Has a valid payment: it can only be closed, never edited. */
  locked: boolean;
  /** Ended before today. */
  ended: boolean;
  paidUntil: string | null;
  nextDueDate: string | null;
  amountDue: string;
  alerts: RentAlert[];
  createdAt: string;
}

export interface RentSlotDto {
  start: string;
  end: string;
  days: number;
  amount: string;
  status: RentSlotStatus;
}

export interface RentScheduleDto {
  contract: RentContractDto;
  slots: RentSlotDto[];
  payments: Pick<ExpenseDto, 'id' | 'number' | 'date' | 'amount' | 'periodStart' | 'periodEnd'>[];
}

// ---------------------------------------------------------------- charges report

export const chargesQuerySchema = z
  .object({
    from: dateString,
    to: dateString,
    warehouseId: id.optional(),
  })
  .refine((q) => q.to >= q.from, { message: 'period_inverted', path: ['to'] });
export type ChargesQuery = z.infer<typeof chargesQuerySchema>;

export interface ChargesCategoryRow {
  category: { id: string; name: string; key: ExpenseCategoryKey | null };
  /** Rent charged from the contracts (Loyer only), by day. */
  rent: string;
  /** Expenses of the category (by their period, else their date). */
  expenses: string;
  total: string;
}

export interface ChargesWarehouseRow {
  /** null: expenses entered without a dépôt. */
  warehouse: { id: string; name: string } | null;
  rent: string;
  expenses: string;
  total: string;
}

export interface ChargesReportDto {
  from: string;
  to: string;
  warehouseId: string | null;
  /** Rent charged from the contracts (accrual). */
  rent: string;
  /**
   * Every other charge (Loyer payments of a contract are cash only, not counted here),
   * approved payroll included.
   */
  expenses: string;
  /** Approved payroll cost of the period, part of `expenses` (phase 31b). */
  payroll: string;
  total: string;
  /** Rent paid in the period (cash, for information; not part of the total). */
  rentPaid: string;
  byCategory: ChargesCategoryRow[];
  byWarehouse: ChargesWarehouseRow[];
}
