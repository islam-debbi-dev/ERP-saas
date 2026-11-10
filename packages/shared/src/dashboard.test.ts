import { describe, expect, it } from 'vitest';
import { chartBuckets, previousBucket, resolveDashboardPeriod } from './dashboard';

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
