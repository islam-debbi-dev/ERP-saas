import { describe, expect, it } from 'vitest';
import { changePercent, netResult, periodRange, previousPeriod, sharePercent } from './overview';

describe('periodRange', () => {
  it('today is one day', () => {
    expect(periodRange('today', '2026-11-02')).toEqual({ from: '2026-11-02', to: '2026-11-02' });
  });

  it('the week starts on Sunday and stops today', () => {
    // 2026-11-02 is a Monday.
    expect(periodRange('week', '2026-11-02')).toEqual({ from: '2026-11-01', to: '2026-11-02' });
    expect(periodRange('week', '2026-11-01')).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(periodRange('week', '2026-11-07')).toEqual({ from: '2026-11-01', to: '2026-11-07' });
  });

  it('this month runs from the 1st to today', () => {
    expect(periodRange('month', '2026-11-02')).toEqual({ from: '2026-11-01', to: '2026-11-02' });
  });

  it('last month is the whole previous month, across January and February', () => {
    expect(periodRange('lastMonth', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(periodRange('lastMonth', '2028-03-31')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(periodRange('lastMonth', '2026-03-01')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });
});

describe('previousPeriod', () => {
  it('is the same number of days, ending the day before', () => {
    expect(previousPeriod({ from: '2026-11-02', to: '2026-11-02' })).toEqual({
      from: '2026-11-01',
      to: '2026-11-01',
    });
    expect(previousPeriod({ from: '2026-11-01', to: '2026-11-30' })).toEqual({
      from: '2026-10-02',
      to: '2026-10-31',
    });
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-07' })).toEqual({
      from: '2026-02-22',
      to: '2026-02-28',
    });
  });
});

describe('changePercent', () => {
  it('gives the signed change with one decimal, half-up', () => {
    expect(changePercent('1500', '1000')).toBe('50.0');
    expect(changePercent('750', '1000')).toBe('-25.0');
    expect(changePercent('1000.05', '1000')).toBe('0.0');
    expect(changePercent('1', '3')).toBe('-66.7');
    expect(changePercent('2', '3')).toBe('-33.3');
  });

  it('is null when there is nothing to compare with', () => {
    expect(changePercent('100', '0')).toBeNull();
    expect(changePercent('100', '-5')).toBeNull();
  });
});

describe('sharePercent', () => {
  it('gives the part of the whole', () => {
    expect(sharePercent('250', '1000')).toBe('25.0');
    expect(sharePercent('0', '1000')).toBe('0.0');
    expect(sharePercent('10', '0')).toBeNull();
  });
});

describe('netResult', () => {
  it('is margin minus charges, to the centime', () => {
    expect(netResult('120000.50', '45000.25')).toBe('75000.25');
    expect(netResult('10000.00', '25000.10')).toBe('-15000.10');
  });

  it('is unknown when the margin or the charges are', () => {
    expect(netResult(null, '100.00')).toBeNull();
    expect(netResult('100.00', null)).toBeNull();
  });
});
