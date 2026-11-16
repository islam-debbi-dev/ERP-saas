/**
 * Statistiques distribution (phase 37): the one definition of every figure, its unit and
 * its formula, plus the pure maths the API uses to derive rates and periods. The API
 * computes every value (SQL + decimal.js) and sends it as a string; the web only draws.
 * The same text is in docs/domain.md, "Statistiques distribution".
 */
import { money, type MoneyInput, toMoneyString } from './money';
import { previousPeriod } from './overview';
import { addDays, type DayRange, daysInMonth, weekdayOf } from './periods';

// ---------------------------------------------------------------- units

/** What a value is, so the web never guesses how to print it. */
export const StatUnit = {
  /** Dinars, 2 decimals: `1 234 567,89 DA`. */
  DA: 'DA',
  /** A whole number of things (BL, clients, visits, lines). */
  COUNT: 'COUNT',
  /** Tonnes, 3 decimals: `12,350 t`. */
  TONNE: 'TONNE',
  /** A rate in percent, 1 decimal: `87,5 %`. */
  PERCENT: 'PERCENT',
  /** A plain ratio, 2 decimals (SKU / BL). */
  RATIO: 'RATIO',
  /** A quantity in base units, 3 decimals. */
  QTY: 'QTY',
} as const;
export type StatUnit = (typeof StatUnit)[keyof typeof StatUnit];

// ---------------------------------------------------------------- measures

/**
 * How a measure behaves when rows are grouped:
 * - `sum`: Σ of the groups (incl. "Sans véhicule" / "Autres") = the ungrouped total, on
 *   every dimension the measure accepts;
 * - `distinct`: a count of distinct documents, clients or trucks: additive only on the
 *   dimensions its subject belongs to (a client is in one segment, but may buy from two
 *   trucks), so elsewhere Σ groups ≥ total;
 * - `ratio`: derived from two `sum` measures after aggregation, never summed.
 */
export type StatAdditivity = 'sum' | 'distinct' | 'ratio';

export interface StatMeasureDef {
  unit: StatUnit;
  additivity: StatAdditivity;
  /** For a ratio: numerator / denominator (× 100 for a PERCENT). */
  of?: readonly [numerator: string, denominator: string];
  /** Needs REPORTS_FINANCE (cost values); null in the DTO without it. */
  finance?: boolean;
}

/**
 * Every figure of the statistics. The doc comment of each entry is its definition; the
 * API registry (`apps/api/src/distribution-stats/registry.ts`) gives its SQL.
 */
