import { describe, expect, it } from 'vitest';
import { splitAmounts } from './split-amounts';

const amounts = (text: string) =>
  splitAmounts(text)
    .filter((p) => p.amount)
    .map((p) => p.text);

describe('splitAmounts', () => {
  it('finds an amount inside Arabic', () => {
    expect(splitAmounts('عند كريم: 1 234 567,89 DA.')).toEqual([
      { text: 'عند كريم: ', amount: false },
      { text: '1 234 567,89 DA', amount: true },
      { text: '.', amount: false },
    ]);
  });

  it('handles the spaces and currencies models use', () => {
    expect(amounts('125 000 دج')).toEqual(['125 000 دج']);
    expect(amounts('1 234,50 DA')).toEqual(['1 234,50 DA']);
    expect(amounts('500 DA et 12,50')).toEqual(['500 DA', '12,50']);
  });

  it('leaves everything else alone', () => {
    expect(amounts('BL-2026-000123 du 2026-11-05, 3 cartons')).toEqual([]);
    expect(
      splitAmounts('salam')
        .map((p) => p.text)
        .join(''),
    ).toBe('salam');
  });

  it('never loses a character', () => {
    const text = 'a 1 000 DA b 2 000,50 c';
    expect(
      splitAmounts(text)
        .map((p) => p.text)
        .join(''),
    ).toBe(text);
  });
});
