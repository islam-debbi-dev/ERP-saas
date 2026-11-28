import { z } from 'zod';
import { type PaymentMode, Role } from '../enums';
import {
  DASHBOARD_PERIODS,
  type DashboardPeriodRange,
  type GreetingFact,
  type SalesTargetProgress,
} from '../dashboard';
import { rangeLength } from '../periods';
import { type DebtorDto } from './clients';
import { type DueChequesDto } from './credit';
import { type CashBalances } from './treasury';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');

/** Each report and the groupings it accepts; the first one is the default. */
export const REPORT_GROUPS = {
  sales: ['day', 'month', 'product', 'client', 'seller', 'brand', 'sector', 'team'],
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
  // A supervisor's reports cover his team (himself and everyone under him).
  [Role.SUPERVISOR]: ['sales', 'payments'],
  [Role.LIVREUR]: [],
  [Role.AREA_MANAGER]: ['sales', 'payments'],
  // The seller's reports without the money he never collects.
  [Role.PREVENDEUR]: ['sales'],
};

/** Groupings that need the SALES_FORCE module (brand is core). */
export const SALES_FORCE_GROUPS: readonly ReportGroupBy[] = ['sector', 'team'];

/** Longest period a report covers (a year, leap day included). */
export const MAX_REPORT_DAYS = 366;

export const reportNameSchema = z.enum(REPORT_NAMES as [ReportName, ...ReportName[]]);

