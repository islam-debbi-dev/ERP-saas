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
  timbreTranches: [],
  timbreMin: null,
  timbreMax: null,
  timbreThreshold: null,
  defaultPrintFormat: 'A4',
  documentFooter: null,
  tvaMention: 'Non assujetti à la TVA',
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
  });

  it('validates timbre tranches: rates 0..100, increasing bounds, only the last open', () => {
    const ok = (timbreTranches: unknown) =>
      tenantSettingsSchema.safeParse({ ...valid, timbreTranches }).success;
    expect(
      ok([
        { upTo: '30000', rate: '1' },
        { upTo: '100 000,00', rate: '1.5' },
        { upTo: null, rate: '2' },
      ]),
    ).toBe(true);
    expect(ok([{ upTo: '1000', rate: '1' }])).toBe(true);
    expect(ok([{ upTo: null, rate: '101' }])).toBe(false);
    expect(
      ok([
        { upTo: '1000', rate: '1' },
        { upTo: '1000', rate: '2' },
      ]),
    ).toBe(false);
    expect(
      ok([
        { upTo: null, rate: '1' },
        { upTo: '1000', rate: '2' },
      ]),
    ).toBe(false);
  });

  it('requires a TVA mention and a known print format', () => {
    expect(tenantSettingsSchema.safeParse({ ...valid, tvaMention: ' ' }).success).toBe(false);
    expect(tenantSettingsSchema.safeParse({ ...valid, defaultPrintFormat: 'A3' }).success).toBe(
      false,
    );
  });

  it('allows partial updates', () => {
    expect(updateTenantSettingsSchema.parse({ assujettiTva: false })).toEqual({
      assujettiTva: false,
    });
  });
});
