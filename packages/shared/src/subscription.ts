/**
 * Subscription lifecycle (phase 13). Only TRIAL and ACTIVE are stored; PAST_DUE and
 * SUSPENDED are derived from the period end and the current time, so no scheduled job
 * has to move a tenant from one state to the next.
 */

export const SubscriptionStatus = {
  TRIAL: 'TRIAL',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

/** The statuses written in the database. */
export type StoredSubscriptionStatus = 'TRIAL' | 'ACTIVE';

export const SubscriptionPaymentMethod = {
  BARIDIMOB: 'BARIDIMOB',
  VIREMENT: 'VIREMENT',
  ESPECES: 'ESPECES',
} as const;
export type SubscriptionPaymentMethod =
  (typeof SubscriptionPaymentMethod)[keyof typeof SubscriptionPaymentMethod];
export const SUBSCRIPTION_PAYMENT_METHODS = Object.values(SubscriptionPaymentMethod);

export const TRIAL_DAYS = 30;
/** Days after the period end during which the tenant can still write (PAST_DUE). */
export const GRACE_DAYS = 7;
/** A trial ending within this many days shows a banner. */
export const TRIAL_WARNING_DAYS = 7;

const DAY_MS = 24 * 3600 * 1000;

export interface SubscriptionDates {
  status: StoredSubscriptionStatus;
  isFree: boolean;
  currentPeriodEnd: Date;
}

/**
 * The status a tenant is in at `now`. A free (pilot) tenant is always ACTIVE.
 * PAST_DUE lasts GRACE_DAYS after the period end; then the tenant is SUSPENDED
 * (read-only, never locked out of its data).
 */
export function effectiveSubscriptionStatus(sub: SubscriptionDates, now: Date): SubscriptionStatus {
  if (sub.isFree) return SubscriptionStatus.ACTIVE;
  const end = sub.currentPeriodEnd.getTime();
  if (now.getTime() <= end) return sub.status;
  if (now.getTime() <= end + GRACE_DAYS * DAY_MS) return SubscriptionStatus.PAST_DUE;
  return SubscriptionStatus.SUSPENDED;
}

/** When a PAST_DUE tenant becomes SUSPENDED. */
export function graceEndsAt(currentPeriodEnd: Date): Date {
  return new Date(currentPeriodEnd.getTime() + GRACE_DAYS * DAY_MS);
}

/** Whole days from `now` until `until`, rounded up, never negative. */
export function daysUntil(until: Date, now: Date): number {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY_MS));
}

/** Adds calendar months in UTC, clamping to the last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * The new period of a payment of `months`: it starts at the current period end if that is
 * still ahead (paying early loses nothing), otherwise now (a late payer does not pay for
 * the days spent suspended).
 */
export function extendPeriod(
  currentPeriodEnd: Date,
  months: number,
  now: Date,
): { from: Date; to: Date } {
  const from = currentPeriodEnd.getTime() > now.getTime() ? currentPeriodEnd : now;
  return { from, to: addMonths(from, months) };
}
