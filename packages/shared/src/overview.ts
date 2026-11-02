/**
 * Vue d'ensemble (phase 26): the periods the owner picks and the maths of each dépôt card.
 * Pure functions, no I/O; the API and the web share them.
 */
import { money, type MoneyInput, toMoneyString } from './money';
import { addDays, type DayRange, daysInMonth, rangeLength, weekdayOf } from './periods';

export const OVERVIEW_PERIODS = ['today', 'week', 'month', 'lastMonth', 'custom'] as const;
export type OverviewPeriod = (typeof OVERVIEW_PERIODS)[number];

/**
 * The Algiers days a preset covers, as of `today`. The week starts on Sunday (the
 * Algerian week); "this week" and "this month" stop at today. `custom` has no range.
 */
export function periodRange(period: Exclude<OverviewPeriod, 'custom'>, today: string): DayRange {
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'week':
      return { from: addDays(today, -weekdayOf(today)), to: today };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const year = Number(today.slice(0, 4));
      const month = Number(today.slice(5, 7));
      const y = month === 1 ? year - 1 : year;
      const m = month === 1 ? 12 : month - 1;
      const mm = String(m).padStart(2, '0');
      return {
        from: `${y}-${mm}-01`,
        to: `${y}-${mm}-${String(daysInMonth(y, m)).padStart(2, '0')}`,
      };
    }
  }
}

/** The period of the same length that ends the day before `range` starts. */
export function previousPeriod(range: DayRange): DayRange {
  const to = addDays(range.from, -1);
  return { from: addDays(to, 1 - rangeLength(range)), to };
}

/**
 * Change from `previous` to `current` in %, one decimal (half-up), as a string.
 * null when there is nothing to compare with (previous ≤ 0).
 */
export function changePercent(current: MoneyInput, previous: MoneyInput): string | null {
  const prev = money(previous);
  if (prev.lte(0)) return null;
  return money(current).minus(prev).div(prev).times(100).toFixed(1);
}

/** Share of `part` in `whole` in %, one decimal; null when the whole is not positive. */
export function sharePercent(part: MoneyInput, whole: MoneyInput): string | null {
  const w = money(whole);
  if (w.lte(0)) return null;
  return money(part).div(w).times(100).toFixed(1);
}

/** Résultat net = marge brute − charges of the period; null when either is unknown. */
export function netResult(margin: string | null, charges: string | null): string | null {
  if (margin === null || charges === null) return null;
  return toMoneyString(money(margin).minus(charges));
}
