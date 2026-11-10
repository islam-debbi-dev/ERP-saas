import { describe, expect, it } from 'vitest';
import { Role } from './enums';
import {
  chartBuckets,
  DASHBOARD_CARD_IDS,
  defaultDashboardLayout,
  normalizeDashboardLayout,
  pickGreetingFact,
  previousBucket,
  resolveDashboardPeriod,
  salesTargetProgress,
} from './dashboard';

describe('resolveDashboardPeriod (Algiers days)', () => {
  it('today, 7 days and this month stop today; previous is the same length just before', () => {
    expect(resolveDashboardPeriod('today', '2026-11-10')).toEqual({
      period: 'today',
      from: '2026-11-10',
      to: '2026-11-10',
      previousFrom: '2026-11-09',
      previousTo: '2026-11-09',
      bucket: 'day',
    });
    expect(resolveDashboardPeriod('7d', '2026-11-03')).toMatchObject({
      from: '2026-10-28',
      to: '2026-11-03',
      previousFrom: '2026-10-21',
      previousTo: '2026-10-27',
    });
    expect(resolveDashboardPeriod('month', '2026-11-10')).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-10',
      previousFrom: '2026-10-22',
      previousTo: '2026-10-31',
    });
  });

  it('last month across a year and with 31 then 30 days', () => {
    expect(resolveDashboardPeriod('lastMonth', '2026-01-15')).toMatchObject({
      from: '2025-12-01',
      to: '2025-12-31',
      previousFrom: '2025-10-31',
      previousTo: '2025-11-30',
    });
    // November has 30 days: compared with the 30 days before (1–30 October).
    expect(resolveDashboardPeriod('lastMonth', '2026-12-01')).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-30',
      previousFrom: '2026-10-02',
      previousTo: '2026-10-31',
    });
    // February of a leap year.
    expect(resolveDashboardPeriod('lastMonth', '2028-03-31')).toMatchObject({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('custom takes the range; above 31 days the chart goes by week', () => {
    const r = resolveDashboardPeriod('custom', '2026-11-10', {
      from: '2026-01-01',
      to: '2026-03-01',
    });
    expect(r).toMatchObject({
      previousFrom: '2025-11-02',
      previousTo: '2025-12-31',
      bucket: 'week',
    });
    expect(() => resolveDashboardPeriod('custom', '2026-11-10')).toThrow();
    expect(
      resolveDashboardPeriod('custom', '2026-11-10', { from: '2026-10-01', to: '2026-10-31' })
        .bucket,
    ).toBe('day');
  });
});

describe('chartBuckets', () => {
  it('one bar per day, or weeks from the first day with a shorter last one', () => {
    expect(chartBuckets(resolveDashboardPeriod('7d', '2026-11-10'))).toHaveLength(7);
    const weeks = chartBuckets(
      resolveDashboardPeriod('custom', '2026-11-10', { from: '2026-01-01', to: '2026-02-10' }),
    );
    expect(weeks).toHaveLength(6);
    expect(weeks[0]).toEqual({ from: '2026-01-01', to: '2026-01-07' });
    expect(weeks.at(-1)).toEqual({ from: '2026-02-05', to: '2026-02-10' });
  });

  it('the previous bucket is shifted by the period length', () => {
    const r = resolveDashboardPeriod('7d', '2026-11-10');
    expect(previousBucket(r, { from: '2026-11-04', to: '2026-11-04' })).toEqual({
      from: '2026-10-28',
      to: '2026-10-28',
    });
  });
});

describe('salesTargetProgress', () => {
  it('percent, what is left and the days left, today included', () => {
    expect(salesTargetProgress('1000000', '452300.50', '2026-11-10')).toEqual({
      amount: '1000000.00',
      achieved: '452300.50',
      pct: '45.2',
      remaining: '547699.50',
      daysLeft: 21,
    });
    // Reached: nothing left, the percent passes 100.
    expect(salesTargetProgress('100', '150', '2026-02-28')).toMatchObject({
      pct: '150.0',
      remaining: '0.00',
      daysLeft: 1,
    });
  });
});

describe('pickGreetingFact', () => {
  const days = (...ttc: string[]) =>
    ttc.map((v, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, ttc: v }));
  const base = { chequesDueToday: null, monthChangePct: null, overLimitCount: null };

  it('cheques due today come first', () => {
    expect(
      pickGreetingFact({
        ...base,
        chequesDueToday: 3,
        today: '2026-11-03',
        monthDays: days('9', '99', '1'),
      }),
    ).toEqual({ key: 'chequesToday', params: { count: 3 } });
  });

  it('yesterday was the best day of the month (today, still running, does not count)', () => {
    expect(
      pickGreetingFact({
        ...base,
        today: '2026-11-03',
        monthDays: days('100', '452300', '999999'),
      }),
    ).toEqual({ key: 'bestDayYesterday', params: { amount: '452300.00' } });
    // Not the best, or the first day of the month: the trend instead.
    expect(
      pickGreetingFact({
        ...base,
        today: '2026-11-03',
        monthDays: days('500', '100', '0'),
        monthChangePct: '12.4',
      }),
    ).toEqual({ key: 'salesUp', params: { pct: '12' } });
  });

  it('a small trend says nothing; then the clients over their plafond; else nothing', () => {
    const quiet = { ...base, today: '2026-11-01', monthDays: days('0'), monthChangePct: '-4.9' };
    expect(pickGreetingFact(quiet)).toBeNull();
    expect(pickGreetingFact({ ...quiet, monthChangePct: '-8.0' })).toEqual({
      key: 'salesDown',
      params: { pct: '8' },
    });
    expect(pickGreetingFact({ ...quiet, overLimitCount: 2 })).toEqual({
      key: 'overLimit',
      params: { count: 2 },
    });
  });
});

describe('dashboard layout', () => {
  it('each role starts with its own order and every card', () => {
    expect(defaultDashboardLayout(Role.OWNER).order.slice(0, 2)).toEqual(['todo', 'figures']);
    expect(defaultDashboardLayout(Role.SELLER).order.slice(0, 3)).toEqual([
      'todo',
      'objectives',
      'figures',
    ]);
    expect(defaultDashboardLayout(Role.STOREKEEPER).order[0]).toBe('stock');
    for (const role of Object.values(Role)) {
      expect([...defaultDashboardLayout(role).order].sort()).toEqual(
        [...DASHBOARD_CARD_IDS].sort(),
      );
    }
  });

  it('a saved layout drops unknown ids and duplicates, and gets the cards it does not know', () => {
    const read = normalizeDashboardLayout(
      { order: ['chart', 'old-card', 'todo', 'chart'], hidden: ['stock', 'gone', 'stock'] },
      Role.OWNER,
    );
    expect(read.order.slice(0, 2)).toEqual(['chart', 'todo']);
    expect(read.order).not.toContain('old-card');
    expect([...read.order].sort()).toEqual([...DASHBOARD_CARD_IDS].sort());
    expect(read.hidden).toEqual(['stock']);
    expect(normalizeDashboardLayout(null, Role.SELLER)).toEqual(
      defaultDashboardLayout(Role.SELLER),
    );
    expect(normalizeDashboardLayout('junk', Role.OWNER)).toEqual(
      defaultDashboardLayout(Role.OWNER),
    );
  });
});
