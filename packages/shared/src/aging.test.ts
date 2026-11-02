import { describe, expect, it } from 'vitest';
import { agedOver90, agingBucketOf, computeAging, daysBetween } from './aging';
import { AGING_BUCKETS } from './schemas/credit';
import { money } from './money';
import { addDays } from './periods';

const AS_OF = '2026-10-29';
const strings = (r: ReturnType<typeof computeAging>) =>
  Object.fromEntries(AGING_BUCKETS.map((k) => [k, r.buckets[k].toFixed(2)]));
const sumOf = (r: ReturnType<typeof computeAging>) =>
  AGING_BUCKETS.reduce((s, k) => s.plus(r.buckets[k]), money(0)).toFixed(2);

describe('aging buckets', () => {
  it('counts days and picks the bucket at the edges', () => {
    expect(daysBetween('2026-10-29', AS_OF)).toBe(0);
    expect(daysBetween('2026-09-29', AS_OF)).toBe(30);
    expect(daysBetween('2026-11-02', AS_OF)).toBe(0);
    expect([0, 30, 31, 60, 61, 90, 91].map(agingBucketOf)).toEqual([
      'd0_30',
      'd0_30',
      'd31_60',
      'd31_60',
      'd61_90',
      'd61_90',
      'd90',
    ]);
  });

  it('puts what is left of a partly paid document in its age bucket', () => {
    const r = computeAging(
      [
        { date: '2026-08-10', total: '100000', paid: '60000' }, // 80 days: 40 000 left
        { date: '2026-10-20', total: '25000' },
      ],
      '65000',
      AS_OF,
    );
    expect(strings(r)).toEqual({
      d0_30: '25000.00',
      d31_60: '0.00',
      d61_90: '40000.00',
      d90: '0.00',
    });
    expect(r.oldestDays).toBe(80);
    expect(sumOf(r)).toBe('65000.00');
  });

  it('takes avoirs off the document they return', () => {
    const r = computeAging(
      [{ date: '2026-07-01', total: '50000', returned: '10000', paid: '15000' }],
      '25000',
      AS_OF,
    );
    expect(strings(r).d90).toBe('25000.00');
    expect(sumOf(r)).toBe('25000.00');
  });

  it('lets unallocated credit pay the oldest bucket first', () => {
    const r = computeAging(
      [
        { date: '2026-07-01', total: '30000' },
        { date: '2026-09-15', total: '20000' },
        { date: '2026-10-25', total: '10000' },
      ],
      // A 35 000 versement allocated to nothing.
      '25000',
      AS_OF,
    );
    expect(strings(r)).toEqual({
      d0_30: '10000.00',
      d31_60: '15000.00',
      d61_90: '0.00',
      d90: '0.00',
    });
    expect(r.oldestDate).toBe('2026-09-15');
    expect(sumOf(r)).toBe('25000.00');
  });

  it('keeps an overpayment as a negative current amount', () => {
    const r = computeAging([{ date: '2026-06-01', total: '10000', paid: '10000' }], '-5000', AS_OF);
    expect(strings(r)).toEqual({ d0_30: '-5000.00', d31_60: '0.00', d61_90: '0.00', d90: '0.00' });
    expect(r.oldestDays).toBeNull();
  });

  it('treats an overpaid document as credit for the others', () => {
    const r = computeAging(
      [
        // Paid in full, then 4 000 returned: 4 000 in the client's favour.
        { date: '2026-10-01', total: '20000', returned: '4000', paid: '20000' },
        { date: '2026-06-01', total: '9000' },
      ],
      '5000',
      AS_OF,
    );
    expect(strings(r).d90).toBe('5000.00');
    expect(sumOf(r)).toBe('5000.00');
  });

  it('counts a debit no document explains as current', () => {
    const r = computeAging([], '1500', AS_OF);
    expect(strings(r).d0_30).toBe('1500.00');
    expect(r.oldestDays).toBe(0);
  });
});

describe('agedOver90', () => {
  /** A seeded generator, so a failure is the same on every run. */
  const random = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };

  it('is the 90+ bucket of computeAging, from three sums', () => {
    const next = random(26);
    for (let run = 0; run < 500; run++) {
      const docs = Array.from({ length: Math.floor(next() * 8) }, () => ({
        date: addDays(AS_OF, -Math.floor(next() * 200)),
        total: (Math.floor(next() * 100_000) / 100).toFixed(2),
        returned: next() < 0.2 ? (Math.floor(next() * 20_000) / 100).toFixed(2) : '0',
        paid: next() < 0.4 ? (Math.floor(next() * 60_000) / 100).toFixed(2) : '0',
      }));
      const lefts = docs.map((d) => ({
        old: daysBetween(d.date, AS_OF) > 90,
        left: money(d.total).minus(d.returned).minus(d.paid),
      }));
      const open = lefts.filter((l) => l.left.gt(0));
      const openSum = open.reduce((s, l) => s.plus(l.left), money(0));
      const oldSum = open.filter((l) => l.old).reduce((s, l) => s.plus(l.left), money(0));
      // The balance: anywhere from a credit beyond everything to an unexplained debit.
      const balance = openSum.times(next() * 1.6 - 0.3).toDecimalPlaces(2);
      const expected = computeAging(docs, balance.toFixed(2), AS_OF).buckets.d90;
      expect(agedOver90(openSum, oldSum, balance).toFixed(2)).toBe(expected.toFixed(2));
    }
  });

  it('a credit pays the oldest first; an unexplained debit stays current', () => {
    expect(agedOver90('1000', '600', '1000').toFixed(2)).toBe('600.00');
    expect(agedOver90('1000', '600', '700').toFixed(2)).toBe('300.00');
    expect(agedOver90('1000', '600', '300').toFixed(2)).toBe('0.00');
    expect(agedOver90('1000', '600', '1500').toFixed(2)).toBe('600.00');
  });
});
