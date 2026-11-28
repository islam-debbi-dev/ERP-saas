import { z } from 'zod';
import {
  BY_DIMENSIONS,
  STAT_COMPARES,
  STAT_GROUP_BYS,
  STAT_MAX_SPLIT,
  STAT_MEASURE_KEYS,
  type StatCell,
  type StatDimension,
  type StatGroupBy,
  type StatMeasure,
  type StatUnit,
  VEHICLE_TARGET_METRICS,
  type VehicleTargetMetric,
} from '../distribution-stats';
import { type NoSaleReason, VEHICLE_ACTIVITIES, type VehicleActivity } from '../enums';
import { parseDA } from '../money';
import { type DayRange, rangeLength } from '../periods';
import { WILAYA_MAX, WILAYA_MIN } from '../wilayas';
import { normalizeDecimal } from './common';
import { MAX_REPORT_DAYS } from './reports';

const id = z.uuid();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');
/** The most values one multi-select filter carries. */
export const STAT_FILTER_MAX = 100;

/** `a,b,c` in a query string (or a repeated key) → a list without duplicates. */
const list = <T extends z.ZodType>(item: T, max = STAT_FILTER_MAX) =>
  z
    .preprocess((v) => {
      if (v === undefined || v === '') return undefined;
      if (typeof v !== 'string' && !Array.isArray(v)) return v;
      const parts: unknown[] = Array.isArray(v) ? v : v.split(',');
      // Anything that is not text is left for the item schema to refuse.
      const texts = parts.map((p) => (typeof p === 'string' ? p.trim() : p));
      return [...new Set(texts.filter((p) => p !== ''))];
    }, z.array(item).max(max))
    .optional();

/** The multi-select filters every statistics endpoint takes. */
export const STAT_FILTER_KEYS = [
  'warehouseIds',
  'vehicleIds',
  'vehicleTypeIds',
  'activities',
  'vehicleWilayas',
  'clientWilayas',
  'clientDairas',
  'clientCommunes',
  'brandIds',
  'categoryIds',
  'productIds',
  'segmentIds',
  'sectorIds',
  'clientIds',
] as const;
export type StatFilterKey = (typeof STAT_FILTER_KEYS)[number];

const filterFields = {
  /** Dépôts / CDD: each one with its trucks. */
  warehouseIds: list(id),
  vehicleIds: list(id),
  vehicleTypeIds: list(id),
  activities: list(z.enum(VEHICLE_ACTIVITIES)),
  /** Wilaya numbers of the trucks. */
  vehicleWilayas: list(z.coerce.number().int().min(WILAYA_MIN).max(WILAYA_MAX)),
  /**
   * Wilaya numbers of the clients. A wilaya NAME is also accepted so that old links keep
   * working (deprecated, phase 40a): the API maps it with `findWilaya`, and a value it
   * cannot map matches no client.
   */
  clientWilayas: list(z.string().trim().min(1).max(60)),
  /** Daïra keys of `@erp/shared/communes`. */
  clientDairas: list(z.string().trim().min(1).max(100)),
  /** Commune codes. */
  clientCommunes: list(z.coerce.number().int().min(1).max(99_999)),
  brandIds: list(id),
  /** A family includes its sub-families. */
  categoryIds: list(id),
  productIds: list(id),
  segmentIds: list(id),
  sectorIds: list(id),
  clientIds: list(id),
};

const baseFields = {
  /** Algiers days, both included; at most 366 days. */
  from: dateString,
  to: dateString,
  compare: z.enum(STAT_COMPARES).default('none'),
  groupBy: z.enum(STAT_GROUP_BYS).default('day'),
  ...filterFields,
};

type Ranged = { from: string; to: string };
const ranged = <T extends z.ZodType<Ranged>>(schema: T) =>
  schema
    .refine((q) => q.from <= q.to, { message: 'invalid_range', path: ['to'] })
    .refine((q) => q.from > q.to || rangeLength(q) <= MAX_REPORT_DAYS, {
      message: 'range_too_long',
      path: ['from'],
    });

