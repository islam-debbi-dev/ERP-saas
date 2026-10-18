import { describe, expect, it } from 'vitest';
import { createProductSchema, PRODUCT_RULES, updateProductSchema } from './catalog';

const PIECE = '11111111-1111-4111-8111-111111111111';
const CARTON = '22222222-2222-4222-8222-222222222222';
const GROS = '33333333-3333-4333-8333-333333333333';

const valid = {
  reference: 'HUILE-5L',
  designation: 'Huile Elio 5 L',
  baseUnitId: PIECE,
  tvaRate: '19',
  units: [
    { unitId: PIECE, factorToBase: '1', barcode: '6130000000011', isDefaultSale: true },
    { unitId: CARTON, factorToBase: '4', barcode: '6130000000028', isDefaultPurchase: true },
  ],
  prices: [
    { unitId: PIECE, priceLevelId: GROS, priceHt: '1 250,00' },
    { unitId: CARTON, priceLevelId: GROS, priceHt: '4900' },
  ],
};

function messages(input: unknown): string[] {
  const r = createProductSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe('createProductSchema', () => {
  it('accepts a product with pièce + carton and normalizes amounts', () => {
    const parsed = createProductSchema.parse(valid);
    expect(parsed.prices[0]?.priceHt).toBe('1250');
    expect(parsed.minStock).toBe('0');
    expect(parsed.categoryId).toBeNull();
  });

  it('requires the base unit with factor 1', () => {
    expect(messages({ ...valid, units: valid.units.slice(1) })).toContain(
      PRODUCT_RULES.baseUnitMissing,
    );
    expect(
      messages({ ...valid, units: [{ ...valid.units[0], factorToBase: '2' }, valid.units[1]] }),
    ).toContain(PRODUCT_RULES.baseFactorNotOne);
  });

  it('refuses duplicate units and barcodes', () => {
    expect(
      messages({
        ...valid,
        units: [
          valid.units[0],
          { ...valid.units[0], isDefaultSale: false, isDefaultPurchase: true },
        ],
      }),
    ).toContain(PRODUCT_RULES.duplicateUnit);
    expect(
      messages({
        ...valid,
        units: [valid.units[0], { ...valid.units[1], barcode: '6130000000011' }],
      }),
    ).toContain(PRODUCT_RULES.duplicateBarcode);
  });

  it('requires exactly one default sale and purchase unit', () => {
    const units = valid.units.map((u) => ({ ...u, isDefaultSale: true }));
    expect(messages({ ...valid, units })).toContain(PRODUCT_RULES.defaultSale);
    const none = valid.units.map((u) => ({ ...u, isDefaultPurchase: false }));
    expect(messages({ ...valid, units: none })).toContain(PRODUCT_RULES.defaultPurchase);
  });

  it('refuses prices for unknown units, duplicated prices and negative values', () => {
    const other = '44444444-4444-4444-8444-444444444444';
    expect(
      messages({ ...valid, prices: [{ unitId: other, priceLevelId: GROS, priceHt: '1' }] }),
    ).toContain(PRODUCT_RULES.priceUnknownUnit);
    expect(messages({ ...valid, prices: [valid.prices[0], valid.prices[0]] })).toContain(
      PRODUCT_RULES.duplicatePrice,
    );
    expect(messages({ ...valid, prices: [{ ...valid.prices[0], priceHt: '-1' }] })).toContain(
      'invalid_amount',
    );
  });

  it('refuses a zero factor, a TVA above 100 and a bad barcode', () => {
    expect(
      messages({ ...valid, units: [valid.units[0], { ...valid.units[1], factorToBase: '0' }] }),
    ).toContain('invalid_quantity');
    expect(messages({ ...valid, tvaRate: '120' })).toContain('invalid_rate');
    expect(
      messages({ ...valid, units: [{ ...valid.units[0], barcode: 'a b' }, valid.units[1]] }),
    ).toContain('invalid_barcode');
  });

  it('update requires a version', () => {
    expect(updateProductSchema.safeParse(valid).success).toBe(false);
    expect(updateProductSchema.safeParse({ ...valid, version: 1 }).success).toBe(true);
  });
});
