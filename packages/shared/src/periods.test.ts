import { describe, expect, it } from 'vitest';
import { addDays, algiersDay, monthToDate, previousMonthToDate, rangeLength } from './periods';

describe('algiersDay', () => {
  it('is one hour ahead of UTC', () => {
    expect(algiersDay(new Date('2026-10-20T22:30:00Z'))).toBe('2026-10-20'); // 23:30 local
    expect(algiersDay(new Date('2026-10-20T23:30:00Z'))).toBe('2026-10-21'); // 00:30 local
  });
});

describe('addDays', () => {
  it('crosses months and years', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('month periods', () => {
  it('runs month-to-date from the 1st', () => {
    expect(monthToDate('2026-10-20')).toEqual({ from: '2026-10-01', to: '2026-10-20' });
  });

  it('compares with the same days of last month', () => {
    expect(previousMonthToDate('2026-10-20')).toEqual({ from: '2026-09-01', to: '2026-09-20' });
  });

  it('clips to the shorter previous month', () => {
    expect(previousMonthToDate('2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousMonthToDate('2028-03-31')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(previousMonthToDate('2026-10-31')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('goes back across the year', () => {
    expect(previousMonthToDate('2027-01-15')).toEqual({ from: '2026-12-01', to: '2026-12-15' });
  });

  it('counts days inclusively', () => {
    expect(rangeLength({ from: '2026-10-01', to: '2026-10-01' })).toBe(1);
    expect(rangeLength({ from: '2026-01-01', to: '2026-12-31' })).toBe(365);
  });
});
