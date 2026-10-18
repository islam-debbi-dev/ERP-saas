import { describe, expect, it } from 'vitest';
import { add, formatDA, money, mul, parseDA, round2, sub, sum, toMoneyString } from './money';

const NNBSP = '\u202f';
const NBSP = '\u00a0';

describe('money arithmetic', () => {
  it('adds without float errors', () => {
    expect(add('0.1', '0.2').toString()).toBe('0.3');
  });

  it('subtracts', () => {
    expect(sub('100000', '60000').toString()).toBe('40000');
  });

  it('multiplies without rounding', () => {
    expect(mul('19.99', '3').toString()).toBe('59.97');
    expect(mul('100.05', '0.19').toString()).toBe('19.0095');
  });

  it('sums a list and returns zero for an empty list', () => {
    expect(sum(['10.10', '20.20', '30.30']).toString()).toBe('60.6');
    expect(sum([]).toString()).toBe('0');
  });

  it('rejects floats but accepts integers, strings and bigints', () => {
    expect(() => money(0.1)).toThrow(TypeError);
    expect(money(5).toString()).toBe('5');
    expect(money(10n).toString()).toBe('10');
  });
});

describe('round2', () => {
  it.each([
    ['1.005', '1.01'],
    ['1.004', '1'],
    ['2.675', '2.68'],
    ['-1.005', '-1.01'],
    ['19.0095', '19.01'],
    ['0.125', '0.13'],
  ])('rounds %s half-up to %s', (input, expected) => {
    expect(round2(input).toString()).toBe(expected);
  });

  it('gives a canonical 2-decimal string for storage', () => {
    expect(toMoneyString('5')).toBe('5.00');
    expect(toMoneyString('1234.5')).toBe('1234.50');
  });
});

describe('formatDA', () => {
  it.each([
    ['0', `0,00${NBSP}DA`],
    ['5', `5,00${NBSP}DA`],
    ['999.9', `999,90${NBSP}DA`],
    ['1234.56', `1${NNBSP}234,56${NBSP}DA`],
    ['1234567.891', `1${NNBSP}234${NNBSP}567,89${NBSP}DA`],
    ['-40000', `-40${NNBSP}000,00${NBSP}DA`],
    ['-0.001', `0,00${NBSP}DA`],
  ])('formats %s as %s', (input, expected) => {
    expect(formatDA(input)).toBe(expected);
  });

  it('can omit the currency', () => {
    expect(formatDA('1234.5', { currency: false })).toBe(`1${NNBSP}234,50`);
  });
});

describe('parseDA', () => {
  it.each([
    ['1 234,5', '1234.5'],
    ['1234.50', '1234.5'],
    [`1${NNBSP}234,50${NBSP}DA`, '1234.5'],
    ['1 234,50 da', '1234.5'],
    ['-12,3', '-12.3'],
    ['  42  ', '42'],
  ])('parses %j as %s', (input, expected) => {
    expect(parseDA(input)?.toString()).toBe(expected);
  });

  it.each(['', 'abc', '1,234.56', '12,', ',5', '1.2.3', '--5', '12DA34'])('rejects %j', (input) => {
    expect(parseDA(input)).toBeNull();
  });

  it('round-trips with formatDA', () => {
    for (const v of ['0', '1', '1234567.89', '-0.5', '1000000']) {
      expect(parseDA(formatDA(v))?.toString()).toBe(money(v).toString());
    }
  });
});
