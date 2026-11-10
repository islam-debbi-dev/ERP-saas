/**
 * The dashboard's period (phase 33): presets, the period it is compared with, and the
 * buckets of its chart. Algiers days (`YYYY-MM-DD`), pure functions, shared by the API
 * (which computes) and the web (which only builds links and labels).
 */
import { Role } from './enums';
import { money, type MoneyInput, toMoneyString } from './money';
import { previousPeriod } from './overview';
import { addDays, type DayRange, daysInMonth, rangeLength } from './periods';

export const DASHBOARD_PERIODS = ['today', '7d', 'month', 'lastMonth', 'custom'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

/** One bar per day up to this many days, one per week above. */
export const CHART_MAX_DAILY_BARS = 31;

export interface DashboardPeriodRange extends DayRange {
  period: DashboardPeriod;
  /** The same number of days just before: like is compared with like. */
  previousFrom: string;
  previousTo: string;
  bucket: 'day' | 'week';
}

/**
 * The days of a preset as of `today` ("Ce mois" stops today; "7 jours" is today and the
 * 6 days before). `custom` takes `range`, already validated (from ≤ to, ≤ 366 days).
 */
export function resolveDashboardPeriod(
  period: DashboardPeriod,
  today: string,
  range?: DayRange,
): DashboardPeriodRange {
  let r: DayRange;
  switch (period) {
    case 'today':
      r = { from: today, to: today };
      break;
    case '7d':
      r = { from: addDays(today, -6), to: today };
      break;
    case 'month':
      r = { from: `${today.slice(0, 7)}-01`, to: today };
      break;
    case 'lastMonth': {
      const first = `${today.slice(0, 7)}-01`;
      const last = addDays(first, -1);
      r = { from: `${last.slice(0, 7)}-01`, to: last };
      break;
    }
    case 'custom':
      if (!range) throw new Error('a custom period needs from and to');
      r = range;
      break;
  }
  const prev = previousPeriod(r);
  return {
    period,
    from: r.from,
    to: r.to,
    previousFrom: prev.from,
    previousTo: prev.to,
    bucket: rangeLength(r) > CHART_MAX_DAILY_BARS ? 'week' : 'day',
  };
}

/**
 * The chart's bars: one per day, or 7-day weeks counted from `from` (the last one may be
 * shorter). Each bar of the previous period is the same position shifted back by the
 * period's length.
 */
export function chartBuckets(range: DashboardPeriodRange): DayRange[] {
  const step = range.bucket === 'week' ? 7 : 1;
  const out: DayRange[] = [];
  for (let from = range.from; from <= range.to; from = addDays(from, step)) {
    const to = addDays(from, step - 1);
    out.push({ from, to: to > range.to ? range.to : to });
  }
  return out;
}

/** The previous period's bucket matching `bucket`. */
export function previousBucket(range: DashboardPeriodRange, bucket: DayRange): DayRange {
  const shift = -rangeLength(range);
  return { from: addDays(bucket.from, shift), to: addDays(bucket.to, shift) };
}

// ---------------------------------------------------------------- goal of the month

export interface SalesTargetProgress {
  /** The owner's monthly target, TTC. */
  amount: string;
  /** Ventes TTC of the month so far. */
  achieved: string;
  /** achieved / amount in %, one decimal (can pass 100). */
  pct: string;
  /** What is left to sell; 0 once reached. */
  remaining: string;
  /** Days left in the month, today included. */
  daysLeft: number;
}

/** Progress towards the monthly target as of `today` (an Algiers day of that month). */
export function salesTargetProgress(
  target: MoneyInput,
  achieved: MoneyInput,
  today: string,
): SalesTargetProgress {
  const t = money(target);
  const a = money(achieved);
  const left = t.minus(a);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return {
    amount: toMoneyString(t),
    achieved: toMoneyString(a),
    pct: t.lte(0) ? '0.0' : a.div(t).times(100).toFixed(1),
    remaining: toMoneyString(left.isNegative() ? 0 : left),
    daysLeft: daysInMonth(year, month) - Number(today.slice(8, 10)) + 1,
  };
}

// ---------------------------------------------------------------- greeting fact

export type GreetingFactKey =
  'chequesToday' | 'bestDayYesterday' | 'salesUp' | 'salesDown' | 'overLimit';

export interface GreetingFact {
  key: GreetingFactKey;
  /** Message parameters: counts as numbers, amounts and percents as strings. */
  params: Record<string, string | number>;
}

/** A trend smaller than this (in %) is not worth a sentence. */
export const GREETING_TREND_MIN_PCT = 5;

/**
 * The one line under "Bonjour" (phase 33): deterministic rules, first match wins, so the
 * same data always gives the same sentence. No AI.
 */
export function pickGreetingFact(input: {
  /** Client cheques due today (managers); null when not seen. */
  chequesDueToday: number | null;
  /** Ventes TTC per day of the month so far (today included, may be partial). */
  monthDays: { date: string; ttc: string }[];
  today: string;
  /** This month so far against the same days of last month, in %. */
  monthChangePct: string | null;
  overLimitCount: number | null;
}): GreetingFact | null {
  if (input.chequesDueToday)
    return { key: 'chequesToday', params: { count: input.chequesDueToday } };
  const yesterday = addDays(input.today, -1);
  const done = input.monthDays.filter((d) => d.date < input.today);
  const y = done.find((d) => d.date === yesterday);
  if (y && done.length >= 2 && money(y.ttc).gt(0) && done.every((d) => money(y.ttc).gte(d.ttc))) {
    return { key: 'bestDayYesterday', params: { amount: toMoneyString(y.ttc) } };
  }
  if (input.monthChangePct !== null) {
    const pct = money(input.monthChangePct);
    if (pct.abs().gte(GREETING_TREND_MIN_PCT)) {
      return {
        key: pct.isNegative() ? 'salesDown' : 'salesUp',
        params: { pct: pct.abs().toFixed(0) },
      };
    }
  }
  if (input.overLimitCount) return { key: 'overLimit', params: { count: input.overLimitCount } };
  return null;
}

// ---------------------------------------------------------------- my dashboard

/** The cards a user can move or hide (phase 33.5). New cards are added at the end. */
export const DASHBOARD_CARD_IDS = [
  'todo',
  'objectives',
  'attendance',
  'figures',
  'target',
  'stock',
  'chart',
  'top',
  'debtors',
  'cheques',
] as const;
export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number];

