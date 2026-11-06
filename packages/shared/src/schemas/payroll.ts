import { z } from 'zod';
import {
  PAY_ITEM_MODES,
  PAYMENT_MODES,
  type PayItemMode,
  type PayLineCode,
  PayrollManualKind,
  type PayrollRunStatus,
  type PayType,
} from '../enums';
import { parseDA } from '../money';
import {
  type IrgBracket,
  type IrgDetail,
  PAYROLL_DAY_DIVISORS,
  type PayDaySummary,
} from '../payroll';
import { normalizeDecimal } from './common';

const id = z.uuid();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');
const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'invalid_month');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null);

const amount = (test: (v: NonNullable<ReturnType<typeof parseDA>>) => boolean) =>
  z
    .string()
    .refine((v) => {
      const parsed = parseDA(v);
      return (
        parsed !== null && test(parsed) && parsed.decimalPlaces() <= 2 && parsed.abs().lt(1e12)
      );
    }, 'invalid_amount')
    .transform(normalizeDecimal);
const positiveAmount = amount((v) => v.gt(0));
const notNegativeAmount = amount((v) => v.gte(0));
const signedAmount = amount((v) => !v.isZero());

const ratio = z
  .string()
  .refine((v) => {
    const parsed = parseDA(v);
    return parsed !== null && parsed.gte(0) && parsed.lte(1) && parsed.decimalPlaces() <= 4;
  }, 'invalid_rate')
  .transform(normalizeDecimal);

export const payrollSettingsSchema = z.object({
  dayDivisor: z.union(PAYROLL_DAY_DIVISORS.map((d) => z.literal(d))),
  hourDivisor: amount((v) => v.gte(100) && v.lte(300)),
  overtimeRate: amount((v) => v.gte(0) && v.lte(3)),
  deductLateness: z.boolean(),
});
export type PayrollSettingsInput = z.infer<typeof payrollSettingsSchema>;

export const payItemTypeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  cotisable: z.boolean(),
  imposable: z.boolean(),
  mode: z.enum(PAY_ITEM_MODES),
});
export type PayItemTypeInput = z.infer<typeof payItemTypeSchema>;

export const employeePayItemSchema = z.object({
  typeId: id,
  /** 0 ends the item from this date. */
  amount: notNegativeAmount,
  effectiveFrom: dateString,
});
export type EmployeePayItemInput = z.infer<typeof employeePayItemSchema>;

export const createPayrollRunSchema = z.object({
  month: monthString,
  warehouseId: id.nullable().default(null),
});
export type CreatePayrollRunInput = z.infer<typeof createPayrollRunSchema>;

export const payrollRunListQuerySchema = z.object({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export type PayrollRunListQuery = z.infer<typeof payrollRunListQuerySchema>;

export const dasQuerySchema = z.object({ year: z.string().regex(/^\d{4}$/, 'invalid_year') });
export type DasQuery = z.infer<typeof dasQuerySchema>;

export const payrollManualLineSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(PayrollManualKind.ITEM),
    employeeId: id,
    typeId: id,
    amount: positiveAmount,
    note: optionalText(255),
  }),
  z.object({
    kind: z.literal(PayrollManualKind.REGULARISATION),
    employeeId: id,
    amount: signedAmount,
    cotisable: z.boolean(),
    imposable: z.boolean(),
    note: z.string().trim().min(1).max(255),
  }),
  z.object({
    kind: z.literal(PayrollManualKind.RETENUE),
    employeeId: id,
    amount: positiveAmount,
    note: z.string().trim().min(1).max(255),
  }),
]);
export type PayrollManualLineInput = z.infer<typeof payrollManualLineSchema>;

/** PATCH on a draft: lines to add and to remove, then the run is computed again. */
export const patchPayrollRunSchema = z.object({
  add: z.array(payrollManualLineSchema).max(100).default([]),
  remove: z.array(id).max(100).default([]),
});
export type PatchPayrollRunInput = z.input<typeof patchPayrollRunSchema>;
export type PatchPayrollRunParsed = z.infer<typeof patchPayrollRunSchema>;

export const approvePayrollRunSchema = z.object({
  /** The version the owner read: a later computation refuses the approval. */
  version: z.number().int().positive(),
});
export type ApprovePayrollRunInput = z.infer<typeof approvePayrollRunSchema>;

