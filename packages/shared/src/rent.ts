/**
 * Rent (baux) and charges spread over time (phase 25). Days are Algiers `YYYY-MM-DD`
 * strings (see periods.ts). Money goes through the money helpers.
 *
 * The rent cost of any period is computed, never stored: each day inside a contract
 * period costs `amount / days of that period` (a yearly 1 200 000 DA lease costs
 * 1 200 000 × 31 / 365 for October). It is the charged cost (accrual), whenever it was
 * paid. These functions do not round: the caller rounds once, where it stores or shows
 * a figure (`round2`).
 */
import { RentPeriod } from './enums';
import { type Money, type MoneyInput, money, round2, ZERO } from './money';
import { addDays, type DayRange, daysInMonth, rangeLength } from './periods';

const PERIOD_MONTHS: Record<RentPeriod, number> = {
  [RentPeriod.MONTHLY]: 1,
  [RentPeriod.QUARTERLY]: 3,
  [RentPeriod.YEARLY]: 12,
};

/** Longest schedule we ever build (100 years of months): guards a bad date. */
const MAX_SLOTS = 1200;

export interface RentTerms {
  amount: MoneyInput;
  period: RentPeriod;
  startDate: string;
  /** Last day of the contract, included. null = open-ended. */
  endDate?: string | null;
}

/** One period of a contract: a month, a quarter or a year from its start day. */
export interface RentSlot {
  index: number;
  start: string;
  /** Last day covered, included: the period's end, or the contract's end if earlier. */
  end: string;
  /** Days of the full period (the divisor), even when the contract ends inside it. */
  days: number;
  /** Rent of the days covered, rounded to the centime (what is due for this slot). */
  amount: Money;
}

/**
 * `start` moved by whole months, keeping its day of the month (clipped to the month's
 * length: a lease from 31 January runs 31 Jan–27 Feb, 28 Feb–30 Mar...). Always computed
 * from the contract start, so the day never drifts.
 */
function addMonthsAnchored(start: string, months: number): string {
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7)) - 1 + months;
  const d = Number(start.slice(8, 10));
  const year = y + Math.floor(m / 12);
  const month = (((m % 12) + 12) % 12) + 1;
  const day = Math.min(d, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function minDay(a: string, b: string): string {
  return a < b ? a : b;
}

function slotAt(terms: RentTerms, index: number): RentSlot | null {
  const months = PERIOD_MONTHS[terms.period];
  const start = addMonthsAnchored(terms.startDate, index * months);
  if (terms.endDate && start > terms.endDate) return null;
  const fullEnd = addDays(addMonthsAnchored(terms.startDate, (index + 1) * months), -1);
  const end = terms.endDate ? minDay(fullEnd, terms.endDate) : fullEnd;
  const days = rangeLength({ from: start, to: fullEnd });
  const covered = rangeLength({ from: start, to: end });
  return { index, start, end, days, amount: round2(share(terms.amount, covered, days)) };
}

function share(amount: MoneyInput, part: number, whole: number): Money {
  return money(amount).times(part).dividedBy(whole);
}

/** The contract's periods that start on or before `until` (and before its end). */
export function rentSlots(terms: RentTerms, until: string): RentSlot[] {
  const slots: RentSlot[] = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    const slot = slotAt(terms, i);
    if (!slot || slot.start > until) break;
    slots.push(slot);
  }
  return slots;
}

/** `count` periods from the one that starts on `start` (fewer when the contract ends). */
export function rentSlotsFrom(terms: RentTerms, start: string, count: number): RentSlot[] {
  const slots: RentSlot[] = [];
  for (let i = 0; i < MAX_SLOTS && slots.length < count; i++) {
    const slot = slotAt(terms, i);
    if (!slot) break;
    if (slot.start >= start) slots.push(slot);
  }
  return slots;
}

/**
 * The rent charged for the days of `range` (accrual), not rounded. Each day costs the
 * amount divided by the days of the contract period it falls in.
 */
export function rentCost(terms: RentTerms, range: DayRange): Money {
  if (terms.startDate > range.to) return ZERO;
  if (terms.endDate && terms.endDate < range.from) return ZERO;
  let total: Money = ZERO;
  for (const slot of rentSlots(terms, range.to)) {
    if (slot.end < range.from) continue;
    const from = range.from > slot.start ? range.from : slot.start;
    const days = rangeLength({ from, to: minDay(range.to, slot.end) });
    total = total.plus(share(terms.amount, days, slot.days));
  }
  return total;
}