export interface DashboardLayout {
  /** Every known card, in the user's order. */
  order: DashboardCardId[];
  hidden: DashboardCardId[];
}

const isCard = (v: unknown): v is DashboardCardId =>
  typeof v === 'string' && (DASHBOARD_CARD_IDS as readonly string[]).includes(v);

/**
 * Where each role starts: owner and manager with "À faire" then money; a seller with
 * "À faire", his objectives, then his sales; a storekeeper with the stock.
 */
export function defaultDashboardLayout(role: Role): DashboardLayout {
  const first: DashboardCardId[] =
    role === Role.OWNER || role === Role.MANAGER
      ? ['todo', 'figures', 'target', 'chart', 'cheques', 'debtors', 'top', 'stock']
      : role === Role.SELLER || role === Role.SUPERVISOR
        ? ['todo', 'objectives', 'figures', 'chart', 'top']
        : role === Role.STOREKEEPER
          ? ['stock', 'todo']
          : ['todo'];
  return {
    order: [...first, ...DASHBOARD_CARD_IDS.filter((id) => !first.includes(id))],
    hidden: [],
  };
}

/**
 * A saved layout read back (or null = the role's default): unknown ids are dropped, so
 * removing a card later never breaks a layout; duplicates are dropped; cards the saved
 * order does not know yet are appended in the role's default order.
 */
export function normalizeDashboardLayout(saved: unknown, role: Role): DashboardLayout {
  const fallback = defaultDashboardLayout(role);
  if (!saved || typeof saved !== 'object') return fallback;
  const raw = saved as { order?: unknown; hidden?: unknown };
  const order = [...new Set(Array.isArray(raw.order) ? raw.order.filter(isCard) : [])];
  for (const id of fallback.order) if (!order.includes(id)) order.push(id);
  const hidden = [...new Set(Array.isArray(raw.hidden) ? raw.hidden.filter(isCard) : [])];
  return { order, hidden };
}