/** The one filter schema of `GET /stats/distribution/*`. */
export const distributionStatsQuerySchema = ranged(z.object(baseFields));
export type DistributionStatsQuery = z.infer<typeof distributionStatsQuerySchema>;
export type StatFilters = Pick<DistributionStatsQuery, StatFilterKey>;

export const statsByDimensionQuerySchema = ranged(
  z.object({
    ...baseFields,
    dimension: z.enum(BY_DIMENSIONS as [StatDimension, ...StatDimension[]]),
  }),
);
export type StatsByDimensionQuery = z.infer<typeof statsByDimensionQuerySchema>;

const measureKey = z.enum(STAT_MEASURE_KEYS as [StatMeasure, ...StatMeasure[]]);

export const statsTimelineQuerySchema = ranged(
  z.object({
    ...baseFields,
    measure: measureKey,
    /** One series per value of this dimension (the top ones), or per picked truck. */
    splitBy: z
      .enum(['vehicle', ...BY_DIMENSIONS] as [StatDimension, ...StatDimension[]])
      .optional(),
  }),
).refine((q) => q.splitBy !== 'vehicle' || (q.vehicleIds?.length ?? 0) <= STAT_MAX_SPLIT, {
  message: 'too_many_series',
  path: ['vehicleIds'],
});
export type StatsTimelineQuery = z.infer<typeof statsTimelineQuerySchema>;

export const statsVehicleDayQuerySchema = z.object({ vehicleId: id, date: dateString });
export type StatsVehicleDayQuery = z.infer<typeof statsVehicleDayQuerySchema>;

export const STAT_EXPORT_VIEWS = [
  'overview',
  'by-vehicle',
  'by-dimension',
  'timeline',
  'visits',
  'dispersion',
  'vehicle-day',
] as const;
export type StatExportView = (typeof STAT_EXPORT_VIEWS)[number];

/** `export.xlsx?view=`: the query of the matching view plus `view`. */
export const statsExportQuerySchema = z
  .object({
    ...baseFields,
    from: dateString.optional(),
    to: dateString.optional(),
    view: z.enum(STAT_EXPORT_VIEWS),
    dimension: z.enum(BY_DIMENSIONS as [StatDimension, ...StatDimension[]]).optional(),
    measure: measureKey.optional(),
    splitBy: z
      .enum(['vehicle', ...BY_DIMENSIONS] as [StatDimension, ...StatDimension[]])
      .optional(),
    vehicleId: id.optional(),
    date: dateString.optional(),
  })
  .superRefine((q, ctx) => {
    const need = (key: 'from' | 'to' | 'dimension' | 'measure' | 'vehicleId' | 'date') => {
      if (q[key] === undefined) ctx.addIssue({ code: 'custom', message: 'required', path: [key] });
    };
    if (q.view === 'vehicle-day') {
      need('vehicleId');
      need('date');
      return;
    }
    need('from');
    need('to');
    if (q.view === 'by-dimension') need('dimension');
    if (q.view === 'timeline') need('measure');
    if (q.from && q.to) {
      if (q.from > q.to) ctx.addIssue({ code: 'custom', message: 'invalid_range', path: ['to'] });
      else if (rangeLength({ from: q.from, to: q.to }) > MAX_REPORT_DAYS) {
        ctx.addIssue({ code: 'custom', message: 'range_too_long', path: ['from'] });
      }
    }
  });
export type StatsExportQuery = z.infer<typeof statsExportQuerySchema>;

// ---------------------------------------------------------------- DTOs

/** A filter some figures of the answer could not follow: they are null, never wrong. */
export type StatNotApplicable = Partial<Record<StatMeasure, StatFilterKey[]>>;

