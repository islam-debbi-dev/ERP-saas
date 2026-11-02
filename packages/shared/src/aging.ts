/**
 * Aging (balance âgée, phase 21): how long each part of an account has been owed.
 * Pure functions, no I/O. The account balance is the ledger; aging only spreads it
 * over the buckets, and the buckets always sum to it.
 */
import { money, type Money, type MoneyInput } from './money';
import { AGING_BUCKETS, type AgingBucket } from './schemas/credit';

/** A document (or an opening debit) that put money on the account. */
export interface AgingDocument {
  /** Document day, `YYYY-MM-DD`. */
  date: string;
  total: string;
  /** Avoirs / returns on this document. */
  returned?: string;
  /** Payments allocated to this document. */
  paid?: string;
}

export interface AgingResult {
  buckets: Record<AgingBucket, Money>;
  /** Age of the oldest amount still owed; null when nothing is owed. */
  oldestDays: number | null;
  /** Day of that amount. */
  oldestDate: string | null;
}

const DAY_MS = 86_400_000;

/** Whole days from `date` to `asOf` (both `YYYY-MM-DD`); never negative. */
export function daysBetween(date: string, asOf: string): number {
  const diff = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`);
  return Math.max(0, Math.round(diff / DAY_MS));
}

export function agingBucketOf(days: number): AgingBucket {
  if (days <= 30) return 'd0_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90';
}

export function emptyBuckets(): Record<AgingBucket, Money> {
  return { d0_30: money(0), d31_60: money(0), d61_90: money(0), d90: money(0) };
}

/**
 * Spreads `balance` over the buckets. Each document counts for what is left on it
 * (total − returned − paid). What the documents do not explain is applied last:
 * unallocated credit (a versement not tied to a document, a negative opening, an
 * overpaid document) pays the oldest amounts first; an unexplained debit is current.
 * A credit left over once everything is paid stays in 0–30 as a negative amount.
 */
export function computeAging(
  documents: AgingDocument[],
  balance: string,
  asOf: string,
): AgingResult {
  const open = documents
    .map((d) => ({
      date: d.date,
      left: money(d.total)
        .minus(d.returned ?? '0')
        .minus(d.paid ?? '0'),
    }))
    .filter((d) => d.left.gt(0))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let residual = money(balance).minus(open.reduce((s, d) => s.plus(d.left), money(0)));
  if (residual.lt(0)) {
    for (const d of open) {
      if (residual.gte(0)) break;
      const take = d.left.lt(residual.abs()) ? d.left : residual.abs();
      d.left = d.left.minus(take);
      residual = residual.plus(take);
    }
  }

  const buckets = emptyBuckets();
  let oldest: string | null = null;
  for (const d of open) {
    if (d.left.lte(0)) continue;
    oldest ??= d.date;
    const bucket = agingBucketOf(daysBetween(d.date, asOf));
    buckets[bucket] = buckets[bucket].plus(d.left);
  }
  // An unexplained debit is current; a credit left over stays visible as negative.
  if (!residual.isZero()) {
    buckets.d0_30 = buckets.d0_30.plus(residual);
    if (residual.gt(0)) oldest ??= asOf;
  }
  return {
    buckets,
    oldestDays: oldest === null ? null : daysBetween(oldest, asOf),
    oldestDate: oldest,
  };
}

/**
 * The 90+ bucket of `computeAging` from three sums, so SQL can age many accounts without
 * sending every document (phase 26). `open` = what is left on the documents (those with
 * something left), `openOver90` = the part of it on documents older than 90 days. A
 * credit the documents do not explain (open − balance) pays the oldest first, and every
 * 90+ document is older than the others, so it comes off the 90+ part first.
 */
export function agedOver90(open: MoneyInput, openOver90: MoneyInput, balance: MoneyInput): Money {
  const credit = money(open).minus(balance);
  const left = money(openOver90).minus(credit.gt(0) ? credit : 0);
  return left.gt(0) ? left : money(0);
}

/** Adds `b` into `a`, bucket by bucket. */
export function addBuckets(a: Record<AgingBucket, Money>, b: Record<AgingBucket, Money>): void {
  for (const k of AGING_BUCKETS) a[k] = a[k].plus(b[k]);
}
