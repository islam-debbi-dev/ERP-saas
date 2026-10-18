import { describe, expect, it } from 'vitest';
import { priceTtc, suggestedPackagingPrice } from './pricing';

describe('priceTtc', () => {
  it('adds TVA and rounds half-up', () => {
    expect(priceTtc('100', '19', true).toString()).toBe('119');
    expect(priceTtc('99.99', '9', true).toString()).toBe('108.99');
    expect(priceTtc('10.05', '19', true).toString()).toBe('11.96');
  });

  it('is the HT price when the tenant is not subject to TVA', () => {
    expect(priceTtc('100', '19', false).toString()).toBe('100');
  });

  it('handles a 0 % rate', () => {
    expect(priceTtc('250.5', '0', true).toString()).toBe('250.5');
  });
});

describe('suggestedPackagingPrice', () => {
  it('multiplies the base price by the factor', () => {
    expect(suggestedPackagingPrice('45.50', '24').toString()).toBe('1092');
    expect(suggestedPackagingPrice('12.333', '3').toString()).toBe('37');
  });
});
