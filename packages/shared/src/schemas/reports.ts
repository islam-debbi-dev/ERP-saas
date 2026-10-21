import { z } from 'zod';
import { type PaymentMode, Role } from '../enums';
import { rangeLength } from '../periods';
import { type DebtorDto } from './clients';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');

/** Each report and the groupings it accepts; the first one is the default. */
export const REPORT_GROUPS = {
  sales: ['day', 'month', 'product', 'client', 'seller'],
  margin: ['product', 'category'],
  'stock-movements': ['day', 'product', 'type'],
  payments: ['mode', 'user', 'day'],
  purchases: ['supplier', 'day'],
} as const;

export type ReportName = keyof typeof REPORT_GROUPS;
export const REPORT_NAMES = Object.keys(REPORT_GROUPS) as ReportName[];
export type ReportGroupBy = (typeof REPORT_GROUPS)[ReportName][number];

/** Which reports each role may run; a seller's sales report is his own sales only. */
export const REPORTS_BY_ROLE: Record<Role, readonly ReportName[]> = {
  [Role.OWNER]: REPORT_NAMES,
  [Role.MANAGER]: REPORT_NAMES,
  [Role.SELLER]: ['sales'],
  [Role.STOREKEEPER]: ['stock-movements'],
};

/** Longest period a report covers (a year, leap day included). */
export const MAX_REPORT_DAYS = 366;

export const reportNameSchema = z.enum(REPORT_NAMES as [ReportName, ...ReportName[]]);

/** `from` and `to` are Algiers days, both included. */
export const reportQuerySchema = z
  .object({
    from: dateString,
    to: dateString,
    groupBy: z.string().optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'invalid_range', path: ['to'] })
  .refine((q) => q.from > q.to || rangeLength(q) <= MAX_REPORT_DAYS, {
    message: 'range_too_long',
    path: ['from'],
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** The grouping asked for, or the report's default; null when the report does not have it. */
export function resolveGroupBy(name: ReportName, groupBy?: string): ReportGroupBy | null {
  const allowed: readonly string[] = REPORT_GROUPS[name];
  if (groupBy === undefined) return REPORT_GROUPS[name][0];
  return allowed.includes(groupBy) ? (groupBy as ReportGroupBy) : null;
}

export const dashboardQuerySchema = z.object({
  /** The day the dashboard is "as of" (Algiers); default today. */
  date: dateString.optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

// ---------------------------------------------------------------- responses

/** How a cell is formatted: `enum` values are codes the client translates. */
export type ReportColumnKind =
  'text' | 'day' | 'month' | 'enum' | 'count' | 'qty' | 'money' | 'percent';

export const REPORT_COLUMN_KEYS = [
  'day',
  'month',
  'code',
  'name',
  'user',
  'reference',
  'designation',
  'unit',
  'category',
  'supplier',
  'mode',
  'type',
  'count',
  'products',
  'qty',
  'qtyIn',
  'qtyOut',
  'qtyNet',
  'grossHt',
  'returnsHt',
  'netHt',
  'netTtc',
  'cost',
  'margin',
  'marginPct',
  'total',
] as const;
export type ReportColumnKey = (typeof REPORT_COLUMN_KEYS)[number];

export interface ReportColumn {
  key: ReportColumnKey;
  kind: ReportColumnKind;
}

export interface ReportRow {
  /** The grouping value (day, product id, mode code...); null for "none" (counter client, no category). */
  key: string | null;
  link: { type: 'client' | 'product'; id: string } | null;
  values: Record<string, string | null>;
}

export interface ReportDto {
  name: ReportName;
  groupBy: ReportGroupBy;
  from: string;
  to: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Totals of the summable columns; other columns are absent. */
  totals: Record<string, string>;
}

export interface SalesFigure {
  /** TTC net of avoirs, timbre excluded. */
  ttc: string;
  count: number;
}

/** A section is null when the user's role does not see it. */
export interface DashboardDto {
  date: string;
  /** Only the user's own sales for a seller. */
  sales: {
    today: SalesFigure;
    month: SalesFigure;
    /** The same days of last month. */
    previousMonth: SalesFigure;
    /** One entry per day of the month so far. */
    perDay: { date: string; ttc: string }[];
    /** Sales HT minus cost at sale; null without VIEW_COST_AND_MARGIN. */
    margin: string | null;
  } | null;
  cash: {
    total: string;
    byMode: { mode: PaymentMode; count: number; total: string }[];
  } | null;
  credit: {
    /** What clients owe (positive balances only). */
    total: string;
    debtorCount: number;
    topDebtors: DebtorDto[];
    overLimitCount: number;
    overLimit: DebtorDto[];
  } | null;
  stock: {
    outOfStock: number;
    lowStock: number;
    /** At CUMP; null without VIEW_COST_AND_MARGIN. */
    value: string | null;
  } | null;
}
