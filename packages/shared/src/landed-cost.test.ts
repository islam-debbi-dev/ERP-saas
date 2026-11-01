import { describe, expect, it } from 'vitest';
import {
  allocate,
  AllocationError,
  AllocationMethod,
  allocatedAmount,
  landedUnitCost,
  prorate,
  spreadLateCost,
  toDzd,
} from './landed-cost';
import { sum } from './money';

const lines = [
  { key: 'a', productId: 'p1', value: '135000', qtyBase: '100', weightKg: '2', volumeM3: '0.01' },
  { key: 'b', productId: 'p2', value: '67500', qtyBase: '300', weightKg: '0.5', volumeM3: '0.002' },
  { key: 'c', productId: 'p3', value: '27000', qtyBase: '50', weightKg: '1', volumeM3: '0.03' },
];
const str = (m: Map<string, { toFixed(n: number): string }>) =>
  Object.fromEntries([...m].map(([k, v]) => [k, v.toFixed(2)]));

describe('toDzd', () => {
  it('converts at the bank rate without rounding', () => {
    expect(toDzd('1000', '135.123456').toString()).toBe('135123.456');
  });
});

describe('prorate', () => {
  it('puts the rounding remainder on the largest basis', () => {
    const out = prorate('100', [
      { key: 'x', basis: '1' },
      { key: 'y', basis: '1' },
      { key: 'z', basis: '1' },
    ]);
    expect(str(out)).toEqual({ x: '33.34', y: '33.33', z: '33.33' });
    expect(sum([...out.values()]).toFixed(2)).toBe('100.00');
  });

  it('refuses a zero basis', () => {
    expect(() => prorate('10', [{ key: 'x', basis: '0' }])).toThrow(AllocationError);
  });
});

describe('allocate', () => {
  it('by value', () => {
    expect(str(allocate(lines, '22950', AllocationMethod.VALUE))).toEqual({
      a: '13500.00',
      b: '6750.00',
      c: '2700.00',
    });
  });

  it('by quantity, remainder on the biggest line', () => {
    const out = allocate(lines, '1000', AllocationMethod.QUANTITY);
    expect(str(out)).toEqual({ a: '222.22', b: '666.67', c: '111.11' });
    expect(sum([...out.values()]).toFixed(2)).toBe('1000.00');
  });

  it('by weight (qty × kg)', () => {
    // 200 kg, 150 kg, 50 kg
    expect(str(allocate(lines, '4000', AllocationMethod.WEIGHT))).toEqual({
      a: '2000.00',
      b: '1500.00',
      c: '500.00',
    });
  });

  it('by volume (qty × m3)', () => {
    // 1, 0.6, 1.5 m3
    const out = allocate(lines, '3100', AllocationMethod.VOLUME);
    expect(str(out)).toEqual({ a: '1000.00', b: '600.00', c: '1500.00' });
  });

  it('refuses weight when a product has none', () => {
    const missing = [...lines.slice(0, 2), { ...lines[2]!, weightKg: null }];
    try {
      allocate(missing, '100', AllocationMethod.WEIGHT);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AllocationError);
      expect((e as AllocationError).code).toBe('ALLOCATION_BASIS_MISSING');
      expect((e as AllocationError).details).toMatchObject({ productIds: ['p3'] });
    }
  });

  it('manual split must sum exactly and name known lines', () => {
    expect(str(allocate(lines, '100', AllocationMethod.MANUAL, { a: '60', c: '40' }))).toEqual({
      a: '60.00',
      b: '0.00',
      c: '40.00',
    });
    expect(() => allocate(lines, '100', AllocationMethod.MANUAL, { a: '60' })).toThrow(
      'MANUAL_SPLIT_INVALID',
    );
    expect(() => allocate(lines, '100', AllocationMethod.MANUAL, { a: '60', zz: '40' })).toThrow(
      'MANUAL_SPLIT_INVALID',
    );
  });

  it('accepts a negative amount (a credit note), still exact', () => {
    const out = allocate(lines, '-1000', AllocationMethod.QUANTITY);
    expect(sum([...out.values()]).toFixed(2)).toBe('-1000.00');
  });
});

describe('allocatedAmount (VAT rule)', () => {
  it('assujetti: the TVA is recoverable, not a cost', () => {
    expect(allocatedAmount('119000', '19000', true).toFixed(2)).toBe('100000.00');
  });
  it('non assujetti (IFU): the TVA is part of the cost', () => {
    expect(allocatedAmount('119000', '19000', false).toFixed(2)).toBe('119000.00');
  });
});

describe('landedUnitCost', () => {
  it('FOB in currency × rate + shares, rounded once at 4 decimals', () => {
    // 1000 USD × 135 = 135000 DA for 100 units, + 13500 fret + 1000 transport
    const fob = toDzd('1000', '135');
    expect(landedUnitCost(fob, ['13500', '1000'], '100').toString()).toBe('1495');
    expect(landedUnitCost('1000', ['1'], '3').toString()).toBe('333.6667');
  });
});

describe('spreadLateCost', () => {
  it('all received units still on hand: everything into the CUMP', () => {
    const s = spreadLateCost('1000', '100', '100', '1495');
    expect(s.stockValue.toFixed(2)).toBe('1000.00');
    expect(s.ecart.toFixed(2)).toBe('0.00');
    expect(s.newAvg.toString()).toBe('1505');
  });

  it('partial stock: the sold part is an écart', () => {
    const s = spreadLateCost('1000', '40', '100', '1495');
    expect(s.stockValue.toFixed(2)).toBe('400.00');
    expect(s.ecart.toFixed(2)).toBe('600.00');
    expect(s.newAvg.toString()).toBe('1505');
  });

  it('more on hand than received (older stock mixed in): all into the CUMP', () => {
    const s = spreadLateCost('1000', '200', '100', '1000');
    expect(s.stockValue.toFixed(2)).toBe('1000.00');
    expect(s.newAvg.toString()).toBe('1005');
  });

  it('no stock left: all écart, CUMP unchanged', () => {
    const s = spreadLateCost('1000', '0', '100', '1495');
    expect(s.stockValue.toFixed(2)).toBe('0.00');
    expect(s.ecart.toFixed(2)).toBe('1000.00');
    expect(s.newAvg.toString()).toBe('1495');
  });
});
