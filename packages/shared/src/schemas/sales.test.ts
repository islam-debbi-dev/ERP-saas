import { describe, expect, it } from 'vitest';
import { invoiceFromBlsSchema, quickSaleSchema, saleReturnSchema } from './sales';

const uuid = '0b6c5a8e-6f4a-4a52-9d1c-2f6c1e1d9a10';
const line = { productId: uuid, unitId: uuid, qty: '2' };

describe('sale schemas', () => {
  it('a quick sale needs a line and defaults to a cash BL with no discount', () => {
    expect(quickSaleSchema.safeParse({ documentDate: '2026-10-19', lines: [] }).success).toBe(
      false,
    );
    const ok = quickSaleSchema.parse({
      documentDate: '2026-10-19',
      lines: [line],
      paidAmount: '1 500,50',
    });
    expect(ok).toMatchObject({
      type: 'BL',
      clientId: null,
      paidAmount: '1500.5',
      paymentMode: 'ESPECES',
      forceCredit: false,
    });
    expect(ok.lines[0]?.discountPct).toBe('0');
    expect(ok.lines[0]?.unitPriceHt).toBeUndefined();
  });

  it('refuses discounts above 100 % and negative prices', () => {
    const bad = (l: object) =>
      quickSaleSchema.safeParse({ documentDate: '2026-10-19', lines: [{ ...line, ...l }] }).success;
    expect(bad({ discountPct: '101' })).toBe(false);
    expect(bad({ unitPriceHt: '-1' })).toBe(false);
    expect(bad({ qty: '0' })).toBe(false);
  });

  it('a return needs a reason and positive quantities', () => {
    const base = { disposition: 'RESTOCK', lines: [{ saleLineId: uuid, qty: '1' }] };
    expect(saleReturnSchema.safeParse(base).success).toBe(false);
    expect(saleReturnSchema.safeParse({ ...base, reason: 'cassé' }).success).toBe(true);
  });

  it('a facture groups distinct BLs', () => {
    expect(
      invoiceFromBlsSchema.safeParse({ saleIds: [uuid, uuid], documentDate: '2026-10-19' }).success,
    ).toBe(false);
  });
});
