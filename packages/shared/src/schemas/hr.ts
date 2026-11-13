import { z } from 'zod';
import {
  ABSENCE_REASONS,
  type AbsenceReason,
  type AttendanceEventKind,
  type AttendanceSource,
  CORRECTABLE_STATUSES,
  type DayStatus,
  EMPLOYEE_CONTRACTS,
  type EmployeeContract,
  type EmployeeLedgerType,
  LEAVE_REQUEST_STATUSES,
  LEAVE_TYPES,
  LeaveEntryType,
  type LeaveRequestStatus,
  type LeaveType,
  PAY_TYPES,
  PAYMENT_MODES,
  type PayType,
} from '../enums';
import { type MonthCounts } from '../attendance';
import { parseDA } from '../money';
import { normalizeDecimal, searchText } from './common';
import { geoInputSchema } from './geo';

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
const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'invalid_month');

const positiveAmount = z
  .string()
  .refine((v) => {
    const parsed = parseDA(v);
    return parsed !== null && parsed.gt(0) && parsed.decimalPlaces() <= 2 && parsed.lt(1e12);
  }, 'invalid_amount')
  .transform(normalizeDecimal);

/** Hours or days with a fixed number of decimals, above zero. */
const positiveDecimal = (decimals: number, max: number) =>
  z
    .string()
    .refine((v) => {
      const parsed = parseDA(v);
      return (
        parsed !== null && parsed.gt(0) && parsed.decimalPlaces() <= decimals && parsed.lte(max)
      );
    }, 'invalid_number')
    .transform(normalizeDecimal);

const weekdays = z.array(z.number().int().min(0).max(6)).min(1).max(2);

// ----------------------------------------------------------------- employees

export const employeeSalaryInputSchema = z.object({
  amount: positiveAmount,
  payType: z.enum(PAY_TYPES),
  effectiveFrom: dateString,
  reason: optionalText(255),
});
export type EmployeeSalaryInput = z.infer<typeof employeeSalaryInputSchema>;

const employeeFields = {
  fullName: z.string().trim().min(1).max(120),
  phone: optionalText(40),
  position: optionalText(80),
  warehouseId: id.nullable().default(null),
  userId: id.nullable().default(null),
  hireDate: dateString,
  exitDate: dateString.nullable().default(null),
  contract: z.enum(EMPLOYEE_CONTRACTS),
  contractEndDate: dateString.nullable().default(null),
  declared: z.boolean().default(false),
  nss: optionalText(30),
  nin: optionalText(30),
  birthDate: dateString.nullable().default(null),
  bankAccount: optionalText(40),
  /** Overrides the company's rest days; null = the company's. */
  restDays: weekdays.nullable().default(null),
};

const contractDates = (
  v: { contract: EmployeeContract; contractEndDate: string | null },
  ctx: z.RefinementCtx,
) => {
  if (v.contract === 'CDD' && !v.contractEndDate) {
    ctx.addIssue({ code: 'custom', path: ['contractEndDate'], message: 'required' });
  }
};

