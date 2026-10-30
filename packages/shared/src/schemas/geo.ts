import { z } from 'zod';
import {
  GEO_CHANGE_REQUEST_STATUSES,
  GEO_STATUSES,
  GeoReviewStatus,
  type GeoChangeRequestStatus,
  type GeoFlag,
  type GeoRefType,
  type GeoReviewStatus as GeoReviewStatusValue,
  type GeoStatus,
} from '../enums';

const id = z.uuid();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');
const note = z.string().trim().min(3).max(255);

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
/** Metres, as reported by the device. */
const accuracyM = z.number().min(0).max(100_000);

/**
 * Where the device was at the moment of the operation (phase 17). Raw data only: the
 * API computes the distance and the status. Never sent continuously (law 18-07).
 * The position is all or nothing: without it (no signal, permission refused) the
 * object may carry only the note, and the check is NO_SIGNAL.
 */
export const geoInputSchema = z
  .object({
    lat: lat.optional(),
    lng: lng.optional(),
    accuracyM: accuracyM.optional(),
    /** Android's mock-location flag; a browser cannot know it and sends false. */
    isMocked: z.boolean().default(false),
    /** Device clock; a replay more than 2 h later gets LATE_SYNC. */
    capturedAt: z.iso.datetime({ offset: true }).optional(),
    /** Required when the API answers GEO_NOTE_REQUIRED. */
    note: note.optional(),
  })
  .refine(
    (g) => {
      const given = [g.lat, g.lng, g.accuracyM, g.capturedAt].filter((v) => v !== undefined);
      return given.length === 0 || given.length === 4;
    },
    { message: 'incomplete_position', path: ['lat'] },
  );
export type GeoInput = z.infer<typeof geoInputSchema>;

/** The operation's GeoCheck as returned with the document. */
export interface GeoCheckResultDto {
  id: string;
  status: GeoStatus;
  distanceM: number | null;
  flags: GeoFlag[];
  /** NO_CLIENT_GPS: the web offers to save this point as the client's location. */
  offerSaveClientLocation: boolean;
}

/** Details of GEO_NOTE_REQUIRED / GEO_TOO_FAR / GEO_MOCKED errors. */
export interface GeoErrorDetails {
  status: GeoStatus;
  distanceM: number | null;
}

// ---------------------------------------------------------------- client location

export const clientLocationSchema = z.object({
  lat,
  lng,
  accuracyM: accuracyM.nullable().default(null),
});
export type ClientLocationInput = z.infer<typeof clientLocationSchema>;

export interface ClientLocationDto {
  lat: number;
  lng: number;
  accuracyM: number | null;
  setAt: string | null;
  setById: string | null;
}

export const locationRequestSchema = clientLocationSchema.extend({
  note: z.string().trim().max(255).optional(),
});
export type LocationRequestInput = z.infer<typeof locationRequestSchema>;

export const rejectLocationRequestSchema = z.object({ reason: note });
export type RejectLocationRequestInput = z.infer<typeof rejectLocationRequestSchema>;

export const locationRequestListQuerySchema = z.object({
  status: z.enum(GEO_CHANGE_REQUEST_STATUSES).optional(),
  clientId: id.optional(),
});
export type LocationRequestListQuery = z.infer<typeof locationRequestListQuerySchema>;

export interface LocationRequestDto {
  id: string;
  client: { id: string; code: string; name: string };
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** The client's point when the request was made (null: none yet). */
  previous: { lat: number; lng: number } | null;
  note: string | null;
  status: GeoChangeRequestStatus;
  requestedBy: { id: string; fullName: string } | null;
  requestedAt: string;
  decidedBy: { id: string; fullName: string } | null;
  decidedAt: string | null;
  rejectReason: string | null;
  /** The current user may approve or reject it. */
  canDecide: boolean;
}

// ---------------------------------------------------------------- flagged operations

export const geoCheckListQuerySchema = z.object({
  status: z.enum(GEO_STATUSES).optional(),
  /** Default list: everything but OK. */
  flaggedOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(true),
  sellerId: id.optional(),
  reviewStatus: z
    .enum([GeoReviewStatus.NONE, GeoReviewStatus.JUSTIFIED, GeoReviewStatus.NOT_JUSTIFIED])
    .optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type GeoCheckListQuery = z.infer<typeof geoCheckListQuerySchema>;

export interface GeoCheckDto {
  id: string;
  refType: GeoRefType;
  refId: string;
  /** Number of the sale or versement; null for a visit. */
  refNumber: string | null;
  user: { id: string; fullName: string } | null;
  client: { id: string; code: string; name: string; lat: number | null; lng: number | null } | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  isMocked: boolean;
  capturedAt: string | null;
  receivedAt: string;
  distanceM: number | null;
  status: GeoStatus;
  flags: GeoFlag[];
  note: string | null;
  reviewStatus: GeoReviewStatusValue;
  reviewedBy: { id: string; fullName: string } | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface GeoCheckPage {
  items: GeoCheckDto[];
  nextCursor: string | null;
}

export const reviewGeoCheckSchema = z.object({
  verdict: z.enum([GeoReviewStatus.JUSTIFIED, GeoReviewStatus.NOT_JUSTIFIED]),
  note: z.string().trim().max(255).optional(),
});
export type ReviewGeoCheckInput = z.infer<typeof reviewGeoCheckSchema>;

export const geoReportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'invalid_month'),
});
export type GeoReportQuery = z.infer<typeof geoReportQuerySchema>;

/** Flags per seller for one month (Africa/Algiers); phase 18 gates read it. */
export interface GeoReportRowDto {
  user: { id: string; fullName: string };
  total: number;
  ok: number;
  /** Everything that needed a note (not OK, not NO_CLIENT_GPS). */
  flagged: number;
  far: number;
  mocked: number;
  notJustified: number;
  pendingReview: number;
}

export interface GeoReportDto {
  month: string;
  rows: GeoReportRowDto[];
}
