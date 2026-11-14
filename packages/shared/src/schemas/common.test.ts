import { describe, expect, it } from 'vitest';
import { recordSubscriptionPaymentSchema } from './admin';
import { createProductSchema } from './catalog';
import { amountString, MAX_MONEY, MAX_QUANTITY, normalizeDecimal, quantityString } from './common';
import { createPaymentSchema } from './payments';

// Audit 01 #2 and audit 02, B-4: these values answered 500.
describe('amounts and quantities have a maximum', () => {
  it('an amount is at most MAX_MONEY', () => {
    expect(amountString.safeParse(MAX_MONEY).success).toBe(true);
    expect(amountString.safeParse('9 999 999 999,99').success).toBe(true);
    for (const v of ['10000000000', '999999999999.99', '9999999999999999.99']) {
      expect(amountString.safeParse(v).success).toBe(false);
    }
  });

  it('a quantity is at most MAX_QUANTITY', () => {
    const q = quantityString({ positive: true });
    expect(q.safeParse(MAX_QUANTITY).success).toBe(true);
    expect(q.safeParse('100000000').success).toBe(false);
    expect(q.safeParse('9999999999999999.99').success).toBe(false);
  });

  it('a versement over the maximum is a validation issue on its amount', () => {
    const r = createPaymentSchema.safeParse({
      clientId: '4bc5af03-9283-401f-a992-09be29a24366',
      mode: 'ESPECES',
      amount: '999999999999.99',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('amount');
  });
});

describe('a value that is not a number is an issue, never an exception', () => {
  it('normalizeDecimal gives it back unchanged', () => {
    expect(normalizeDecimal('1 500,5')).toBe('1500.5');
    expect(normalizeDecimal('')).toBe('');
    expect(normalizeDecimal('١٢٣')).toBe('١٢٣');
  });

  it.each(['', '١٢٣', 'abc'])('a product whose unit factor is %j', (factorToBase) => {
    const unitId = '4bc5af03-9283-401f-a992-09be29a24366';
    const parse = () =>
      createProductSchema.safeParse({
        reference: 'P1',
        designation: 'Article',
        baseUnitId: unitId,
        tvaRate: '19',
        units: [{ unitId, factorToBase, isDefaultSale: true, isDefaultPurchase: true }],
        prices: [],
      });
    expect(parse).not.toThrow();
    const r = parse();
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('units.0.factorToBase');
  });

  it('a platform payment whose amount is empty', () => {
    const parse = () => recordSubscriptionPaymentSchema.safeParse({ amount: '' });
    expect(parse).not.toThrow();
    expect(parse().success).toBe(false);
  });
});