export const createEmployeeSchema = z
  .object({ ...employeeFields, salary: employeeSalaryInputSchema.optional() })
  .superRefine(contractDates);
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z
  .object({
    ...employeeFields,
    /** The hire date moved before the first salary: start that salary on it too. */
    alignFirstSalary: z.boolean().optional(),
  })
  .superRefine(contractDates);
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const employeeListQuerySchema = z.object({
  search: searchText(120).optional(),
  warehouseId: id.optional(),
  archived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

/** Hidden without SALARY_VIEW: the API leaves the whole object out. */
export interface EmployeePayDto {
  bankAccount: string | null;
  payType: PayType | null;
  salary: string | null;
  advanceBalance: string;
  /** The row in force on `firstSalaryFrom`. */
  firstSalary: { amount: string; payType: PayType } | null;
}

export interface EmployeeDto {
  id: string;
  matricule: string;
  fullName: string;
  phone: string | null;
  position: string | null;
  warehouse: { id: string; name: string } | null;
  user: { id: string; fullName: string } | null;
  hireDate: string;
  exitDate: string | null;
  contract: EmployeeContract;
  contractEndDate: string | null;
  declared: boolean;
  nss: string | null;
  nin: string | null;
  birthDate: string | null;
  restDays: number[] | null;
  leaveBalance: string;
  archived: boolean;
  /** A date only, so that a user without SALARY_VIEW can be told the salary starts later. */
  firstSalaryFrom: string | null;
  pay?: EmployeePayDto;
}

export interface EmployeePage {
  items: EmployeeDto[];
  nextCursor: string | null;
}

export interface EmployeeSalaryDto {
  id: string;
  amount: string;
  payType: PayType;
  effectiveFrom: string;
  reason: string | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface EmployeeLedgerEntryDto {
  id: string;
  type: EmployeeLedgerType;
  /** Signed: an avance is a debit (+), its reversal a credit (−). */
  amount: string;
  balanceAfter: string;
  expenseId: string | null;
  expenseNumber: string | null;
  note: string | null;
  createdAt: string;
}

export interface EmployeeLedgerPage {
  /** Avances outstanding. */
  balance: string;
  /** Salary approved and not paid yet (phase 31b). */
  salaryDue: string;
  items: EmployeeLedgerEntryDto[];
  nextCursor: string | null;
}

export const ledgerQuerySchema = z.object({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

// ---------------------------------------------------------------- attendance

const markBase = {
  employeeId: id,
  note: optionalText(255),
};

/** One mark. `CORRECTION` has its own route and permission. */
export const attendanceMarkSchema = z.discriminatedUnion('kind', [
  z.object({ ...markBase, kind: z.literal('PRESENT') }),
  z.object({ ...markBase, kind: z.literal('HALF_DAY') }),
  z.object({
    ...markBase,
    kind: z.literal('ABSENT'),
    absenceReason: z.enum(ABSENCE_REASONS),
  }),
  z.object({
    ...markBase,
    kind: z.literal('LATE'),
    lateMinutes: z.number().int().min(1).max(1440),
  }),
  z.object({
    ...markBase,
    kind: z.literal('OVERTIME'),
    overtimeHours: positiveDecimal(2, 24),
  }),
]);
export type AttendanceMarkInput = z.infer<typeof attendanceMarkSchema>;

export const markAttendanceSchema = z.object({
  date: dateString,
  marks: z.array(attendanceMarkSchema).min(1).max(500),
  /** "Tous présents": leave the days already marked alone instead of refusing. */
  skipMarked: z.boolean().default(false),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

export const correctAttendanceSchema = z.object({
  employeeId: id,
  date: dateString,
  correctedTo: z.enum(CORRECTABLE_STATUSES),
  reason: z.string().trim().min(3).max(255),
  lateMinutes: z.number().int().min(0).max(1440).default(0),
  overtimeHours: z
    .string()
    .refine((v) => {
      const parsed = parseDA(v);
      return parsed !== null && parsed.gte(0) && parsed.decimalPlaces() <= 2 && parsed.lte(24);
    }, 'invalid_number')
    .transform(normalizeDecimal)
    .default('0'),
});
export type CorrectAttendanceInput = z.infer<typeof correctAttendanceSchema>;

export const selfAttendanceSchema = z.object({ geo: geoInputSchema.optional() });
export type SelfAttendanceInput = z.infer<typeof selfAttendanceSchema>;

export const attendanceDayQuerySchema = z.object({
  date: dateString.optional(),
  warehouseId: id.optional(),
});
export type AttendanceDayQuery = z.infer<typeof attendanceDayQuerySchema>;

export const attendanceMonthQuerySchema = z.object({
  month: monthString,
  employeeId: id.optional(),
  warehouseId: id.optional(),
});
export type AttendanceMonthQuery = z.infer<typeof attendanceMonthQuerySchema>;

export interface AttendanceEventDto {
  id: string;
  kind: AttendanceEventKind;
  source: AttendanceSource;
  at: string;
  absenceReason: AbsenceReason | null;
  correctedTo: DayStatus | null;
  lateMinutes: number | null;
  overtimeHours: string | null;
  note: string | null;
  createdBy: { id: string; fullName: string } | null;
}

export interface AttendanceDayRowDto {
  employee: {
    id: string;
    matricule: string;
    fullName: string;
    position: string | null;
    warehouse: { id: string; name: string } | null;
  };
  status: DayStatus;
  lateMinutes: number;
  overtimeHours: string;
  events: AttendanceEventDto[];
}

/** How many employees are in each status. All a VIEW_STATS user gets. */
export type AttendanceCounts = Partial<Record<DayStatus, number>>;

export interface AttendanceDayDto {
  date: string;
  counts: AttendanceCounts;
  /** Empty when the user only has the dépôt's statistics. */
  rows: AttendanceDayRowDto[];
  countsOnly: boolean;
}

export interface MarkAttendanceResult {
  date: string;
  /** Events written. */
  created: number;
  /** Employees left alone (already marked, on leave, off today). */
  skipped: number;
}

export interface AttendanceMonthRowDto {
  employee: { id: string; matricule: string; fullName: string };
  days: { date: string; status: DayStatus }[];
  counts: MonthCounts;
}

export interface AttendanceMonthDto {
  month: string;
  days: string[];
  /** Every employee in reach, including those of the dépôts seen as statistics only. */
  totals: MonthCounts;
  rows: AttendanceMonthRowDto[];
  countsOnly: boolean;
}

/** The dashboard card. */
export interface AttendanceTodayDto {
  date: string;
  present: number;
  absent: number;
  unmarked: number;
}

export interface MyAttendanceDto {
  employee: { id: string; matricule: string; fullName: string };
  today: {
    date: string;
    status: DayStatus;
    checkedInAt: string | null;
    checkedOutAt: string | null;
  };
  month: AttendanceMonthRowDto;
  leaveBalance: string;
  selfCheckIn: boolean;
  leaves: LeaveRequestDto[];
}

// -------------------------------------------------------------------- congés

export const createLeaveRequestSchema = z
  .object({
    /** Left out: the signed-in user's own file. */
    employeeId: id.optional(),
    startDate: dateString,
    endDate: dateString,
    type: z.enum(LEAVE_TYPES),
    note: optionalText(255),
  })
  .refine((v) => v.startDate <= v.endDate, { path: ['endDate'], message: 'before_start' });
export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>;

export const leaveReasonSchema = z.object({ reason: z.string().trim().min(3).max(255) });
export type LeaveReasonInput = z.infer<typeof leaveReasonSchema>;

export const leaveRequestListQuerySchema = z.object({
  status: z.enum(LEAVE_REQUEST_STATUSES).optional(),
  employeeId: id.optional(),
  warehouseId: id.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type LeaveRequestListQuery = z.infer<typeof leaveRequestListQuerySchema>;

export interface LeaveRequestDto {
  id: string;
  employee: { id: string; matricule: string; fullName: string };
  startDate: string;
  endDate: string;
  type: LeaveType;
  status: LeaveRequestStatus;
  /** Working days the leave covers. */
  days: string;
  note: string | null;
  decisionReason: string | null;
  decidedBy: { id: string; fullName: string } | null;
  decidedAt: string | null;
  createdAt: string;
  /** Set on an approval that went beyond the balance: a warning, never a refusal. */
  overBalance?: boolean;
}

export interface LeaveRequestPage {
  items: LeaveRequestDto[];
  nextCursor: string | null;
}

export interface LeaveEntryDto {
  id: string;
  type: LeaveEntryType;
  /** Signed days. */
  days: string;
  month: string | null;
  note: string | null;
  createdAt: string;
}

/** The owner's hand on the congé ledger: a first balance, or a signed correction. */
export const leaveEntryInputSchema = z.object({
  type: z.enum([LeaveEntryType.OPENING, LeaveEntryType.ADJUST]),
  days: z
    .string()
    .trim()
    .regex(/^-?\d{1,4}(\.\d)?$/)
    .refine((d) => Number(d) !== 0, 'not_zero'),
  note: z.string().trim().min(3).max(255),
});
export type LeaveEntryInput = z.infer<typeof leaveEntryInputSchema>;

export interface LeaveBalanceDto {
  balance: string;
  /** An OPENING entry exists: there can be only one. */
  hasOpening: boolean;
  entries: LeaveEntryDto[];
}

// ------------------------------------------------------------------- avances

export const createAdvanceSchema = z.object({
  amount: positiveAmount,
  mode: z.enum(PAYMENT_MODES),
  /** The account it was paid from (phase 34). Omitted: the default for the mode. */
  cashAccountId: id.optional(),
  date: dateString.optional(),
  reference: optionalText(80),
  note: optionalText(255),
});
export type CreateAdvanceInput = z.infer<typeof createAdvanceSchema>;

// ------------------------------------------------------------------ calendar

export const hrSettingsSchema = z.object({
  restDays: weekdays,
  dailyHours: z.number().int().min(1).max(24),
  leaveAccrualDays: positiveDecimal(1, 31),
  selfCheckIn: z.boolean(),
});
export type HrSettingsInput = z.infer<typeof hrSettingsSchema>;

export interface HrSettingsDto {
  restDays: number[];
  dailyHours: number;
  leaveAccrualDays: string;
  selfCheckIn: boolean;
}

export const publicHolidaySchema = z.object({
  date: dateString,
  name: z.string().trim().min(1).max(80),
  key: z.string().trim().max(30).nullable().default(null),
});
export type PublicHolidayInput = z.infer<typeof publicHolidaySchema>;

export const publicHolidayListQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});
export type PublicHolidayListQuery = z.infer<typeof publicHolidayListQuerySchema>;

export interface PublicHolidayDto {
  id: string;
  date: string;
  name: string;
  key: string | null;
}

export interface PublicHolidayListDto {
  year: number;
  items: PublicHolidayDto[];
  /** Lunar fêtes of the year nobody entered yet: the screen's reminder. */
  missingLunar: string[];
}