export const STAT_MEASURES = {
  /**
   * CA TTC: Σ `totalTtc` of the validated BL and direct factures of the period (by
   * `validatedAt`, Algiers day) − Σ avoirs (retours client) made in the period on sales
   * that still count. A facture that groups BLs is never counted again.
   */
  caTtc: { unit: StatUnit.DA, additivity: 'sum' },
  /** Nb BL: validated BL + direct factures, not cancelled. */
  nbBl: { unit: StatUnit.COUNT, additivity: 'distinct' },
  /** Drop size: CA TTC / Nb BL; null with 0 BL. */
  dropSize: { unit: StatUnit.DA, additivity: 'ratio', of: ['caTtc', 'nbBl'] },
  /** Σ over the BL of their number of distinct products (the numerator of SKU / BL). */
  skuLines: { unit: StatUnit.COUNT, additivity: 'sum' },
  /** SKU / BL: average number of distinct products per BL; null with 0 BL. */
  skuPerBl: { unit: StatUnit.RATIO, additivity: 'ratio', of: ['skuLines', 'nbBl'] },
  /**
   * Poids vendu (t): Σ line weight / 1000, net of the weight of the avoirs of the period.
   * The weight frozen on the line at validation; a line written before phase 37 uses the
   * product's current weight and marks the figure "estimé". A line whose product has no
   * weight is counted in `weightUnknownLines`, never as 0 silently.
   */
  weightT: { unit: StatUnit.TONNE, additivity: 'sum' },
  /** Poids inconnu: sale lines of the period whose product has no weight. */
  weightUnknownLines: { unit: StatUnit.COUNT, additivity: 'sum' },
  /** Clients actifs (POS): distinct clients with ≥ 1 BL in the period. */
  activeClients: { unit: StatUnit.COUNT, additivity: 'distinct' },
  /**
   * Versements: Σ valid versements received in the period (cancelled and bounced cheques
   * excluded). Truck: the versement's own truck, else the truck its collector drove when
   * it was recorded, else none.
   */
  versements: { unit: StatUnit.DA, additivity: 'sum' },
  /**
   * Taux de recouvrement: versements / CA TTC of the period. It can exceed 100 % when old
   * debt is paid.
   */
  recouvrement: { unit: StatUnit.PERCENT, additivity: 'ratio', of: ['versements', 'caTtc'] },
  /** Bons de commande: orders confirmed in the period (by confirmation day), not cancelled. */
  bcCount: { unit: StatUnit.COUNT, additivity: 'sum' },
  /** TTC of those bons de commande. */
  bcTtc: { unit: StatUnit.DA, additivity: 'sum' },
  /**
   * Quantity ordered (base units) on the lines of the orders confirmed in the period that
   * are now delivered or cancelled.
   */
  orderedQty: { unit: StatUnit.QTY, additivity: 'sum' },
  /** Quantity delivered on those lines, capped per line at what was ordered. */
  deliveredQty: { unit: StatUnit.QTY, additivity: 'sum' },
  /** Taux de livraison: delivered / ordered, per line, never above 100 %. */
  deliveryRate: {
    unit: StatUnit.PERCENT,
    additivity: 'ratio',
    of: ['deliveredQty', 'orderedQty'],
  },
  /** Commandes en attente: orders confirmed in the period, neither delivered nor cancelled. */
  openOrders: { unit: StatUnit.COUNT, additivity: 'sum' },
  /** Chargements: validated LOAD transfers to the truck in the period. */
  loadCount: { unit: StatUnit.COUNT, additivity: 'sum' },
  /** Valeur de chargement at the CUMP of the validation (REPORTS_FINANCE). */
  loadValueCost: { unit: StatUnit.DA, additivity: 'sum', finance: true },
  /** Valeur de chargement in TTC at price level 1 (base unit price × quantity). */
  loadValueTtc: { unit: StatUnit.DA, additivity: 'sum' },
  /** Poids chargé (t), frozen like the sale lines. */
  loadWeightT: { unit: StatUnit.TONNE, additivity: 'sum' },
  /** Poids chargé (t) of the loads on a truck that has a capacity. */
  loadWeightCapT: { unit: StatUnit.TONNE, additivity: 'sum' },
  /** Σ capacity (t) of those loads: one capacity per load. */
  loadCapacityT: { unit: StatUnit.TONNE, additivity: 'sum' },
  /** Taux de remplissage: poids chargé / capacity, over the loads of trucks with a capacity. */
  fillRate: {
    unit: StatUnit.PERCENT,
    additivity: 'ratio',
    of: ['loadWeightCapT', 'loadCapacityT'],
  },
  /** Avaries (quantity): retours client with disposition DAMAGED on the truck's sales. */
  damagedQty: { unit: StatUnit.QTY, additivity: 'sum' },
  /** Avaries (value TTC). */
  damagedTtc: { unit: StatUnit.DA, additivity: 'sum' },
  /**
   * Écart de caisse: Σ écart of the truck's closed sessions of the period; a correction
   * (ADJUST) with a new count replaces the écart of its session.
   */
  cashEcart: { unit: StatUnit.DA, additivity: 'sum' },
  /**
   * Visites planifiées: for each day and each active vehicle route of that weekday, its
   * stops. A route counts from the day it was created.
   */
  visitsPlanned: { unit: StatUnit.COUNT, additivity: 'sum' },
  /** Planned stops that were visited that day by the truck. */
  plannedVisited: { unit: StatUnit.COUNT, additivity: 'sum' },
  /** Planned stops visited with a sale or an order. */
  plannedSuccess: { unit: StatUnit.COUNT, additivity: 'sum' },
  /** Visites effectuées: distinct (truck, client, day) with a non-corrected visit. */
  visitsDone: { unit: StatUnit.COUNT, additivity: 'sum' },
  /** Visites avec succès: of those, the ones with outcome SALE or ORDER. */
  visitsSuccess: { unit: StatUnit.COUNT, additivity: 'sum' },
  /** Visites sans achat (NO_SALE), counted by reason in the "causes" chart. */
  visitsNoSale: { unit: StatUnit.COUNT, additivity: 'sum' },
  /** Taux visités / planifiés: planned stops visited / planned stops (≤ 100 %). */
  visitRate: {
    unit: StatUnit.PERCENT,
    additivity: 'ratio',
    of: ['plannedVisited', 'visitsPlanned'],
  },
  /** Taux succès / planifiés: planned stops with a sale or an order / planned stops. */
  successPlannedRate: {
    unit: StatUnit.PERCENT,
    additivity: 'ratio',
    of: ['plannedSuccess', 'visitsPlanned'],
  },
  /** Taux succès / visités: visits with success / visits done. */
  successRate: {
    unit: StatUnit.PERCENT,
    additivity: 'ratio',
    of: ['visitsSuccess', 'visitsDone'],
  },
  /** Véhicules actifs: trucks with at least one BL in the period. */
  activeVehicles: { unit: StatUnit.COUNT, additivity: 'distinct' },
} as const satisfies Record<string, StatMeasureDef>;

