import { describe, expect, it } from 'vitest';
import { computeTotals } from './documents';
import { packagingGiven } from './packaging';
import {
  applyPromotions,
  freeQtyFor,
  freeToReturn,
  pickPromotion,
  type PromotionContext,
  type PromotionRule,
  proportionalFree,
} from './promotions';

const X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const Y = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRAND = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SUBCAT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CLIENT = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const LEVEL = '12121212-1212-4121-8121-121212121212';
const SECTOR = '34343434-3434-4343-8343-343434343434';
const PIECE = '56565656-5656-4565-8565-565656565656';

function rule(p: Partial<PromotionRule>): PromotionRule {
  return {
    id: p.id ?? '00000000-0000-4000-8000-000000000001',
    name: 'Promo',
    type: 'FREE_UNITS',
    priority: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    validFrom: '2026-10-01',
    validTo: '2026-10-31',
    active: true,
    clientScope: 'ALL',
    priceLevelId: null,
    sectorId: null,
    clientIds: [],
    buyProductId: X,
    buyQtyBase: '10',
    freeProductId: X,
    freeUnitId: PIECE,
    freeQty: '1',
    repeatable: true,
    target: null,
    productIds: [],
    brandId: null,
    categoryIds: [],
    discountPct: null,
    minQtyBase: null,
    ...p,
  };
}

const ctx: PromotionContext = {
  day: '2026-10-15',
  clientId: CLIENT,
  priceLevelId: LEVEL,
  sectorId: SECTOR,
};
const lineX = (qtyBase: string, grossHt = '1000') => ({
  productId: X,
  brandId: BRAND,
  categoryId: SUBCAT,
  qtyBase,
  grossHt,
});

describe('freeQtyFor', () => {
  it('10+1 repeatable on 25 bought gives 2 free', () => {
    expect(freeQtyFor(rule({}), '25').toString()).toBe('2');
  });
  it('gives nothing under the threshold', () => {
    expect(freeQtyFor(rule({}), '9.999').toString()).toBe('0');
  });
  it('non repeatable gives the free quantity once', () => {
    expect(freeQtyFor(rule({ repeatable: false }), '35').toString()).toBe('1');
  });
  it('multiplies the free quantity', () => {
    expect(freeQtyFor(rule({ buyQtyBase: '24', freeQty: '2' }), '72').toString()).toBe('6');
  });
});

describe('matching', () => {
  it('respects the dates, both included, and active', () => {
    expect(pickPromotion([rule({})], lineX('10'), { ...ctx, day: '2026-10-31' })).not.toBeNull();
    expect(pickPromotion([rule({})], lineX('10'), { ...ctx, day: '2026-11-01' })).toBeNull();
    expect(pickPromotion([rule({})], lineX('10'), { ...ctx, day: '2026-09-30' })).toBeNull();
    expect(pickPromotion([rule({ active: false })], lineX('10'), ctx)).toBeNull();
  });

  it('respects the client scope', () => {
    const line = lineX('10');
    expect(
      pickPromotion([rule({ clientScope: 'PRICE_LEVEL', priceLevelId: LEVEL })], line, ctx),
    ).not.toBeNull();
    expect(
      pickPromotion([rule({ clientScope: 'PRICE_LEVEL', priceLevelId: X })], line, ctx),
    ).toBeNull();
    expect(
      pickPromotion([rule({ clientScope: 'SECTOR', sectorId: SECTOR })], line, ctx),
    ).not.toBeNull();
    expect(
      pickPromotion([rule({ clientScope: 'SECTOR', sectorId: SECTOR })], line, {
        ...ctx,
        sectorId: null,
      }),
    ).toBeNull();
    expect(
      pickPromotion([rule({ clientScope: 'CLIENTS', clientIds: [CLIENT] })], line, ctx),
    ).not.toBeNull();
    // Client comptoir: only ALL (and level) promotions.
    expect(
      pickPromotion([rule({ clientScope: 'CLIENTS', clientIds: [CLIENT] })], line, {
        ...ctx,
        clientId: null,
      }),
    ).toBeNull();
  });

  it('only targets the product bought for free units', () => {
    expect(pickPromotion([rule({})], { ...lineX('10'), productId: Y }, ctx)).toBeNull();
  });

  it('targets products, a brand or a category with its sub-categories, with a minimum', () => {
    const pct = (p: Partial<PromotionRule>) =>
      rule({ type: 'PERCENT_DISCOUNT', discountPct: '5', buyProductId: null, ...p });
    expect(
      pickPromotion([pct({ target: 'PRODUCTS', productIds: [X] })], lineX('1'), ctx)?.discountPct,
    ).toBe('5');
    expect(
      pickPromotion([pct({ target: 'BRAND', brandId: BRAND })], lineX('1'), ctx),
    ).not.toBeNull();
    expect(
      pickPromotion([pct({ target: 'CATEGORY', categoryIds: [CAT, SUBCAT] })], lineX('1'), ctx),
    ).not.toBeNull();
    expect(
      pickPromotion([pct({ target: 'CATEGORY', categoryIds: [CAT] })], lineX('1'), ctx),
    ).toBeNull();
    expect(
      pickPromotion([pct({ target: 'BRAND', brandId: BRAND, minQtyBase: '12' })], lineX('11'), ctx),
    ).toBeNull();
    expect(
      pickPromotion([pct({ target: 'BRAND', brandId: BRAND, minQtyBase: '12' })], lineX('12'), ctx),
    ).not.toBeNull();
  });
});

