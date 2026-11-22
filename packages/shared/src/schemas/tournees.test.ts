import { describe, expect, it } from 'vitest';
import {
  createRouteSchema,
  createVisitSchema,
  deliverOrderSchema,
  setRouteStopsSchema,
  tourneeReportQuerySchema,
} from './tournees';

const uuid = '0b7c1a2e-4f6d-4c1a-9a51-2f0e8d7b6c5a';
const uuid2 = '1b7c1a2e-4f6d-4c1a-9a51-2f0e8d7b6c5a';
const at = '2026-10-30T09:00:00+01:00';

describe('createRouteSchema', () => {
  it('dedupes and sorts weekdays, Sunday = 0', () => {
    const r = createRouteSchema.parse({ name: 'Est', sellerId: uuid, weekdays: [4, 0, 4] });
    expect(r.weekdays).toEqual([0, 4]);
  });

  it('refuses no day and days outside 0..6', () => {
    expect(createRouteSchema.safeParse({ name: 'E', sellerId: uuid, weekdays: [] }).success).toBe(
      false,
    );
    expect(createRouteSchema.safeParse({ name: 'E', sellerId: uuid, weekdays: [7] }).success).toBe(
      false,
    );
  });
});

describe('setRouteStopsSchema', () => {
  it('refuses a client twice on the same route', () => {
    expect(setRouteStopsSchema.safeParse({ clientIds: [uuid, uuid] }).success).toBe(false);
    expect(setRouteStopsSchema.safeParse({ clientIds: [uuid, uuid2] }).success).toBe(true);
  });
});

describe('createVisitSchema', () => {
  const base = { clientId: uuid, startedAt: at };

  it('needs a reason for a visit without sale, and a note for OTHER', () => {
    expect(createVisitSchema.safeParse({ ...base, outcome: 'NO_SALE' }).success).toBe(false);
    expect(
      createVisitSchema.safeParse({ ...base, outcome: 'NO_SALE', reason: 'CLOSED' }).success,
    ).toBe(true);
    expect(
      createVisitSchema.safeParse({ ...base, outcome: 'NO_SALE', reason: 'OTHER' }).success,
    ).toBe(false);
    expect(
      createVisitSchema.safeParse({
        ...base,
        outcome: 'NO_SALE',
        reason: 'OTHER',
        note: 'Gérant absent',
      }).success,
    ).toBe(true);
  });

  it('needs the document behind a productive outcome', () => {
    expect(createVisitSchema.safeParse({ ...base, outcome: 'SALE' }).success).toBe(false);
    expect(createVisitSchema.safeParse({ ...base, outcome: 'SALE', saleId: uuid2 }).success).toBe(
      true,
    );
    expect(createVisitSchema.safeParse({ ...base, outcome: 'ORDER' }).success).toBe(false);
    expect(createVisitSchema.safeParse({ ...base, outcome: 'PAYMENT_ONLY' }).success).toBe(false);
  });

  it('refuses a reason on a sale and an end before the start', () => {
    expect(
      createVisitSchema.safeParse({ ...base, outcome: 'SALE', saleId: uuid2, reason: 'CLOSED' })
        .success,
    ).toBe(false);
    expect(
      createVisitSchema.safeParse({
        ...base,
        outcome: 'NO_SALE',
        reason: 'CLOSED',
        endedAt: '2026-10-30T07:00:00+01:00',
      }).success,
    ).toBe(false);
  });
});

describe('deliverOrderSchema', () => {
  it('accepts a zero quantity (rupture) and refuses a line twice', () => {
    expect(deliverOrderSchema.safeParse({ lines: [{ orderLineId: uuid, qty: '0' }] }).success).toBe(
      true,
    );
    expect(
      deliverOrderSchema.safeParse({
        lines: [
          { orderLineId: uuid, qty: '1' },
          { orderLineId: uuid, qty: '2' },
        ],
      }).success,
    ).toBe(false);
  });

  it('takes the four geo fields or none (A3)', () => {
    const lines = [{ orderLineId: uuid, qty: '1' }];
    const full = { lat: 36.75, lng: 3.05, accuracyM: 12, isMocked: false, capturedAt: at };
    expect(deliverOrderSchema.safeParse({ lines }).success).toBe(true);
    expect(deliverOrderSchema.safeParse({ lines, geo: full }).data?.geo).toMatchObject(full);
    expect(deliverOrderSchema.safeParse({ lines, geo: { isMocked: false } }).success).toBe(true);
    expect(
      deliverOrderSchema.safeParse({ lines, geo: { lat: 36.75, lng: 3.05, isMocked: false } })
        .success,
    ).toBe(false);
  });
});

describe('tourneeReportQuerySchema', () => {
  it('refuses a range that ends before it starts', () => {
    expect(
      tourneeReportQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success,
    ).toBe(false);
  });
});
