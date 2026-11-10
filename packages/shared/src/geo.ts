import { GeoFlag, GeoStatus } from './enums';

/**
 * Géolocalisation (phase 17). The device sends raw data; the API decides with these
 * functions. Distances are in metres. No PostGIS: one point against one point.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (Haversine). */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** An offline operation replayed later than this gets the LATE_SYNC flag. */
export const GEO_LATE_SYNC_MS = 2 * 60 * 60 * 1000;

export const GEO_DEFAULTS = { radiusM: 150, maxAccuracyM: 200 } as const;

export interface GeoReading extends LatLng {
  accuracyM: number;
  isMocked: boolean;
  capturedAt: Date;
}

export interface GeoEvaluation {
  status: GeoStatus;
  /** Whole metres; null when there is nothing to compare. */
  distanceM: number | null;
  flags: GeoFlag[];
  /** Every status but OK and NO_CLIENT_GPS needs the seller's note. */
  noteRequired: boolean;
}

/**
 * The status rules of docs/domain.md, first match wins:
 * no geo → NO_SIGNAL, mocked → MOCKED, accuracy over the max → LOW_ACCURACY,
 * client without a point → NO_CLIENT_GPS, within radius + accuracy → OK, else FAR.
 */
export function evaluateGeo(input: {
  geo: GeoReading | null;
  client: LatLng | null;
  radiusM: number;
  maxAccuracyM: number;
  receivedAt: Date;
}): GeoEvaluation {
  const { geo, client } = input;
  const flags: GeoFlag[] = [];
  if (geo && input.receivedAt.getTime() - geo.capturedAt.getTime() > GEO_LATE_SYNC_MS) {
    flags.push(GeoFlag.LATE_SYNC);
  }
  const distanceM = geo && client ? Math.round(haversineM(geo, client)) : null;
  const status = !geo
    ? GeoStatus.NO_SIGNAL
    : geo.isMocked
      ? GeoStatus.MOCKED
      : geo.accuracyM > input.maxAccuracyM
        ? GeoStatus.LOW_ACCURACY
        : !client || distanceM === null
          ? GeoStatus.NO_CLIENT_GPS
          : distanceM <= input.radiusM + geo.accuracyM
            ? GeoStatus.OK
            : GeoStatus.FAR;
  return {
    status,
    distanceM,
    flags,
    noteRequired: status !== GeoStatus.OK && status !== GeoStatus.NO_CLIENT_GPS,
  };
}

// ---------------------------------------------------------------- client map (phase 35)

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/**
 * The lat/lng box that holds every point within `radiusM` of `center`, used by SQL as a
 * cheap prefilter before the exact haversine. It may be a little larger than the circle,
 * never smaller. Near ±180° the longitude range wraps: `minLng > maxLng` then means
 * "from minLng east to 180, and from -180 to maxLng". Near a pole it spans every longitude.
 */
export function boundingBox(center: LatLng, radiusM: number): BoundingBox {
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const minLat = Math.max(-90, center.lat - dLat);
  const maxLat = Math.min(90, center.lat + dLat);
  // The widest longitude span is at the latitude of the box farthest from the equator.
  const farLat = Math.max(Math.abs(minLat), Math.abs(maxLat));
  const cos = Math.cos(rad(farLat));
  if (farLat >= 90 || cos <= 0 || radiusM / (EARTH_RADIUS_M * cos) >= Math.PI / 2) {
    return { minLat, minLng: -180, maxLat, maxLng: 180 };
  }
  const dLng = Math.asin(Math.min(1, Math.sin(radiusM / EARTH_RADIUS_M) / cos)) * (180 / Math.PI);
  const wrap = (lng: number) => (lng > 180 ? lng - 360 : lng < -180 ? lng + 360 : lng);
  if (dLng >= 180) return { minLat, minLng: -180, maxLat, maxLng: 180 };
  return { minLat, minLng: wrap(center.lng - dLng), maxLat, maxLng: wrap(center.lng + dLng) };
}

/**
 * Greedy nearest-neighbour order (phase 35, "Ordonner par proximité"): from `start`, go to
 * the closest point not visited yet, then the closest to that one, and so on. Straight
 * lines, not roads, and not the optimal tour. Points without coordinates keep their
 * relative order at the end. Ties keep the input order. Without a start, the first point
 * with coordinates is the start (and stays first).
 */
export function orderByNearest<T extends { lat: number | null; lng: number | null }>(
  start: LatLng | null,
  points: readonly T[],
): T[] {
  const located = points.filter((p): p is T & LatLng => p.lat !== null && p.lng !== null);
  const without = points.filter((p) => p.lat === null || p.lng === null);
  const out: T[] = [];
  const left = [...located];
  let here: LatLng | null = start;
  if (!here && left.length > 0) {
    const first = left.shift()!;
    out.push(first);
    here = first;
  }
  while (left.length > 0 && here) {
    let best = 0;
    let bestM = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = haversineM(here, left[i]!);
      if (d < bestM) {
        best = i;
        bestM = d;
      }
    }
    const next = left.splice(best, 1)[0]!;
    out.push(next);
    here = next;
  }
  return [...out, ...without];
}

/** A straight-line distance for people: `950 m`, `1,2 km`, `124 km`. */
export function formatDistanceM(metres: number): string {
  const m = Math.max(0, Math.round(metres));
  if (m < 1000) return `${m}\u00a0m`;
  const km = m / 1000;
  return km < 100 ? `${km.toFixed(1).replace('.', ',')}\u00a0km` : `${Math.round(km)}\u00a0km`;
}

/** A link that opens the phone's maps app (or the browser) on a point, for directions. */
export function directionsUrl(p: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
}