export interface StatTileDto extends StatCell {
  /** The same figure over the comparison period; null without a comparison. */
  previous: string | null;
  /** Change in percent (1 decimal); null without a comparison or with a previous ≤ 0. */
  changePct: string | null;
  trend: 'up' | 'down' | 'flat' | null;
  /** The value per bucket of the period (sum measures only), for the sparkline. */
  spark: { bucket: string; value: string }[] | null;
  /** The list behind the figure: a path with its query string. */
  link: string | null;
}

export interface StatsMetaDto extends DayRange {
  compare: DayRange | null;
  groupBy: StatGroupBy;
  notApplicable: StatNotApplicable;
  /** Sale lines of the period whose product has no weight ("poids inconnu"). */
  weightUnknownLines: number;
  /** True when the user sees cost values (REPORTS_FINANCE). */
  finance: boolean;
}

export interface StatsOverviewDto extends StatsMetaDto {
  tiles: StatTileDto[];
  /** Bons de commande of the day before the period's end ("J-1"). */
  bcPreviousDay: { day: string; count: StatCell; ttc: StatCell };
}

export interface StatVehicleRef {
  id: string;
  code: string | null;
  name: string;
  type: { id: string; code: string; name: string; activity: VehicleActivity } | null;
  wilayaCode: number | null;
  capacityKg: number | null;
  depot: { id: string; name: string } | null;
}

export interface StatObjectiveDto {
  metric: VehicleTargetMetric;
  /** First day of the month the target is for. */
  periodStart: string;
  target: string;
  /** The month's figure, in the metric's own unit (kg for POIDS_KG). */
  achieved: string;
  /** achieved / target in percent; null without a positive target. */
  pct: string | null;
}

export interface StatVehicleRowDto {
  /** null: everything that has no truck ("Sans véhicule / dépôt"). */
  vehicle: StatVehicleRef | null;
  /** Who drove it during the period, in order. */
  drivers: { id: string; fullName: string; fromAt: string }[];
  cells: StatCell[];
  objectives: StatObjectiveDto[];
  link: string | null;
}

export interface StatsByVehicleDto extends StatsMetaDto {
  rows: StatVehicleRowDto[];
  totals: StatCell[];
}

export interface StatDimensionRowDto {
  /** null: rows without a value on this dimension ("Non renseigné"). */
  key: string | null;
  /**
   * The name to print; null when the web names the key itself (wilaya number, activity).
   * Daïras and communes (keys: daïra key, commune code) come with their French name.
   */
  label: string | null;
  cells: StatCell[];
  link: string | null;
}

export interface StatsByDimensionDto extends StatsMetaDto {
  dimension: StatDimension;
  rows: StatDimensionRowDto[];
  /** What is beyond the top rows; ratios are recomputed, distinct counts are null. */
  others: { count: number; cells: StatCell[] } | null;
  totals: StatCell[];
}

export interface StatsTimelineDto extends StatsMetaDto {
  measure: StatMeasure;
  unit: StatUnit;
  buckets: {
    bucket: string;
    from: string;
    to: string;
    value: string | null;
    /** The bucket at the same position of the comparison period. */
    previous: string | null;
    estimated: boolean;
  }[];
  splitBy: StatDimension | null;
  series: { key: string | null; label: string | null; values: (string | null)[] }[];
}

export interface StatsVisitsDto extends StatsMetaDto {
  rows: { vehicle: StatVehicleRef | null; cells: StatCell[]; link: string | null }[];
  totals: StatCell[];
  reasons: { reason: NoSaleReason; count: number }[];
  /**
   * The first day the planning is known (the oldest vehicle route): before it there is no
   * planned stop to compare with ("planification inconnue"). null: no vehicle route at all.
   */
  planningKnownFrom: string | null;
}

export interface StatsDispersionDto extends StatsMetaDto {
  days: string[];
  rows: {
    vehicle: StatVehicleRef | null;
    /** One entry per day of `days`. */
    cells: { caTtc: string; nbBl: number }[];
    caTtc: string;
    nbBl: number;
  }[];
  /** The largest daily CA of the table, for the colour scale. */
  maxCaTtc: string;
}

