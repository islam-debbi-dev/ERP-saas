import { describe, expect, it } from 'vitest';
import { cump, splitPackaging, stockValue } from './stock';

describe('cump', () => {
  it('first entry: the entry cost becomes the average', () => {
    expect(cump('0', '0', '24', '45.8333').toString()).toBe('45.8333');
  });

  it('weights the old and new stock', () => {
    // 10 at 100 + 30 at 120 = 4600 / 40 = 115
    expect(cump('10', '100', '30', '120').toString()).toBe('115');
  });

  it('after negative stock, the entry cost wins', () => {
    expect(cump('-5', '100', '20', '130').toString()).toBe('130');
  });

  it('handles decimal quantities (kg) and rounds half-up to 4 decimals', () => {
    // 12.5 kg at 80 + 7.25 kg at 95 = 1000 + 688.75 = 1688.75 / 19.75 = 85.5063...
    expect(cump('12.5', '80', '7.25', '95').toString()).toBe('85.5063');
    // 1 at 1 + 2 at 1.00005 = 3.0001 / 3 = 1.000033.. -> 1
    expect(cump('1', '1', '2', '1.00005').toString()).toBe('1');
  });

  it('a carton cost becomes a per-piece average', () => {
    // 2 cartons of 24 at 1 100 DA each = 48 pieces at 45.8333
    expect(cump('0', '0', '48', '1100').div(24).toDecimalPlaces(4).toString()).toBe('45.8333');
  });

  it('refuses a zero or negative entry', () => {
    expect(() => cump('1', '1', '0', '1')).toThrow(RangeError);
    expect(() => cump('1', '1', '-1', '1')).toThrow(RangeError);
  });
});

describe('stockValue', () => {
  it('values at CUMP with 2 decimals, negative stock at 0', () => {
    expect(stockValue('48', '45.8333').toString()).toBe('2200');
    expect(stockValue('7', '45.8333').toString()).toBe('320.83');
    expect(stockValue('-3', '45').toString()).toBe('0');
  });
});

describe('splitPackaging', () => {
  it('splits into whole packs and a remainder', () => {
    const r = splitPackaging('293', '24');
    expect([r.packs.toString(), r.rest.toString()]).toEqual(['12', '5']);
  });

  it('works with decimal base units and keeps the sign', () => {
    const kg = splitPackaging('60.5', '25');
    expect([kg.packs.toString(), kg.rest.toString()]).toEqual(['2', '10.5']);
    const neg = splitPackaging('-30', '24');
    expect([neg.packs.toString(), neg.rest.toString()]).toEqual(['-1', '-6']);
  });
});
