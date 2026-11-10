import { describe, expect, it } from 'vitest';
import {
  clientAdjustmentSchema,
  clientListQuerySchema,
  clientMapQuerySchema,
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

describe('clientListQuerySchema hasLocation (phase 35)', () => {
  it('is tri-state', () => {
    expect(clientListQuerySchema.parse({}).hasLocation).toBeUndefined();
    expect(clientListQuerySchema.parse({ hasLocation: 'true' }).hasLocation).toBe(true);
    expect(clientListQuerySchema.parse({ hasLocation: 'false' }).hasLocation).toBe(false);
  });
});