export type StatMeasure = keyof typeof STAT_MEASURES;
export const STAT_MEASURE_KEYS = Object.keys(STAT_MEASURES) as StatMeasure[];

export function statMeasure(key: StatMeasure): StatMeasureDef {
  return STAT_MEASURES[key];
}

/** One value on the wire: the web prints it from `unit`, never computes it. */
export interface StatCell {
  measure: StatMeasure;
  unit: StatUnit;
  /** null: no base (0 BL), not allowed (finance), or a filter this figure cannot follow. */
  value: string | null;
  /** True when a weight used the product's current weight (lines older than phase 37). */
  estimated: boolean;
}

// ---------------------------------------------------------------- dimensions

/** What the figures can be grouped by. */
export const STAT_DIMENSIONS = [
  'vehicle',
  'vehicleType',
  'activity',
  'depot',
  'vehicleWilaya',
  'clientWilaya',
  'segment',
  'sector',
  'brand',
  'category',
  'subCategory',
  'product',
  'client',
] as const;
export type StatDimension = (typeof STAT_DIMENSIONS)[number];

/** The dimensions `GET /stats/distribution/by-dimension` accepts (a truck has its own view). */
export const BY_DIMENSIONS = STAT_DIMENSIONS.filter(
  (d): d is Exclude<StatDimension, 'vehicle'> => d !== 'vehicle',
);

export const STAT_GROUP_BYS = ['day', 'week', 'month'] as const;
export type StatGroupBy = (typeof STAT_GROUP_BYS)[number];

export const STAT_COMPARES = ['none', 'previous', 'lastYear'] as const;
export type StatCompare = (typeof STAT_COMPARES)[number];

/** Rows shown before the rest is folded into "Autres". */
export const STAT_TOP_ROWS = 50;
/** Trucks a timeline can be split by. */
export const STAT_MAX_SPLIT = 8;

// ---------------------------------------------------------------- targets

/** What a truck's monthly target is set on (phase 37). Not read by the incentives engine. */
export const VehicleTargetMetric = {
  CA_TTC: 'CA_TTC',
  POIDS_KG: 'POIDS_KG',
  NB_BL: 'NB_BL',
  CLIENTS_ACTIFS: 'CLIENTS_ACTIFS',
} as const;
export type VehicleTargetMetric = (typeof VehicleTargetMetric)[keyof typeof VehicleTargetMetric];
export const VEHICLE_TARGET_METRICS = Object.values(VehicleTargetMetric);

/** The measure a target metric is compared with. */
export const TARGET_MEASURE: Record<VehicleTargetMetric, StatMeasure> = {
  CA_TTC: 'caTtc',
  POIDS_KG: 'weightT',
  NB_BL: 'nbBl',
  CLIENTS_ACTIFS: 'activeClients',
};

// ---------------------------------------------------------------- pure maths

const dec = (v: MoneyInput) => money(v);

