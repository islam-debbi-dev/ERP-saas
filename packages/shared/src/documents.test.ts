import { describe, expect, it } from 'vitest';
import { computeTotals } from './documents';

describe('computeTotals', () => {
  const lines = [
    { qty: '2', unitPrice: '4600', tvaRate: '19' }, // 9 200
    { qty: '3', unitPrice: '333.335', tvaRate: '19' }, // 1 000.005 -> 1 000.01
    { qty: '10', unitPrice: '95', tvaRate: '9' }, // 950
    { qty: '1', unitPrice: '120', tvaRate: '0' }, // 120
  ];

  it('rounds each line HT and groups TVA by rate on the summed HT', () => {
    const r = computeTotals(lines, true);
    expect(r.lines.map((l) => l.lineHt.toString())).toEqual(['9200', '1000.01', '950', '120']);
    expect(
      r.tvaByRate.map((t) => [t.rate.toString(), t.baseHt.toString(), t.tva.toString()]),
    ).toEqual([
      ['0', '120', '0'],
      ['9', '950', '85.5'],
      ['19', '10200.01', '1938'],
    ]);
    expect(r.totalHt.toString()).toBe('11270.01');
    expect(r.totalTva.toString()).toBe('2023.5');
    expect(r.totalTtc.toString()).toBe('13293.51');
  });

  it('rounds TVA once per rate, not per line', () => {
    // 7 lines of 0.03 at 19 %: per line 0.0057 -> 0.01 each = 0.07; on the sum 0.21 x 19 % = 0.0399 -> 0.04
    const r = computeTotals(
      Array.from({ length: 7 }, () => ({ qty: '1', unitPrice: '0.03', tvaRate: '19' })),
      true,
    );
    expect(r.totalTva.toString()).toBe('0.04');
  });

  it('a tenant not subject to TVA (IFU) has no TVA and TTC = HT', () => {
    const r = computeTotals(lines, false);
    expect(r.tvaByRate).toEqual([]);
    expect(r.totalTva.toString()).toBe('0');
    expect(r.totalTtc.toString()).toBe('11270.01');
  });

  it('handles an empty document', () => {
    const r = computeTotals([], true);
    expect([r.totalHt.toString(), r.totalTva.toString(), r.totalTtc.toString()]).toEqual([
      '0',
      '0',
      '0',
    ]);
  });
});
