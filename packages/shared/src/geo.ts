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