/**
 * The share of an expense that falls in `range`, not rounded. With a period covered
 * (`periodStart..periodEnd`), spread by day over it; without one, all of it on its date.
 */
export function spreadExpense(
  expense: {
    amount: MoneyInput;
    date: string;
    periodStart?: string | null;
    periodEnd?: string | null;
  },
  range: DayRange,
): Money {
  const { periodStart, periodEnd } = expense;
  if (!periodStart || !periodEnd) {
    return expense.date >= range.from && expense.date <= range.to ? money(expense.amount) : ZERO;
  }
  if (periodEnd < range.from || periodStart > range.to) return ZERO;
  const from = range.from > periodStart ? range.from : periodStart;
  const days = rangeLength({ from, to: minDay(range.to, periodEnd) });
  return share(expense.amount, days, rangeLength({ from: periodStart, to: periodEnd }));
}

/**
 * How many whole periods `periodStart..periodEnd` covers, or null when it does not start
 * and end on the contract's period boundaries (a rent payment pays whole periods).
 */
export function alignedRentPeriods(
  terms: RentTerms,
  periodStart: string,
  periodEnd: string,
): number | null {
  if (periodEnd < periodStart) return null;
  const slots = rentSlots(terms, periodEnd);
  const first = slots.findIndex((s) => s.start === periodStart);
  const last = slots.findIndex((s) => s.end === periodEnd);
  if (first < 0 || last < first) return null;
  return last - first + 1;
}

export const RentSlotStatus = {
  PAID: 'PAID',
  /** Started (on or before today) and not paid. */
  DUE: 'DUE',
  UPCOMING: 'UPCOMING',
} as const;
export type RentSlotStatus = (typeof RentSlotStatus)[keyof typeof RentSlotStatus];

export const RentAlert = {
  /** The contract ends within 30 days. */
  ENDING_SOON: 'ENDING_SOON',
  /** A period has started and is not paid. */
  UNPAID_DUE: 'UNPAID_DUE',
} as const;
export type RentAlert = (typeof RentAlert)[keyof typeof RentAlert];

export const RENT_ENDING_SOON_DAYS = 30;

export interface RentSchedule {
  slots: (RentSlot & { status: RentSlotStatus })[];
  /** Last day of the first run of paid periods; null when the first one is not paid. */
  paidUntil: string | null;
  /** Start of the first period not paid; null when everything is paid up to the end. */
  nextDueDate: string | null;
  /** Sum of the periods started and not paid. */
  amountDue: Money;
  alerts: RentAlert[];
}

/**
 * The contract's periods up to today and the next one after what is paid, each PAID
 * (covered by a payment), DUE or UPCOMING. `payments` are the periods of its valid rent
 * payments, aligned on the contract's periods.
 */
export function rentSchedule(
  terms: RentTerms,
  payments: readonly { periodStart: string; periodEnd: string }[],
  today: string,
): RentSchedule {
  const lastPaid = payments.reduce<string | null>(
    (acc, p) => (acc === null || p.periodEnd > acc ? p.periodEnd : acc),
    null,
  );
  const horizon = lastPaid && addDays(lastPaid, 1) > today ? addDays(lastPaid, 1) : today;
  const slots = rentSlots(terms, horizon).map((slot) => {
    const paid = payments.some((p) => p.periodStart <= slot.start && p.periodEnd >= slot.end);
    const status: RentSlotStatus = paid
      ? RentSlotStatus.PAID
      : slot.start <= today
        ? RentSlotStatus.DUE
        : RentSlotStatus.UPCOMING;
    return { ...slot, status };
  });
  const firstOpen = slots.findIndex((s) => s.status !== RentSlotStatus.PAID);
  const paidRun = firstOpen < 0 ? slots : slots.slice(0, firstOpen);
  const amountDue = slots
    .filter((s) => s.status === RentSlotStatus.DUE)
    .reduce<Money>((acc, s) => acc.plus(s.amount), ZERO);
  const alerts: RentAlert[] = [];
  if (
    terms.endDate &&
    terms.endDate >= today &&
    terms.endDate <= addDays(today, RENT_ENDING_SOON_DAYS)
  ) {
    alerts.push(RentAlert.ENDING_SOON);
  }
  if (amountDue.gt(0)) alerts.push(RentAlert.UNPAID_DUE);
  return {
    slots,
    paidUntil: paidRun.at(-1)?.end ?? null,
    nextDueDate: firstOpen < 0 ? null : slots[firstOpen]!.start,
    amountDue,
    alerts,
  };
}
