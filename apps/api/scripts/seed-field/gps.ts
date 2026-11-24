/**
 * Deterministic GPS points around the towns of the wilaya of M'Sila (28). A fixed seed makes
 * every run give the same points, so a rerun never moves a client.
 */
export interface Point {
  lat: number;
  lng: number;
}

export interface Town {
  key: string;
  name: string;
  centre: Point;
  /** Spread around the centre, in metres (towns only: every point stays inside the built-up area). */
  radiusM: number;
}

// Approximate town centres (decimal degrees).
export const TOWNS: Record<string, Town> = {
  msila: { key: 'msila', name: "M'Sila", centre: { lat: 35.7058, lng: 4.5419 }, radiusM: 3000 },
  bousaada: { key: 'bousaada', name: 'Bou Saâda', centre: { lat: 35.2111, lng: 4.1736 }, radiusM: 2500 },
  sidiaissa: { key: 'sidiaissa', name: 'Sidi Aïssa', centre: { lat: 35.3333, lng: 3.7167 }, radiusM: 2200 },
  ainelmelh: { key: 'ainelmelh', name: 'Aïn El Melh', centre: { lat: 35.8167, lng: 4.1833 }, radiusM: 1800 },
  magra: { key: 'magra', name: 'Magra', centre: { lat: 35.6089, lng: 4.4631 }, radiusM: 2000 },
  berhoum: { key: 'berhoum', name: 'Berhoum', centre: { lat: 35.7167, lng: 4.9500 }, radiusM: 1800 },
};

/** mulberry32: small seeded PRNG, returns a function giving numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M_PER_DEG_LAT = 111_320;

export function offsetM(p: Point, northM: number, eastM: number): Point {
  const lat = p.lat + northM / M_PER_DEG_LAT;
  const lng = p.lng + eastM / (M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180));
  return { lat: round6(lat), lng: round6(lng) };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** A point inside the town's disc (uniform by area), from the given generator. */
export function pointInTown(town: Town, next: () => number): Point {
  const r = town.radiusM * Math.sqrt(next());
  const theta = next() * 2 * Math.PI;
  return offsetM(town.centre, r * Math.cos(theta), r * Math.sin(theta));
}

export function haversineM(a: Point, b: Point): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A position about 1.1 km north of the client: far beyond the default 150 m radius. */
export function farFrom(p: Point): Point {
  return offsetM(p, 1100, 0);
}

/** A position a few metres from the client (inside the radius). */
export function nearTo(p: Point, next: () => number): Point {
  return offsetM(p, (next() - 0.5) * 40, (next() - 0.5) * 40);
}

/** Stops in a sensible driving order: nearest neighbour from the given start. */
export function orderByProximity<T extends { point: Point }>(items: T[], start: Point): T[] {
  const left = [...items];
  const out: T[] = [];
  let cur = start;
  while (left.length > 0) {
    let best = 0;
    let bestD = Infinity;
    left.forEach((it, i) => {
      const d = haversineM(cur, it.point);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const [next] = left.splice(best, 1);
    out.push(next!);
    cur = next!.point;
  }
  return out;
}
