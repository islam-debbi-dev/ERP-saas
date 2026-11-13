import { describe, expect, it } from 'vitest';
import {
  clientAdjustmentSchema,
  clientListQuerySchema,
  clientMapQuerySchema,
  clientNearbyBodySchema,
  clientNearbyQuerySchema,
  createClientSchema,
  openingBalanceSchema,
  statementQuerySchema,
} from './clients';

describe('client schemas', () => {
  it('normalizes the plafond and accepts no limit', () => {
    const c = createClientSchema.parse({
      code: 'C001',
      name: 'Superette El Baraka',
      creditLimit: '50 000',
    });
    expect(c.creditLimit).toBe('50000');
    expect(c.type).toBe('PARTICULIER');
    expect(
      createClientSchema.parse({ code: 'C2', name: 'X', creditLimit: null }).creditLimit,
    ).toBeNull();
    expect(createClientSchema.safeParse({ code: 'C3', name: 'X', creditLimit: '-1' }).success).toBe(
      false,
    );
  });

  it('opening balance may be negative but not zero; adjustments are signed, non-zero and need a reason', () => {
    expect(openingBalanceSchema.parse({ amount: '-1 500,50' }).amount).toBe('-1500.5');
    expect(openingBalanceSchema.safeParse({ amount: '0' }).success).toBe(false);
    expect(clientAdjustmentSchema.safeParse({ amount: '0', reason: 'erreur' }).success).toBe(false);
    expect(clientAdjustmentSchema.safeParse({ amount: '-2000' }).success).toBe(false);
    expect(
      clientAdjustmentSchema.parse({ amount: '-2 000', reason: 'Remise accordée' }).amount,
    ).toBe('-2000');
    expect(clientAdjustmentSchema.safeParse({ amount: '10.123', reason: 'abc' }).success).toBe(
      false,
    );
  });

  it('statement range must be in order', () => {
    expect(statementQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(
      true,
    );
    expect(statementQuerySchema.safeParse({ from: '2026-11-01', to: '2026-10-31' }).success).toBe(
      false,
    );
  });
});

describe('clientMapQuerySchema (phase 35)', () => {
  it('accepts no bounds and all four bounds', () => {
    expect(clientMapQuerySchema.safeParse({}).success).toBe(true);
    const ok = clientMapQuerySchema.parse({
      minLat: '36.6',
      minLng: '2.9',
      maxLat: '36.9',
      maxLng: '3.2',
    });
    expect(ok).toMatchObject({ minLat: 36.6, maxLng: 3.2, includeInactive: false, hasDebt: false });
  });

  it('refuses some bounds without the others', () => {
    expect(clientMapQuerySchema.safeParse({ minLat: '36.6', maxLat: '36.9' }).success).toBe(false);
  });

  it('refuses out-of-range and inverted bounds', () => {
    const box = { minLat: '36.6', minLng: '2.9', maxLat: '36.9', maxLng: '3.2' };
    expect(clientMapQuerySchema.safeParse({ ...box, maxLat: '91' }).success).toBe(false);
    expect(clientMapQuerySchema.safeParse({ ...box, minLng: '-181' }).success).toBe(false);
    expect(clientMapQuerySchema.safeParse({ ...box, minLat: '37' }).success).toBe(false);
    expect(clientMapQuerySchema.safeParse({ ...box, maxLng: '2.9' }).success).toBe(false);
  });

  it('reads the flags', () => {
    expect(
      clientMapQuerySchema.parse({ includeInactive: 'true', overLimit: 'true' }),
    ).toMatchObject({
      includeInactive: true,
      overLimit: true,
    });
  });
});

describe('clientNearbyQuerySchema (phase 35)', () => {
  it('defaults radius and limit, bounds them', () => {
    expect(clientNearbyQuerySchema.parse({ lat: '36.7', lng: '3' })).toMatchObject({
      radiusM: 5000,
      limit: 30,
    });
    expect(
      clientNearbyQuerySchema.safeParse({ lat: '36.7', lng: '3', radiusM: '99' }).success,
    ).toBe(false);
    expect(
      clientNearbyQuerySchema.safeParse({ lat: '36.7', lng: '3', radiusM: '50001' }).success,
    ).toBe(false);
    expect(clientNearbyQuerySchema.safeParse({ lat: '36.7', lng: '3', limit: '101' }).success).toBe(
      false,
    );
    expect(clientNearbyQuerySchema.safeParse({ lng: '3' }).success).toBe(false);
  });
});

describe('clientNearbyBodySchema (REPORT-35, B-3)', () => {
  it('parses to the same request as the query string', () => {
    const fromBody = clientNearbyBodySchema.parse({ lat: 36.7, lng: 3, hasDebt: true, limit: 50 });
    const fromQuery = clientNearbyQuerySchema.parse({
      lat: '36.7',
      lng: '3',
      hasDebt: 'true',
      limit: '50',
    });
    expect(fromBody).toEqual(fromQuery);
  });

  it('wants numbers, in range, and a clean search', () => {
    const ok = { lat: 36.7, lng: 3 };
    expect(clientNearbyBodySchema.safeParse({ ...ok, lat: '36.7' }).success).toBe(false);
    expect(clientNearbyBodySchema.safeParse({ lng: 3 }).success).toBe(false);
    expect(clientNearbyBodySchema.safeParse({ ...ok, lat: 91 }).success).toBe(false);
    expect(clientNearbyBodySchema.safeParse({ ...ok, radiusM: 99 }).success).toBe(false);
    expect(clientNearbyBodySchema.safeParse({ ...ok, limit: 101 }).success).toBe(false);
    expect(clientNearbyBodySchema.safeParse({ ...ok, search: 'a\u0000b' }).success).toBe(false);
  });
});

describe('hostile query values (REPORT-35, A-2 and A-6)', () => {
  it('refuses a control character in search, on the list, the map and nearby', () => {
    for (const search of ['\u0000', 'abc\u0000def', 'a\u0007b', 'a\u007fb']) {
      expect(clientListQuerySchema.safeParse({ search }).success).toBe(false);
      expect(clientMapQuerySchema.safeParse({ search }).success).toBe(false);
      expect(clientNearbyQuerySchema.safeParse({ lat: '36.7', lng: '3', search }).success).toBe(
        false,
      );
    }
  });

  it('still takes any printable search, trimmed', () => {
    for (const search of ['50%', 'a_b', 'back\\slash', "l'épicerie", '<b>x</b>', 'بقالة الأمل']) {
      expect(clientListQuerySchema.parse({ search }).search).toBe(search);
    }
    expect(clientListQuerySchema.parse({ search: '\t café \n' }).search).toBe('café');
  });

  it('does not read an empty, blank or hexadecimal value as a number', () => {
    for (const bad of ['', ' ', '0x24', 'abc', '36,7', '1 000', 'Infinity', 'NaN', '--1', '1e']) {
      expect(clientNearbyQuerySchema.safeParse({ lat: bad, lng: '3' }).success).toBe(false);
      expect(clientNearbyQuerySchema.safeParse({ lat: '36.7', lng: bad }).success).toBe(false);
      expect(
        clientMapQuerySchema.safeParse({ minLat: bad, minLng: '2', maxLat: '37', maxLng: '4' })
          .success,
      ).toBe(false);
    }
  });

  it('reads every way JavaScript prints a coordinate', () => {
    for (const [text, value] of [
      ['36.7538', 36.7538],
      ['-3', -3],
      ['0', 0],
      ['.5', 0.5],
      [String(3.0588 - 0.01), 3.0588 - 0.01],
      [String(1e-7), 1e-7],
      [String(-0.000000123), -0.000000123],
    ] as const) {
      expect(clientNearbyQuerySchema.parse({ lat: text, lng: text })).toMatchObject({
        lat: value,
        lng: value,
      });
    }
  });
});

describe('clientListQuerySchema hasLocation (phase 35)', () => {
  it('is tri-state', () => {
    expect(clientListQuerySchema.parse({}).hasLocation).toBeUndefined();
    expect(clientListQuerySchema.parse({ hasLocation: 'true' }).hasLocation).toBe(true);
    expect(clientListQuerySchema.parse({ hasLocation: 'false' }).hasLocation).toBe(false);
  });
});
