import { describe, expect, it } from 'vitest';
import { assignSellerZoneSchema, createZoneSchema, updateZoneSchema } from './zones';

const ZONE_ID = '0b8f1f7e-6a53-4a1e-9a44-0f3f3a3f3a3f';

describe('zone schemas', () => {
  it('fills the defaults and removes duplicate codes', () => {
    expect(
      createZoneSchema.parse({ name: ' Centre ', kind: 'CITY', communeCodes: [1621, 1621] }),
    ).toEqual({
      name: 'Centre',
      kind: 'CITY',
      parentZoneId: null,
      wilayaCodes: [],
      communeCodes: [1621],
      responsibleUserId: null,
    });
    expect(
      createZoneSchema.parse({ name: 'Est', kind: 'AREA', wilayaCodes: [28, 28] }),
    ).toMatchObject({ wilayaCodes: [28], communeCodes: [] });
  });

  it('refuses a zone without a place, an area with a parent and wilaya 70', () => {
    const ok = (v: object) => createZoneSchema.safeParse({ name: 'Z', kind: 'AREA', ...v }).success;
    expect(ok({})).toBe(false);
    expect(ok({ communeCodes: [1621], parentZoneId: ZONE_ID })).toBe(false);
    expect(ok({ wilayaCodes: [70] })).toBe(false);
    expect(ok({ wilayaCodes: [69] })).toBe(true);
  });

  it('needs the version on an update', () => {
    const body = { name: 'Z', kind: 'CITY', communeCodes: [1621] };
    expect(updateZoneSchema.safeParse(body).success).toBe(false);
    expect(updateZoneSchema.safeParse({ ...body, version: 1 }).success).toBe(true);
  });

  it('assigns a zone or communes, exactly one of the two', () => {
    const ok = (v: object) => assignSellerZoneSchema.safeParse(v).success;
    expect(ok({ zoneId: ZONE_ID })).toBe(true);
    expect(ok({ communeCodes: [2801] })).toBe(true);
    expect(ok({})).toBe(false);
    expect(ok({ communeCodes: [] })).toBe(false);
    expect(ok({ zoneId: ZONE_ID, communeCodes: [2801] })).toBe(false);
    expect(ok({ zoneId: ZONE_ID, tenantId: ZONE_ID })).toBe(false);
  });
});