/** `a / b`, null when the base is 0 (or negative: nothing to divide by). */
function divide(a: MoneyInput, b: MoneyInput): ReturnType<typeof money> | null {
  const base = dec(b);
  if (base.lte(0)) return null;
  return dec(a).div(base);
}

/** A rate in percent with 1 decimal (half-up); null when the base is 0. */
export function ratePercent(numerator: MoneyInput, base: MoneyInput): string | null {
  return divide(numerator, base)?.times(100).toFixed(1) ?? null;
}

/** Drop size: CA TTC / Nb BL, in dinars; null with 0 BL. */
export function dropSize(caTtc: MoneyInput, nbBl: MoneyInput): string | null {
  const v = divide(caTtc, nbBl);
  return v ? toMoneyString(v) : null;
}

/** SKU / BL: 2 decimals; null with 0 BL. */
export function skuPerBl(skuLines: MoneyInput, nbBl: MoneyInput): string | null {
  return divide(skuLines, nbBl)?.toFixed(2) ?? null;
}

/**
 * What one order line counts as delivered: never more than ordered, never less than 0
 * (an over-delivery cannot push the rate above 100 %).
 */
export function cappedDelivered(ordered: MoneyInput, delivered: MoneyInput | null): string {
  const o = dec(ordered);
  const d = delivered === null ? dec(0) : dec(delivered);
  const capped = d.gt(o) ? o : d.lt(0) ? dec(0) : d;
  return capped.toFixed(3);
}

/** Taux de livraison over lines `{ ordered, delivered }` (base units), capped per line. */
export function deliveryRate(
  lines: readonly { ordered: MoneyInput; delivered: MoneyInput | null }[],
): string | null {
  let ordered = dec(0);
  let delivered = dec(0);
  for (const l of lines) {
    ordered = ordered.plus(dec(l.ordered));
    delivered = delivered.plus(cappedDelivered(l.ordered, l.delivered));
  }
  return ratePercent(delivered, ordered);
}

/** Kilograms to tonnes, 3 decimals. */
export function kgToTonnes(kg: MoneyInput): string {
  return dec(kg).div(1000).toFixed(3);
}

/**
 * The weight of a line (kg): the weight frozen at validation, else quantity × the product's
 * current weight (an estimate), else unknown.
 */
export function lineWeightKg(line: {
  frozenKg: string | null;
  qtyBase: MoneyInput;
  productWeightKg: string | null;
}): { kg: string | null; estimated: boolean } {
  if (line.frozenKg !== null) return { kg: dec(line.frozenKg).toFixed(3), estimated: false };
  if (line.productWeightKg === null) return { kg: null, estimated: false };
  return { kg: dec(line.qtyBase).times(line.productWeightKg).toFixed(3), estimated: true };
}

/** The weight frozen on a line at validation: quantity × product weight, 3 decimals. */
export function frozenWeightKg(qtyBase: MoneyInput, productWeightKg: string | null): string | null {
  if (productWeightKg === null) return null;
  return dec(qtyBase).times(productWeightKg).toFixed(3);
}

/**
 * The weight of a part of a line (an avoir, a facture that keeps part of a BL line): the
 * same share of the frozen weight as of the quantity. null when the line has none.
 */
export function partWeightKg(
  lineWeightKg: string | null,
  lineQtyBase: MoneyInput,
  partQtyBase: MoneyInput,
): string | null {
  if (lineWeightKg === null) return null;
  const whole = dec(lineQtyBase);
  if (whole.isZero()) return null;
  return dec(lineWeightKg).times(dec(partQtyBase)).div(whole).toFixed(3);
}

/** Réalisation vs objectif in percent, 1 decimal; null without a positive target. */
export function achievementPercent(achieved: MoneyInput, target: MoneyInput): string | null {
  return ratePercent(achieved, target);
}

/** Change from `previous` to `current` in percent (1 decimal); null when previous ≤ 0. */
export function trendPercent(current: MoneyInput, previous: MoneyInput): string | null {
  const prev = dec(previous);
  if (prev.lte(0)) return null;
  return dec(current).minus(prev).div(prev).times(100).toFixed(1);
}

/**
 * The value of a ratio measure from its two components, in the measure's unit. The one
 * place a rate is computed, so the same figure is equal in every view.
 */
