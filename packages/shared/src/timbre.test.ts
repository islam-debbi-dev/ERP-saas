import { describe, expect, it } from 'vitest';
import { computeTimbre, type TimbreRule } from './timbre';

// Example values only (see README): tests check the mechanics, not the law.
const rule: TimbreRule = {
  enabled: true,
  threshold: '300.00',
  tranches: [
    { upTo: '30000.00', rate: '1' },
    { upTo: '100000.00', rate: '1.5' },
    { upTo: null, rate: '2' },
  ],
  min: '5.00',
  max: '10000.00',
};

const cash = (ttc: string, r: TimbreRule = rule) =>
  computeTimbre({ ttc, saleType: 'FACTURE', paymentMode: 'ESPECES', rule: r }).toFixed(2);

describe('computeTimbre', () => {
  it('is zero when the rule is disabled', () => {
    expect(cash('50000', { ...rule, enabled: false })).toBe('0.00');
  });

  it('is zero for a non-cash payment or no payment', () => {
    for (const paymentMode of ['CHEQUE', 'VIREMENT', null]) {
      expect(
        computeTimbre({ ttc: '50000', saleType: 'FACTURE', paymentMode, rule }).toFixed(2),
      ).toBe('0.00');
    }
  });

  it('is zero for a bon de livraison', () => {
    expect(
      computeTimbre({ ttc: '50000', saleType: 'BL', paymentMode: 'ESPECES', rule }).toFixed(2),
    ).toBe('0.00');
  });

  it('is zero below the threshold and applies from the threshold', () => {
    expect(cash('299.99')).toBe('0.00');
    expect(cash('300.00')).toBe('5.00'); // 3.00 raised to the minimum
  });

  it('taxes the whole amount at the rate of its tranche, bounds inclusive', () => {
    expect(cash('30000.00')).toBe('300.00');
    expect(cash('30000.01')).toBe('450.00'); // 1.5 % of 30 000.01 = 450.00015
    expect(cash('100000.00')).toBe('1500.00');
    expect(cash('100000.01')).toBe('2000.00');
  });

  it('applies the minimum and the maximum', () => {
    expect(cash('400')).toBe('5.00');
    expect(cash('1000000')).toBe('10000.00');
    expect(cash('1000000', { ...rule, max: null })).toBe('20000.00');
  });

  it('rounds half-up to the centime', () => {
    expect(cash('1234.50')).toBe('12.35'); // 12.345
  });

  it('uses the last tranche when no tranche is open-ended', () => {
    expect(cash('200000', { ...rule, tranches: [{ upTo: '1000', rate: '1' }], max: null })).toBe(
      '2000.00',
    );
  });

  it('is zero with no tranches or a zero TTC', () => {
    expect(cash('5000', { ...rule, tranches: [] })).toBe('0.00');
    expect(cash('0', { ...rule, threshold: null })).toBe('0.00');
  });
});
