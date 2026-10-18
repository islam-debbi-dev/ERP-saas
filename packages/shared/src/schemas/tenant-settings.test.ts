import { describe, expect, it } from 'vitest';
import { tenantSettingsSchema, updateTenantSettingsSchema } from './tenant-settings';

const valid = {
  raisonSociale: 'SARL Grossiste Demo',
  adresse: 'Rue 1, Alger',
  telephone: '',
  rc: null,
  nif: null,
  nis: null,
  ai: null,
  rib: null,
  assujettiTva: true,
  creditLimitMode: 'WARN',
  negativeStockMode: 'WARN',
  priceLevelCount: 3,
  timbreEnabled: false,
  timbreRate: null,
  timbreMin: null,
  timbreMax: null,
  timbreThreshold: null,
};

describe('tenantSettingsSchema', () => {
  it('accepts valid settings and turns empty strings into null', () => {
    const parsed = tenantSettingsSchema.parse(valid);
    expect(parsed.telephone).toBeNull();
  });

  it('rejects a price level count outside 1..5', () => {
    expect(tenantSettingsSchema.safeParse({ ...valid, priceLevelCount: 6 }).success).toBe(false);
    expect(tenantSettingsSchema.safeParse({ ...valid, priceLevelCount: 0 }).success).toBe(false);
  });

  it('validates timbre amounts as non-negative money strings', () => {
    expect(tenantSettingsSchema.safeParse({ ...valid, timbreMin: '5,00' }).success).toBe(true);
    expect(tenantSettingsSchema.safeParse({ ...valid, timbreMin: '-5' }).success).toBe(false);
    expect(tenantSettingsSchema.safeParse({ ...valid, timbreMin: '1.234' }).success).toBe(false);
    expect(tenantSettingsSchema.safeParse({ ...valid, timbreRate: '101' }).success).toBe(false);
  });

  it('allows partial updates', () => {
    expect(updateTenantSettingsSchema.parse({ assujettiTva: false })).toEqual({
      assujettiTva: false,
    });
  });
});
