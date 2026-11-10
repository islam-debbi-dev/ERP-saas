/**
 * The dashboard's period (phase 33): presets, the period it is compared with, and the
 * buckets of its chart. Algiers days (`YYYY-MM-DD`), pure functions, shared by the API
 * (which computes) and the web (which only builds links and labels).
 */
import { previousPeriod } from './overview';
import { addDays, type DayRange, rangeLength } from './periods';

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
