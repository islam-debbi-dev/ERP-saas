import { algiersMonth, algiersToday, costMicroUsd } from './usage-math';

describe('cost', () => {
  const opus = { input: '4', cachedInput: '0.2', output: '20' };

  it('pays cached tokens at their own rate', () => {
    const usage = { inputTokens: 10_000, cachedTokens: 9_000, outputTokens: 100 };
    // 1 000 × 4 + 9 000 × 0.2 + 100 × 20
    expect(costMicroUsd(usage, opus)).toBe(7_800n);
  });

  it('is exact on fractions of a price', () => {
    const usage = { inputTokens: 3, cachedTokens: 0, outputTokens: 0 };
    expect(costMicroUsd(usage, { input: '0.1', cachedInput: '0', output: '0' })).toBe(0n);
    expect(costMicroUsd({ ...usage, inputTokens: 5 }, { ...opus, input: '0.1' })).toBe(1n);
  });

  it('costs nothing on free prices', () => {
    const usage = { inputTokens: 500, cachedTokens: 0, outputTokens: 500 };
    expect(costMicroUsd(usage, { input: '0', cachedInput: '0', output: '0' })).toBe(0n);
  });

  it('survives a provider that counts more cached than input', () => {
    const usage = { inputTokens: 10, cachedTokens: 20, outputTokens: 0 };
    expect(costMicroUsd(usage, opus)).toBe(4n);
  });
});

describe('quota periods', () => {
  it('uses the Algiers month, which starts an hour before UTC', () => {
    // 31 Jan 23:30 UTC is already 1 Feb 00:30 in Algiers.
    const month = algiersMonth(new Date('2026-01-31T23:30:00Z'));
    expect(month.start.toISOString()).toBe('2026-01-31T23:00:00.000Z');
    expect(month.end.toISOString()).toBe('2026-02-28T23:00:00.000Z');
    expect(month.resetDate).toBe('2026-03-01');
  });

  it('keeps the old month until Algiers midnight', () => {
    const month = algiersMonth(new Date('2026-01-31T22:30:00Z'));
    expect(month.resetDate).toBe('2026-02-01');
  });

  it('crosses the year', () => {
    expect(algiersMonth(new Date('2026-12-15T12:00:00Z')).resetDate).toBe('2027-01-01');
  });

  it('covers one Algiers day', () => {
    const day = algiersToday(new Date('2026-03-30T23:30:00Z'));
    expect(day.start.toISOString()).toBe('2026-03-30T23:00:00.000Z');
    expect(day.end.toISOString()).toBe('2026-03-31T23:00:00.000Z');
  });
});