export interface StatDocumentRef {
  id: string;
  number: string | null;
  /** The page of the document. */
  link: string;
  at: string;
  /** The client or the other dépôt, when there is one. */
  party: string | null;
  amount: string | null;
  weightKg: string | null;
}

export interface StatsVehicleDayDto {
  date: string;
  vehicle: StatVehicleRef;
  drivers: { id: string; fullName: string; fromAt: string }[];
  finance: boolean;
  /** The day's figures; a section's documents are below. */
  cells: StatCell[];
  loads: StatDocumentRef[];
  sales: StatDocumentRef[];
  returns: (StatDocumentRef & { damaged: boolean })[];
  unloads: StatDocumentRef[];
  payments: StatDocumentRef[];
  /** The clôture of the day; null fields while it is open or was never opened. */
  cash: {
    expected: string | null;
    handed: string | null;
    ecart: string | null;
    closed: boolean;
    link: string | null;
  };
}

/**
 * "Clients perdus": clients who bought in the comparison period and not in this one, the
 * largest first. `count` is all of them; `clients` the first ones.
 */
export interface StatsLostClientsDto extends DayRange {
  compare: DayRange;
  /** Clients actifs of the period and of the comparison period. */
  active: number;
  previousActive: number;
  count: number;
  clients: { id: string; name: string; previousCaTtc: string; link: string }[];
}

/** "Mon véhicule" on the dashboard of a seller or a livreur. */
export interface StatsMyVehicleDto {
  /** null: he drives no truck today. */
  vehicle: StatVehicleRef | null;
  date: string;
  today: StatCell[];
  objectives: StatObjectiveDto[];
}

// ---------------------------------------------------------------- client segments

const segmentFields = {
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(80),
};
export const createClientSegmentSchema = z.object(segmentFields);
export type CreateClientSegmentInput = z.infer<typeof createClientSegmentSchema>;
export const updateClientSegmentSchema = z.object(segmentFields).partial().strict();
export type UpdateClientSegmentInput = z.infer<typeof updateClientSegmentSchema>;

export interface ClientSegmentDto {
  id: string;
  code: string;
  name: string;
  archived: boolean;
  /** Live clients in this segment. */
  clientCount: number;
}

// ---------------------------------------------------------------- vehicle targets

/** First day of a month: `YYYY-MM-01`. */
export const monthStartString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, 'invalid_month');

/** A target value: positive, at most 3 decimals, fits `Decimal(16,3)`. */
const targetValue = z
  .string()
  .refine((v) => {
    const parsed = parseDA(v);
    return parsed !== null && parsed.gt(0) && parsed.decimalPlaces() <= 3 && parsed.lt('1e13');
  }, 'invalid_target')
  .transform(normalizeDecimal);

export const vehicleTargetsQuerySchema = z.object({ period: monthStartString });
export type VehicleTargetsQuery = z.infer<typeof vehicleTargetsQuerySchema>;

/** The whole month of some trucks: a null value removes the target. */
export const putVehicleTargetsSchema = z.object({
  period: monthStartString,
  targets: z
    .array(
      z.object({
        vehicleId: id,
        metric: z.enum(VEHICLE_TARGET_METRICS),
        targetValue: targetValue.nullable(),
      }),
    )
    .min(1)
    .max(1000)
    .refine(
      (rows) => new Set(rows.map((r) => `${r.vehicleId}:${r.metric}`)).size === rows.length,
      'duplicate_target',
    ),
});
export type PutVehicleTargetsInput = z.infer<typeof putVehicleTargetsSchema>;

export const copyVehicleTargetsSchema = z.object({ period: monthStartString });
export type CopyVehicleTargetsInput = z.infer<typeof copyVehicleTargetsSchema>;

export interface VehicleTargetDto {
  vehicleId: string;
  metric: VehicleTargetMetric;
  periodStart: string;
  targetValue: string;
}

export interface VehicleTargetsDto {
  period: string;
  targets: VehicleTargetDto[];
}