export function deriveRatio(
  measure: StatMeasure,
  numerator: MoneyInput,
  denominator: MoneyInput,
): string | null {
  const def = statMeasure(measure);
  const v = divide(numerator, denominator);
  if (!v) return null;
  switch (def.unit) {
    case StatUnit.PERCENT:
      return v.times(100).toFixed(1);
    case StatUnit.DA:
      return toMoneyString(v);
    default:
      return v.toFixed(2);
  }
}

// ---------------------------------------------------------------- periods

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (day: string) => ({
  y: Number(day.slice(0, 4)),
  m: Number(day.slice(5, 7)),
  d: Number(day.slice(8, 10)),
});
const lastOfMonth = (y: number, m: number) => `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;

/** True when the range is made of whole calendar months. */
export function isWholeMonths(range: DayRange): boolean {
  const a = ymd(range.from);
  const b = ymd(range.to);
  return a.d === 1 && b.d === daysInMonth(b.y, b.m);
}

function shiftMonths(y: number, m: number, by: number): { y: number; m: number } {
  const index = y * 12 + (m - 1) + by;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

/**
 * The period a range is compared with:
 * - `previous`: the same number of days just before; whole calendar months are compared
 *   with the same number of whole months before (October with September, not with
 *   31 August – 30 September);
 * - `lastYear`: the same dates one year earlier (29 February becomes 28 February).
 */
export function comparisonRange(range: DayRange, compare: StatCompare): DayRange | null {
  if (compare === 'none') return null;
  if (compare === 'previous') {
    if (!isWholeMonths(range)) return previousPeriod(range);
    const a = ymd(range.from);
    const b = ymd(range.to);
    const months = b.y * 12 + b.m - (a.y * 12 + a.m) + 1;
    const from = shiftMonths(a.y, a.m, -months);
    const to = shiftMonths(b.y, b.m, -months);
    return { from: `${from.y}-${pad(from.m)}-01`, to: lastOfMonth(to.y, to.m) };
  }
  const back = (day: string): string => {
    const { y, m, d } = ymd(day);
    return `${y - 1}-${pad(m)}-${pad(Math.min(d, daysInMonth(y - 1, m)))}`;
  };
  // A whole February keeps being a whole February (28 ↔ 29 days).
  if (isWholeMonths(range)) {
    const a = ymd(range.from);
    const b = ymd(range.to);
    return { from: `${a.y - 1}-${pad(a.m)}-01`, to: lastOfMonth(b.y - 1, b.m) };
  }
  return { from: back(range.from), to: back(range.to) };
}

/** The first day of the bucket an Algiers day falls in. Weeks start on Sunday. */
export function bucketStart(day: string, groupBy: StatGroupBy): string {
  if (groupBy === 'day') return day;
  if (groupBy === 'week') return addDays(day, -weekdayOf(day));
  return `${day.slice(0, 7)}-01`;
}

export interface StatBucket extends DayRange {
  /** The bucket's key: its first calendar day (a week's Sunday, a month's 1st). */
  bucket: string;
}

/**
 * Every bucket of a range, in order, empty ones included; the first and last are clipped
 * to the range.
 */
export function statBuckets(range: DayRange, groupBy: StatGroupBy): StatBucket[] {
  const out: StatBucket[] = [];
  let cursor = range.from;
  while (cursor <= range.to) {
    const start = bucketStart(cursor, groupBy);
    let end: string;
    if (groupBy === 'day') end = start;
    else if (groupBy === 'week') end = addDays(start, 6);
    else {
      const { y, m } = ymd(start);
      end = lastOfMonth(y, m);
    }
    out.push({ bucket: start, from: cursor, to: end > range.to ? range.to : end });
    cursor = addDays(end, 1);
  }
  return out;
}

/** The first day of the month of an Algiers day. */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** The whole month a day belongs to. */
export function monthRange(day: string): DayRange {
  const { y, m } = ymd(day);
  return { from: `${y}-${pad(m)}-01`, to: lastOfMonth(y, m) };
}

/** The first day of the month before `periodStart`. */
export function previousMonthStart(periodStart: string): string {
  const { y, m } = ymd(periodStart);
  const p = shiftMonths(y, m, -1);
  return `${p.y}-${pad(p.m)}-01`;
}