export const cancelPayrollRunSchema = z.object({ reason: z.string().trim().min(3).max(255) });
export type CancelPayrollRunInput = z.infer<typeof cancelPayrollRunSchema>;

export const payPayrollRunSchema = z.object({
  mode: z.enum(PAYMENT_MODES),
  /** The account the salaries leave from (phase 34). Omitted: the default for the mode. */
  cashAccountId: id.optional(),
  date: dateString.optional(),
  reference: optionalText(80),
  /** Left out: everyone with something left to pay. No amount: all that remains. */
  items: z
    .array(z.object({ employeeId: id, amount: positiveAmount.optional() }))
    .min(1)
    .max(1000)
    .optional(),
});
export type PayPayrollRunInput = z.infer<typeof payPayrollRunSchema>;

export const payrollRateSetSchema = z.object({
  effectiveFrom: dateString,
  cnasEmployeeRate: ratio,
  cnasEmployerRate: ratio,
  irgBrackets: z
    .array(z.object({ upTo: notNegativeAmount.nullable(), rate: ratio }))
    .min(1)
    .max(12)
    .refine((b) => b.at(-1)?.upTo === null, 'last_bracket_open'),
  abattementRate: ratio,
  abattementMin: notNegativeAmount,
  abattementMax: notNegativeAmount,
  exemptionThreshold: notNegativeAmount,
  lissageCeiling: notNegativeAmount,
  lissageNum: positiveAmount,
  lissageDen: positiveAmount,
  lissageOffsetNum: notNegativeAmount,
  lissageOffsetDen: positiveAmount,
  snmg: positiveAmount,
  toVerify: z.boolean(),
  note: optionalText(255),
});
export type PayrollRateSetInput = z.infer<typeof payrollRateSetSchema>;

export interface PayrollRateSetDto extends Omit<PayrollRateSetInput, 'irgBrackets'> {
  id: string;
  /** PLATFORM values are indicative: the company answers for the rates it uses. */
  source: PayrollRateSource;
  irgBrackets: IrgBracket[];
  createdAt: string;
}

export const PayrollRateSource = { PLATFORM: 'PLATFORM', COMPANY: 'COMPANY' } as const;
export type PayrollRateSource = (typeof PayrollRateSource)[keyof typeof PayrollRateSource];

export const PayrollRateDecision = { CONFIRMED: 'CONFIRMED', KEPT_OWN: 'KEPT_OWN' } as const;
export type PayrollRateDecision = (typeof PayrollRateDecision)[keyof typeof PayrollRateDecision];

export const RATE_TEXT_LOCALES = ['ar', 'fr', 'en'] as const;
export type RateTextLocale = (typeof RATE_TEXT_LOCALES)[number];

/**
 * What the owner reads and agrees to, in his screen's language. The server stores the
 * text from here, so the record is what was shown and never what a client sent.
 */
export const RATE_CONFIRMATION_TEXTS = {
  OWN: {
    fr: 'Je confirme que ces taux sont validés par mon comptable.',
    ar: 'أؤكد أن هذه النسب صادق عليها محاسبي.',
    en: 'I confirm these rates are validated by my accountant.',
  },
  ACCEPT: {
    fr: "J'accepte ces taux indicatifs pour ma société et j'en assume la responsabilité.",
    ar: 'أقبل هذه النسب الاسترشادية لشركتي وأتحمل مسؤوليتها.',
    en: 'I accept these indicative rates for my company and take responsibility for them.',
  },
  KEEP: {
    fr: 'Je conserve les taux de ma société et j’en assume la responsabilité.',
    ar: 'أحتفظ بنسب شركتي وأتحمل مسؤوليتها.',
    en: 'I keep my company’s rates and take responsibility for them.',
  },
} as const satisfies Record<string, Record<RateTextLocale, string>>;

export const rateDecisionSchema = z.object({ locale: z.enum(RATE_TEXT_LOCALES) });
export type RateDecisionInput = z.infer<typeof rateDecisionSchema>;

export const companyRateSetSchema = payrollRateSetSchema.omit({ toVerify: true }).extend({
  locale: z.enum(RATE_TEXT_LOCALES),
  /** The box "validés par mon comptable": no set without it. */
  confirmed: z.literal(true),
});
export type CompanyRateSetInput = z.infer<typeof companyRateSetSchema>;

