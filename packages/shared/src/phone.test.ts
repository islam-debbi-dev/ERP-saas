import { describe, expect, it } from 'vitest';
import { formatPhone, isEmailIdentifier, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('reads the usual ways of writing a mobile', () => {
    for (const v of [
      '0550123456',
      '0550 12 34 56',
      '05.50.12.34.56',
      '+213550123456',
      '00213 550 12 34 56',
      '(0550) 12-34-56',
    ]) {
      expect(normalizePhone(v)).toBe('+213550123456');
    }
  });

  it('reads a landline', () => {
    expect(normalizePhone('021 23 45 67')).toBe('+21321234567');
    expect(normalizePhone('+213 21 23 45 67')).toBe('+21321234567');
  });

  it('refuses what is not an Algerian number', () => {
    for (const v of ['', '12345', '0150123456', '+33612345678', '05501234567', 'abc']) {
      expect(normalizePhone(v)).toBeNull();
    }
  });
});

describe('formatPhone', () => {
  it('groups the national number', () => {
    expect(formatPhone('+213550123456')).toBe('0550 12 34 56');
    expect(formatPhone('+21321234567')).toBe('021 23 45 67');
  });
});

describe('isEmailIdentifier', () => {
  it('tells an email from a phone', () => {
    expect(isEmailIdentifier('a@b.dz')).toBe(true);
    expect(isEmailIdentifier('0550123456')).toBe(false);
  });
});
