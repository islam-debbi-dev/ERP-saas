import { describe, expect, it } from 'vitest';
import { splitAmounts, type TextPart } from './split-amounts';

const of = (kind: TextPart['kind'], text: string) =>
  splitAmounts(text)
    .filter((p) => p.kind === kind)
    .map((p) => p.text);
const amounts = (text: string) => of('amount', text);
const dates = (text: string) => of('date', text);
const joined = (text: string) =>
  splitAmounts(text)
    .map((p) => p.text)
    .join('');

describe('splitAmounts', () => {
  it('finds an amount inside Arabic', () => {
    expect(splitAmounts('عند كريم: 1 234 567,89 DA.')).toEqual([
      { text: 'عند كريم: ', kind: 'text' },
      { text: '1 234 567,89 DA', kind: 'amount' },
      { text: '.', kind: 'text' },
    ]);
  });

  it('handles the spaces and currencies models use', () => {
    expect(amounts('125 000 دج')).toEqual(['125 000 دج']);
    expect(amounts('1 234,50 DA')).toEqual(['1 234,50 DA']);
    expect(amounts('500 DA et 12,50')).toEqual(['500 DA', '12,50']);
  });

  it('isolates ISO and slash dates inside Arabic', () => {
    expect(splitAmounts('تاريخ الاستحقاق 2026-11-20.')).toEqual([
      { text: 'تاريخ الاستحقاق ', kind: 'text' },
      { text: '2026-11-20', kind: 'date' },
      { text: '.', kind: 'text' },
    ]);
    expect(dates('الفاتورة بتاريخ 20/11/2026 و 5/1/26 و 20/11')).toEqual([
      '20/11/2026',
      '5/1/26',
      '20/11',
    ]);
  });

  it('finds a date and an amount side by side', () => {
    const text = 'دفع 12 500,00 DA يوم 2026-11-20 (20/11/2026)';
    expect(amounts(text)).toEqual(['12 500,00 DA']);
    expect(dates(text)).toEqual(['2026-11-20', '20/11/2026']);
  });

  it('leaves document numbers and small counts alone', () => {
    expect(amounts('BL-2026-000123 du 2026-11-05, 3 cartons')).toEqual([]);
    expect(dates('BL-2026-000123 du 2026-11-05, 3 cartons')).toEqual(['2026-11-05']);
    expect(dates('BL-2026-000123, TR-2026-000031')).toEqual([]);
    expect(splitAmounts('salam')).toEqual([{ text: 'salam', kind: 'text' }]);
    expect(splitAmounts('')).toEqual([]);
  });

  it('never loses a character', () => {
    for (const text of [
      'a 1 000 DA b 2 000,50 c',
      'du 2026-11-20 au 30/11/2026, 1 500 DA',
      '2026-11-20',
    ]) {
      expect(joined(text)).toBe(text);
    }
  });
});