export interface PlatformRateSetDto extends PayrollRateSetDto {
  /** This company accepted this set: its runs may be approved. */
  confirmed: boolean;
}

export interface PayrollRatesDto {
  /** Newest first. */
  platform: PlatformRateSetDto[];
  own: PayrollRateSetDto[];
  /** A platform set published after the company's own, not answered yet: the banner. */
  newOfficial: PayrollRateSetDto | null;
}

export interface PayrollSettingsDto extends PayrollSettingsInput {
  dailyHours: number;
}

export interface PayItemTypeDto extends PayItemTypeInput {
  id: string;
  key: string | null;
}

export interface EmployeePayItemDto {
  id: string;
  typeId: string;
  typeName: string;
  amount: string;
  effectiveFrom: string;
  mode: PayItemMode;
}

export const PayslipIssueCode = {
  UNMARKED_DAYS: 'UNMARKED_DAYS',
  NO_SALARY: 'NO_SALARY',
  NEGATIVE_NET: 'NEGATIVE_NET',
  BELOW_SNMG: 'BELOW_SNMG',
  ADVANCE_CREDIT: 'ADVANCE_CREDIT',
} as const;
export type PayslipIssueCode = (typeof PayslipIssueCode)[keyof typeof PayslipIssueCode];

/** What stops the approval; the other issues only warn. */
export const BLOCKING_PAYSLIP_ISSUES: readonly PayslipIssueCode[] = [
  PayslipIssueCode.UNMARKED_DAYS,
  PayslipIssueCode.NO_SALARY,
  PayslipIssueCode.NEGATIVE_NET,
];

export interface PayslipIssue {
  code: PayslipIssueCode;
  /** The days concerned, for UNMARKED_DAYS. */
  days?: string[];
}

export interface PayslipLineDto {
  code: PayLineCode;
  label: string;
  quantity: string | null;
  base: string | null;
  rate: string | null;
  amount: string;
  cotisable: boolean;
  imposable: boolean;
}

export interface PayrollManualLineDto {
  id: string;
  employeeId: string;
  kind: PayrollManualKind;
  label: string;
  amount: string;
  note: string | null;
}

export interface PayslipDto {
  id: string;
  runId: string;
  month: string;
  employeeId: string;
  fullName: string;
  matricule: string;
  position: string | null;
  nss: string | null;
  declared: boolean;
  payType: PayType | null;
  salary: string;
  days: PayDaySummary;
  issues: PayslipIssue[];
  irgDetail: IrgDetail;
  gross: string;
  cotisable: string;
  cnasEmployee: string;
  cnasEmployer: string;
  taxable: string;
  irg: string;
  net: string;
  retenues: string;
  advanceDeducted: string;
  advanceCarried: string;
  netToPay: string;
  employerCost: string;
  cumulGross: string;
  cumulIrg: string;
  paid: string;
  remaining: string;
  lines: PayslipLineDto[];
}

export interface PayrollTotals {
  gross: string;
  cnasEmployee: string;
  cnasEmployer: string;
  irg: string;
  net: string;
  netToPay: string;
  employerCost: string;
  paid: string;
  remaining: string;
}

export interface PayrollRunDto {
  id: string;
  number: string | null;
  month: string;
  warehouse: { id: string; name: string } | null;
  status: PayrollRunStatus;
  version: number;
  rateSetId: string;
  rateSetSource: PayrollRateSource;
  /** Only a platform set not checked yet. */
  rateSetToVerify: boolean;
  /** The owner answered for this set: without it the run cannot be approved. */
  ratesConfirmed: boolean;
  employeeCount: number;
  totals: PayrollTotals;
  computedAt: string;
  approvedAt: string | null;
  cancelReason: string | null;
}

export interface PayrollRunPage {
  items: PayrollRunDto[];
  nextCursor: string | null;
}

export interface PayrollRunDetailDto extends PayrollRunDto {
  payslips: PayslipDto[];
  manualLines: PayrollManualLineDto[];
  /** Sellers with an approved bonus and no employee file: it cannot be paid here. */
  incentivesWithoutEmployee: { userId: string; fullName: string; amount: string }[];
  /** Salaires dépenses of the month not linked to an employee: they count as charges too. */
  manualSalaryExpenses: string;
}

export interface MyPayslipDto {
  id: string;
  month: string;
  number: string | null;
  declared: boolean;
  netToPay: string;
}
