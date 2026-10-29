import { describe, expect, it } from 'vitest';
import {
  addMonths,
  daysUntil,
  effectiveSubscriptionStatus,
  extendPeriod,
  graceEndsAt,
} from './subscription';

const DAY = 24 * 3600 * 1000;
const start = new Date('2026-11-01T10:00:00.000Z');
const trialEnd = new Date(start.getTime() + 30 * DAY);
const at = (days: number) => new Date(start.getTime() + days * DAY);
const trial = { status: 'TRIAL' as const, isFree: false, currentPeriodEnd: trialEnd };

describe('effectiveSubscriptionStatus', () => {
  it('stays in the stored status until the period end, included', () => {
    expect(effectiveSubscriptionStatus(trial, at(0))).toBe('TRIAL');
    expect(effectiveSubscriptionStatus(trial, at(30))).toBe('TRIAL');
    expect(effectiveSubscriptionStatus({ ...trial, status: 'ACTIVE' }, at(29))).toBe('ACTIVE');
  });

  it('is PAST_DUE for the 7 grace days, then SUSPENDED', () => {
    expect(effectiveSubscriptionStatus(trial, new Date(trialEnd.getTime() + 1))).toBe('PAST_DUE');
    expect(effectiveSubscriptionStatus(trial, at(31))).toBe('PAST_DUE');
    expect(effectiveSubscriptionStatus(trial, at(37))).toBe('PAST_DUE');
    expect(effectiveSubscriptionStatus(trial, new Date(at(37).getTime() + 1))).toBe('SUSPENDED');
    expect(effectiveSubscriptionStatus(trial, at(400))).toBe('SUSPENDED');
  });

  it('never suspends a free tenant', () => {
    expect(effectiveSubscriptionStatus({ ...trial, isFree: true }, at(400))).toBe('ACTIVE');
  });

  it('graceEndsAt is 7 days after the period end', () => {
    expect(graceEndsAt(trialEnd).toISOString()).toBe(at(37).toISOString());
  });
});

describe('daysUntil', () => {
  it('rounds up and never goes below zero', () => {
    expect(daysUntil(trialEnd, at(0))).toBe(30);
    expect(daysUntil(trialEnd, new Date(at(29).getTime() + 1))).toBe(1);
    expect(daysUntil(trialEnd, at(31))).toBe(0);
  });
});

describe('addMonths / extendPeriod', () => {
  it('clamps to the end of a shorter month', () => {
    expect(addMonths(new Date('2027-01-31T12:00:00Z'), 1).toISOString()).toBe(
      '2027-02-28T12:00:00.000Z',
    );
    expect(addMonths(new Date('2028-01-31T12:00:00Z'), 1).toISOString()).toBe(
      '2028-02-29T12:00:00.000Z',
    );
    expect(addMonths(new Date('2026-11-15T00:00:00Z'), 12).toISOString()).toBe(
      '2027-11-15T00:00:00.000Z',
    );
  });

  it('extends from the period end when paid early', () => {
    const { from, to } = extendPeriod(trialEnd, 1, at(10));
    expect(from).toEqual(trialEnd);
    expect(to).toEqual(addMonths(trialEnd, 1));
  });

  it('extends from now when paid late', () => {
    const now = at(45);
    const { from, to } = extendPeriod(trialEnd, 3, now);
    expect(from).toEqual(now);
    expect(to).toEqual(addMonths(now, 3));
  });
});
