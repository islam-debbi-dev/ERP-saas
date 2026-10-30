import { describe, expect, it } from 'vitest';
import { GeoFlag, GeoStatus } from './enums';
import { evaluateGeo, type GeoReading, haversineM } from './geo';

const ALGER = { lat: 36.7538, lng: 3.0588 };
const ORAN = { lat: 35.6971, lng: -0.6308 };
const BLIDA = { lat: 36.4701, lng: 2.8277 };
const CONSTANTINE = { lat: 36.365, lng: 6.6147 };

describe('haversineM', () => {
  it('matches known city distances', () => {
    // Straight-line distances between city centres, within 1 km.
    const km = (a: typeof ALGER, b: typeof ALGER) => haversineM(a, b) / 1000;
    expect(Math.abs(km(ALGER, ORAN) - 351)).toBeLessThan(1);
    expect(Math.abs(km(ALGER, BLIDA) - 37.7)).toBeLessThan(1);
    expect(Math.abs(km(ALGER, CONSTANTINE) - 320.5)).toBeLessThan(1);
  });

  it('is zero for the same point and symmetric', () => {
    expect(haversineM(ALGER, ALGER)).toBe(0);
    expect(haversineM(ALGER, ORAN)).toBeCloseTo(haversineM(ORAN, ALGER), 6);
  });

  it('measures short distances (about 111 m per 0.001° of latitude)', () => {
    expect(haversineM(ALGER, { lat: ALGER.lat + 0.001, lng: ALGER.lng })).toBeCloseTo(111.2, 0);
  });
});

describe('evaluateGeo', () => {
  const now = new Date('2026-10-30T10:00:00Z');
  const reading = (over: Partial<GeoReading> = {}): GeoReading => ({
    ...ALGER,
    accuracyM: 20,
    isMocked: false,
    capturedAt: now,
    ...over,
  });
  const run = (geo: GeoReading | null, client: { lat: number; lng: number } | null = ALGER) =>
    evaluateGeo({ geo, client, radiusM: 150, maxAccuracyM: 200, receivedAt: now });

  it.each([
    ['no geo', null, ALGER, GeoStatus.NO_SIGNAL, true],
    [
      'mocked (wins over everything after it)',
      reading({ isMocked: true, accuracyM: 999 }),
      null,
      GeoStatus.MOCKED,
      true,
    ],
    ['accuracy over the max', reading({ accuracyM: 201 }), null, GeoStatus.LOW_ACCURACY, true],
    ['client without a point', reading(), null, GeoStatus.NO_CLIENT_GPS, false],
    ['at the client', reading(), ALGER, GeoStatus.OK, false],
    ['in another city', reading({ ...ORAN }), ALGER, GeoStatus.FAR, true],
  ] as const)('%s', (_label, geo, client, status, noteRequired) => {
    const r = run(geo, client);
    expect(r.status).toBe(status);
    expect(r.noteRequired).toBe(noteRequired);
  });

  it('accepts up to radius + accuracy, not one metre more', () => {
    // 0.0015° of latitude ≈ 167 m: OK with 20 m accuracy (170), FAR with 10 m (160).
    const near = { lat: ALGER.lat + 0.0015, lng: ALGER.lng };
    const d = Math.round(haversineM(near, ALGER));
    expect(run(reading({ ...near, accuracyM: d - 150 })).status).toBe(GeoStatus.OK);
    expect(run(reading({ ...near, accuracyM: d - 151 })).status).toBe(GeoStatus.FAR);
    expect(run(reading({ ...near, accuracyM: d - 150 })).distanceM).toBe(d);
  });

  it('accuracy exactly at the max is still usable', () => {
    expect(run(reading({ accuracyM: 200 })).status).toBe(GeoStatus.OK);
  });

  it('flags a late sync whatever the status', () => {
    const old = new Date(now.getTime() - 2 * 60 * 60 * 1000 - 1);
    expect(run(reading({ capturedAt: old })).flags).toEqual([GeoFlag.LATE_SYNC]);
    expect(run(reading({ capturedAt: old, ...ORAN })).flags).toEqual([GeoFlag.LATE_SYNC]);
    const justInTime = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    expect(run(reading({ capturedAt: justInTime })).flags).toEqual([]);
    expect(run(null).flags).toEqual([]);
  });
});
