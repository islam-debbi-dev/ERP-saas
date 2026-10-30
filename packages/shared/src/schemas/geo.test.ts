import { describe, expect, it } from 'vitest';
import { geoCheckListQuerySchema, geoInputSchema, geoReportQuerySchema } from './geo';
import { quickSaleSchema } from './sales';

const geo = { lat: 36.75, lng: 3.05, accuracyM: 12, capturedAt: '2026-10-30T10:00:00+01:00' };

describe('geoInputSchema', () => {
  it('takes raw device data, isMocked false by default', () => {
    expect(geoInputSchema.parse(geo)).toEqual({ ...geo, isMocked: false });
  });

  it('refuses impossible coordinates and short notes', () => {
    expect(geoInputSchema.safeParse({ ...geo, lat: 91 }).success).toBe(false);
    expect(geoInputSchema.safeParse({ ...geo, lng: -181 }).success).toBe(false);
    expect(geoInputSchema.safeParse({ ...geo, accuracyM: -1 }).success).toBe(false);
    expect(geoInputSchema.safeParse({ ...geo, note: 'ok' }).success).toBe(false);
  });

  it('takes a note alone (no signal) but never half a position', () => {
    expect(geoInputSchema.safeParse({ note: 'GPS refusé' }).success).toBe(true);
    expect(geoInputSchema.safeParse({ lat: 36.7, lng: 3.0 }).success).toBe(false);
  });

  it('is optional on a quick sale', () => {
    const line = { productId: crypto.randomUUID(), unitId: crypto.randomUUID(), qty: '1' };
    const base = { documentDate: '2026-10-30', lines: [line] };
    expect(quickSaleSchema.parse(base).geo).toBeUndefined();
    expect(quickSaleSchema.parse({ ...base, geo }).geo?.lat).toBe(36.75);
  });
});

describe('geo queries', () => {
  it('lists flagged operations by default', () => {
    expect(geoCheckListQuerySchema.parse({}).flaggedOnly).toBe(true);
    expect(geoCheckListQuerySchema.parse({ flaggedOnly: 'false' }).flaggedOnly).toBe(false);
  });

  it('takes a YYYY-MM month', () => {
    expect(geoReportQuerySchema.safeParse({ month: '2026-10' }).success).toBe(true);
    expect(geoReportQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false);
  });
});
