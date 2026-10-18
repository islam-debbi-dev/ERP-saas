import { describe, expect, it } from 'vitest';
import { fromBase, isWholeQuantity, qty, toBase, toQtyString } from './quantity';

describe('quantity conversion', () => {
  it('converts packaging units to base units', () => {
    expect(toBase('2', '24').toString()).toBe('48');
    expect(toBase('1.5', '25').toString()).toBe('37.5');
    expect(toBase('0.333', '3').toString()).toBe('0.999');
  });

  it('converts base units back to packaging units, rounded half-up to 3 decimals', () => {
    expect(fromBase('48', '24').toString()).toBe('2');
    expect(fromBase('10', '3').toString()).toBe('3.333');
    expect(fromBase('20', '3').toString()).toBe('6.667');
    expect(fromBase('0.0005', '1').toString()).toBe('0.001');
  });

  it('refuses a zero or negative factor', () => {
    expect(() => fromBase('1', '0')).toThrow(RangeError);
    expect(() => fromBase('1', '-2')).toThrow(RangeError);
  });

  it('rejects floats', () => {
    expect(() => qty(0.5)).toThrow(TypeError);
    expect(qty(3).toString()).toBe('3');
  });

  it('detects whole quantities and formats for storage', () => {
    expect(isWholeQuantity('24')).toBe(true);
    expect(isWholeQuantity('24.000')).toBe(true);
    expect(isWholeQuantity('2.5')).toBe(false);
    expect(toQtyString('2.5')).toBe('2.500');
  });
});