describe('priority', () => {
  const low = rule({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'low',
    priority: 1,
    freeQty: '5',
  });
  const high = rule({ id: '00000000-0000-4000-8000-000000000002', name: 'high', priority: 2 });

  it('the highest priority wins, whatever the benefit', () => {
    expect(pickPromotion([low, high], lineX('10'), ctx)?.rule.name).toBe('high');
  });

  it('a tie goes to the best for the client', () => {
    const pct = rule({
      id: '00000000-0000-4000-8000-000000000003',
      name: 'pct',
      type: 'PERCENT_DISCOUNT',
      target: 'BRAND',
      brandId: BRAND,
      discountPct: '10',
      priority: 2,
    });
    // 1 free unit at 50 DA vs 10 % of 1000 DA = 100 DA.
    const withPrice = { ...ctx, freeUnitPriceHt: { [high.id]: '50' } };
    expect(pickPromotion([high, pct], lineX('10', '1000'), withPrice)?.rule.name).toBe('pct');
    // 1 free unit at 150 DA beats 100 DA.
    const dearer = { ...ctx, freeUnitPriceHt: { [high.id]: '150' } };
    expect(pickPromotion([high, pct], lineX('10', '1000'), dearer)?.rule.name).toBe('high');
  });

  it('an exact tie goes to the oldest promotion', () => {
    const a = rule({
      id: '00000000-0000-4000-8000-00000000000a',
      name: 'new',
      createdAt: '2026-10-05T00:00:00.000Z',
    });
    const b = rule({
      id: '00000000-0000-4000-8000-00000000000b',
      name: 'old',
      createdAt: '2026-10-02T00:00:00.000Z',
    });
    expect(pickPromotion([a, b], lineX('10'), ctx)?.rule.name).toBe('old');
  });

  it('judges each line alone', () => {
    const res = applyPromotions([rule({})], [lineX('6'), lineX('6')], ctx);
    expect(res).toEqual([null, null]);
  });
});

describe('percent discount totals', () => {
  it('stays exact in Decimal', () => {
    const totals = computeTotals(
      [{ qty: '3', unitPrice: '33.33', tvaRate: '19', discountPct: '7.5' }],
      true,
    );
    // 3 × 33.33 = 99.99, −7.5 % = 92.49075 → 92.49
    expect(totals.lines[0]?.lineHt.toString()).toBe('92.49');
    expect(totals.totalTtc.toString()).toBe('110.06');
  });
});

describe('proportional free units', () => {
  it('rounds half-up to whole units, all of it at the end', () => {
    expect(proportionalFree('2', '25', '5', true).toString()).toBe('0');
    expect(proportionalFree('2', '25', '10', true).toString()).toBe('1');
    expect(proportionalFree('2', '25', '25', true).toString()).toBe('2');
    expect(proportionalFree('2', '25', '30', true).toString()).toBe('2');
    expect(proportionalFree('1.5', '10', '5', false).toString()).toBe('0.75');
  });

  it('counts returns cumulatively', () => {
    // 25 sold with 2 free. Return 10 → 1 free back, then 15 more → the last 1.
    const first = freeToReturn({
      freeSold: '2',
      paidSold: '25',
      paidReturnedAfter: '10',
      freeReturnedBefore: '0',
      wholeUnits: true,
    });
    expect(first.toString()).toBe('1');
    const second = freeToReturn({
      freeSold: '2',
      paidSold: '25',
      paidReturnedAfter: '25',
      freeReturnedBefore: '1',
      wholeUnits: true,
    });
    expect(second.toString()).toBe('1');
    // Five returns of 5 end where one return of 25 does.
    let back = 0;
    for (let i = 1; i <= 5; i++) {
      back += freeToReturn({
        freeSold: '2',
        paidSold: '25',
        paidReturnedAfter: String(i * 5),
        freeReturnedBefore: String(back),
        wholeUnits: true,
      }).toNumber();
    }
    expect(back).toBe(2);
  });

  it('never returns more than what is left', () => {
    expect(
      freeToReturn({
        freeSold: '2',
        paidSold: '25',
        paidReturnedAfter: '25',
        freeReturnedBefore: '2',
        wholeUnits: true,
      }).toString(),
    ).toBe('0');
  });
});

describe('packagingGiven', () => {
  it('counts a started casier', () => {
    const rules = [{ productId: X, packagingTypeId: 'casier', qtyBasePerPackaging: '24' }];
    expect(packagingGiven([{ productId: X, qtyBase: '30' }], rules).get('casier')).toBe(2);
    expect(
      packagingGiven(
        [
          { productId: X, qtyBase: '48' },
          { productId: X, qtyBase: '1' },
        ],
        rules,
      ).get('casier'),
    ).toBe(3);
    expect(packagingGiven([{ productId: Y, qtyBase: '48' }], rules).size).toBe(0);
  });
});