/** `from` and `to` are Algiers days, both included. */
export const reportQuerySchema = z
  .object({
    from: dateString,
    to: dateString,
    groupBy: z.string().optional(),
    /** Only the sales of this seller (phase 14). */
    sellerId: z.uuid().optional(),
    /** Only the sales of this user's team (himself and his subtree); SALES_FORCE. */
    teamOf: z.uuid().optional(),
    brandId: z.uuid().optional(),
    /** Only this dépôt's figures (phase 24); one outside the user's reach gives nothing. */
    warehouseId: z.uuid().optional(),
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

export const dashboardQuerySchema = z
  .object({
    /** The day the dashboard is "as of" (Algiers); default today. */
    date: dateString.optional(),
    sellerId: z.uuid().optional(),
    teamOf: z.uuid().optional(),
    brandId: z.uuid().optional(),
    warehouseId: z.uuid().optional(),
    /** Phase 33: the period of the figures and the chart; "Ce mois" by default. */
    period: z.enum(DASHBOARD_PERIODS).default('month'),
    /** Algiers days, both included; only with `period=custom`. */
    from: dateString.optional(),
    to: dateString.optional(),
  })
  .refine((q) => q.period !== 'custom' || (q.from !== undefined && q.to !== undefined), {
    message: 'range_required',
    path: ['from'],
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'invalid_range', path: ['to'] })
  .refine(
    (q) =>
      !q.from ||
      !q.to ||
      q.from > q.to ||
      rangeLength({ from: q.from, to: q.to }) <= MAX_REPORT_DAYS,
    { message: 'range_too_long', path: ['from'] },
  );
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/** Vue d'ensemble (phase 26): Algiers days, both included, at most a year. */
export const overviewQuerySchema = z
  .object({ from: dateString, to: dateString })
  .refine((q) => q.from <= q.to, { message: 'invalid_range', path: ['to'] })
  .refine((q) => q.from > q.to || rangeLength(q) <= MAX_REPORT_DAYS, {
    message: 'range_too_long',
    path: ['from'],
  });
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

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
  'brand',
  'sector',
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
  /** Écart de coût: late import costs for units already sold (phase 22). */
  'ecart',
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

/** A bar of the dashboard chart (phase 33): `from`..`to` is one day or one week. */
export interface DashboardSeriesPoint {
  from: string;
  to: string;
  /** Ventes TTC net of avoirs, and their documents. */
  ttc: string;
  count: number;
  /** Encaissements; null when the role does not see cash. */
  cash: string | null;
  /** Marge; null without VIEW_COST_AND_MARGIN. */
  margin: string | null;
  /** Ventes of the matching bar of the previous period. */
  previousTtc: string;
}

/** Small lists of the period (phase 33), with the same seller / brand filters. */
export interface DashboardTopDto {
  /** By CA TTC; qty in the product's base unit. */
  products: { id: string; designation: string; unit: string; qty: string; ttc: string }[];
  clients: { id: string; name: string; ttc: string; count: number }[];
  /**
   * Clients qui n'achètent plus: a sale in the 90 days before the last 30, none in the
   * last 30; `monthly` is their average CA per month over those 90 days.
   */
  dormant: { id: string; name: string; monthly: string; lastSale: string }[];
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
    /** Sales HT minus cost at sale over the period; null without VIEW_COST_AND_MARGIN. */
    margin: string | null;
    /** Phase 33: the period picked, and the one of the same length just before. */
    period: DashboardPeriodRange;
    current: SalesFigure;
    previous: SalesFigure;
    /** current against previous in %, one decimal; null when previous ≤ 0. */
    changePct: string | null;
    /** One point per day (per week above 31 days) of the period. */
    series: DashboardSeriesPoint[];
  } | null;
  cash: {
    total: string;
    byMode: { mode: PaymentMode; count: number; total: string }[];
  } | null;
  /** En caisse (phase 34): today's balances; null without TREASURY_VIEW or the module. */
  treasury: CashBalances | null;
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
  /** Client and supplier cheques due in the next 7 days (phase 21); managers only. */
  cheques: DueChequesDto | null;
  /**
   * The period (phase 26, 33): marge brute − charges (phase 25). Managers with
   * VIEW_COST_AND_MARGIN, when the EXPENSES module is on; null otherwise.
   */
  net: { margin: string; charges: string; result: string } | null;
  /** null when the role does not see sales. */
  top: DashboardTopDto | null;
  /**
   * The owner's monthly target against the month so far (phase 33): managers, without a
   * seller / team / brand filter, when a target is set. A seller has his own objectives.
   */
  target: SalesTargetProgress | null;
  /** The line under "Bonjour" (phase 33), chosen by fixed rules; null when nothing to say. */
  greeting: GreetingFact | null;
}

/**
 * The figures of one dépôt (or of all of them) over a period (phase 26). A dépôt includes
 * its trucks. Amounts are decimal strings; percentages one-decimal strings.
 */
export interface OverviewFigures {
  sales: {
    /** TTC net of avoirs, as on the dashboard. */
    ttc: string;
    count: number;
    /** The same number of days just before. */
    previousTtc: string;
    /** null when the previous period had no sales. */
    changePct: string | null;
    /** One entry per day of the period. */
    perDay: { date: string; ttc: string }[];
  };
  /** Versements received. */
  cashIn: string;
  /** Règlements fournisseur + dépenses paid. */
  cashOut: { supplierPayments: string; expenses: string; importCosts: string; total: string };
  /** Today's balances (phase 34), like the créances; null without TREASURY_VIEW. */
  balances: CashBalances | null;
  netCash: string;
  /** null without VIEW_COST_AND_MARGIN. */
  margin: string | null;
  /** Rent by day + other expenses (phase 25); null without the EXPENSES module. */
  charges: string | null;
  /** margin − charges; null when either is null. */
  netResult: string | null;
  /** What clients owe this dépôt today. */
  credit: { total: string; over90: string; over90Pct: string | null; debtorCount: number };
  stock: { value: string | null; lowStock: number };
  topSeller: { id: string; fullName: string; ttc: string } | null;
}

export interface OverviewWarehouse extends OverviewFigures {
  warehouse: { id: string; name: string; isDefault: boolean };
}

export interface OverviewDto {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  /** Every dépôt the user sees: the sum of the cards (counts are company-wide). */
  total: OverviewFigures;
  warehouses: OverviewWarehouse[];
}
