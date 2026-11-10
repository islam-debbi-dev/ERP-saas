import { describe, expect, it } from 'vitest';
import { GeoFlag, GeoStatus } from './enums';
import {
  boundingBox,
  directionsUrl,
  evaluateGeo,
  formatDistanceM,
  type GeoReading,
  haversineM,
  orderByNearest,
} from './geo';

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

describe('boundingBox', () => {
  /** Every point on the circle must be inside the box (sampled every 5°). */
  const holdsCircle = (center: { lat: number; lng: number }, radiusM: number) => {
    const box = boundingBox(center, radiusM);
    const R = 6_371_008.8;
    const d = radiusM / R;
    const φ1 = (center.lat * Math.PI) / 180;
    const λ1 = (center.lng * Math.PI) / 180;
    for (let b = 0; b < 360; b += 5) {
      const θ = (b * Math.PI) / 180;
      const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
      const λ2 =
        λ1 +
        Math.atan2(
          Math.sin(θ) * Math.sin(d) * Math.cos(φ1),
          Math.cos(d) - Math.sin(φ1) * Math.sin(φ2),
        );
      const lat = (φ2 * 180) / Math.PI;
      let lng = (λ2 * 180) / Math.PI;
      lng = ((((lng + 180) % 360) + 360) % 360) - 180;
      expect(lat).toBeGreaterThanOrEqual(box.minLat - 1e-9);
      expect(lat).toBeLessThanOrEqual(box.maxLat + 1e-9);
      const inLng =
        box.minLng <= box.maxLng
          ? lng >= box.minLng - 1e-9 && lng <= box.maxLng + 1e-9
          : lng >= box.minLng - 1e-9 || lng <= box.maxLng + 1e-9;
      expect(inLng).toBe(true);
    }
    return box;
  };

  it('holds the circle near the equator, about 0.045° per 5 km both ways', () => {
    const box = holdsCircle({ lat: 0, lng: 10 }, 5000);
    expect(box.maxLat - box.minLat).toBeCloseTo(0.0899, 3);
    expect(box.maxLng - box.minLng).toBeCloseTo(0.0899, 3);
  });

  it('is wider in longitude at Algerian latitudes', () => {
    const box = holdsCircle(ALGER, 5000);
    expect(box.maxLat - box.minLat).toBeCloseTo(0.0899, 3);
    // 1/cos(36.8°) ≈ 1.25
    expect((box.maxLng - box.minLng) / (box.maxLat - box.minLat)).toBeCloseTo(1.25, 1);
    holdsCircle({ lat: 22.785, lng: 5.5228 }, 50_000); // Tamanrasset, largest radius
  });

  it('wraps around ±180°', () => {
    const east = holdsCircle({ lat: 10, lng: 179.99 }, 5000);
    expect(east.minLng).toBeGreaterThan(east.maxLng);
    expect(east.maxLng).toBeLessThan(-179.9);
    const west = holdsCircle({ lat: -10, lng: -179.99 }, 5000);
    expect(west.minLng).toBeGreaterThan(west.maxLng);
    expect(west.minLng).toBeGreaterThan(179.9);
  });

  it('spans every longitude near a pole', () => {
    expect(boundingBox({ lat: 89.99, lng: 0 }, 5000)).toMatchObject({
      minLng: -180,
      maxLng: 180,
      maxLat: 90,
    });
  });
});

describe('orderByNearest', () => {
  const p = (id: string, lat: number | null, lng: number | null) => ({ id, lat, lng });
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it('handles no point and one point', () => {
    expect(orderByNearest(ALGER, [])).toEqual([]);
    expect(ids(orderByNearest(ALGER, [p('a', 36.7, 3.1)]))).toEqual(['a']);
    expect(ids(orderByNearest(null, [p('a', null, null)]))).toEqual(['a']);
  });

  it('goes to the nearest point each time from the start', () => {
    const far = p('far', 36.9, 3.0588);
    const mid = p('mid', 36.8, 3.0588);
    const near = p('near', 36.76, 3.0588);
    expect(ids(orderByNearest(ALGER, [far, mid, near]))).toEqual(['near', 'mid', 'far']);
  });

  it('starts from the first located point without a start', () => {
    const a = p('a', 36.9, 3.0);
    const b = p('b', 36.7, 3.0);
    const c = p('c', 36.85, 3.0);
    expect(ids(orderByNearest(null, [a, b, c]))).toEqual(['a', 'c', 'b']);
  });

  it('keeps the input order on ties', () => {
    // Two shops in the same building.
    const left = p('left', 36.76, 3.06);
    const right = p('right', 36.76, 3.06);
    expect(ids(orderByNearest(ALGER, [left, right]))[0]).toBe('left');
    expect(ids(orderByNearest(ALGER, [right, left]))[0]).toBe('right');
  });

  it('puts points without coordinates at the end, in their order', () => {
    const out = orderByNearest(ALGER, [
      p('x', null, null),
      p('far', 37, 3),
      p('y', 36, null),
      p('near', 36.76, 3.06),
    ]);
    expect(ids(out)).toEqual(['near', 'far', 'x', 'y']);
  });
});

describe('formatDistanceM', () => {
  it('shows metres below 1 km and km with one decimal above', () => {
    expect(formatDistanceM(950)).toBe('950\u00a0m');
    expect(formatDistanceM(349.6)).toBe('350\u00a0m');
    expect(formatDistanceM(1200)).toBe('1,2\u00a0km');
    expect(formatDistanceM(1000)).toBe('1\u00a0km');
    expect(formatDistanceM(25_000)).toBe('25\u00a0km');
    expect(formatDistanceM(2449)).toBe('2,4\u00a0km');
    expect(formatDistanceM(123_600)).toBe('124\u00a0km');
    expect(formatDistanceM(-3)).toBe('0\u00a0m');
  });
});

describe('directionsUrl', () => {
  it('points Google Maps at the destination', () => {
    expect(directionsUrl({ lat: 36.75, lng: 3.05 })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=36.75,3.05',
    );
  });
});
