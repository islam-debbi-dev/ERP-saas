import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  type DayRange,
  deriveRatio,
  kgToTonnes,
  money,
  STAT_FILTER_KEYS,
  STAT_MEASURES,
  type StatCell,
  type StatFilterKey,
  type StatFilters,
  type StatMeasure,
  type StatMeasureDef,
  type StatNotApplicable,
  StatUnit,
  toMoneyString,
} from '@erp/shared';
import { algiersRange } from '../common/algiers';
import { businessUnit } from '../common/business-unit-sql';
import { tenantContext } from '../common/tenant-context';
import { ClockService } from '../clock/clock.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VehiclesService } from '../stock/vehicles.service';
import { communeCodesOfDairas, DAIRA_OF_COMMUNE, wilayaCodesOf } from './client-places';
import {
  type DimensionNeed,
  DIMENSIONS,
  type EngineDimension,
  factCarries,
  type FactCtx,
  type FactKey,
  FACTS,
  MEASURE_SOURCES,
  type MeasureSource,
} from './registry';

/** The dépôts and trucks whose figures a user sees; null = all of them. */
export interface StatsReach {
  warehouseIds: string[] | null;
  /** A row without a dépôt counts as this one's (the dépôt principal). */
  defaultWarehouseId: string | null;
  /** A chef de zone's area (phase 40b): what a location filter may name. */
  clientCommuneCodes?: number[];
}

export interface StatsRunInput {
  range: DayRange;
  measures: readonly StatMeasure[];
  /** Grouping sets: `[]` is the ungrouped total, `['vehicle']` one row per truck… */
  sets: readonly (readonly EngineDimension[])[];
  filters: StatFilters;
  reach: StatsReach;
  /** Cost values are only sent to a user with REPORTS_FINANCE. */
  finance: boolean;
}

/** One group of one grouping set: its keys (in the set's order) and its figures. */
export interface StatsRow {
  keys: (string | null)[];
  cells: StatCell[];
}

export interface StatsRunResult {
  /** One list of rows per grouping set asked, in the same order. */
  sets: StatsRow[][];
  /** The cells of a group where nothing happened (a truck without a sale in the period). */
  blank: StatCell[];
  notApplicable: StatNotApplicable;
}

interface RawRow {
  fact: string;
  g: number;
  v: Record<string, string | null>;
  [dim: string]: unknown;
}

/** Facts of one run read at the same time. */
const FACTS_AT_ONCE = 3;

/** Which kind of join each filter needs on a fact. */
const FILTER_NEED: Record<StatFilterKey, DimensionNeed> = {
  warehouseIds: 'vehicle',
  vehicleIds: 'vehicle',
  vehicleTypeIds: 'vehicle',
  activities: 'vehicle',
  vehicleWilayas: 'vehicle',
  clientWilayas: 'client',
  clientDairas: 'client',
  clientCommunes: 'client',
  segmentIds: 'client',
  sectorIds: 'client',
  clientIds: 'client',
  brandIds: 'product',
  categoryIds: 'product',
  productIds: 'product',
};

/** The filters of a query that carry at least one value. */
export function activeFilters(filters: StatFilters): StatFilterKey[] {
  return STAT_FILTER_KEYS.filter((k) => (filters[k]?.length ?? 0) > 0);
}

/** The measures a ratio is made of, or the measure itself. */
export function components(measure: StatMeasure): StatMeasure[] {
  const def: StatMeasureDef = STAT_MEASURES[measure];
  return def.of ? (def.of as unknown as StatMeasure[]) : [measure];
}

/**
 * The first alternative of a measure whose facts can all carry every dimension and filter
 * of the question (its contributions are then added up); null when none can.
 */
export function pickSource(
  measure: StatMeasure,
  needs: readonly DimensionNeed[],
): readonly MeasureSource[] | null {
  const alternatives = MEASURE_SOURCES[measure] ?? [];
  return (
    alternatives.find((parts) => parts.every((s) => needs.every((n) => factCarries(s.fact, n)))) ??
    null
  );
}

/** Prints an aggregate in the measure's unit. */
function format(measure: StatMeasure, raw: string): string {
  switch (STAT_MEASURES[measure].unit) {
    case StatUnit.DA:
      return toMoneyString(raw);
    case StatUnit.TONNE:
      return kgToTonnes(raw, 6);
    case StatUnit.QTY:
      return money(raw).toFixed(3);
    case StatUnit.COUNT:
      return money(raw).toFixed(0);
    default:
      return money(raw).toFixed(2);
  }
}

/**
 * The engine of the distribution statistics: measures + dimensions + filters in, one SQL
 * statement out. Each base fact is one CTE where the tenant, the user's reach and the
 * filters are applied once; each is then aggregated on the dimension keys with GROUPING
 * SETS, and the aggregates of different facts meet on those keys here, after aggregation
 * (never row × row, which would double count). Read only.
 */
@Injectable()
export class StatsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicles: VehiclesService,
    private readonly clock: ClockService,
  ) {}

  /**
   * Whether the measure can follow these dimensions and filters at all. Used by the
   * endpoints to refuse a filter none of their figures can apply.
   */
  canApply(
    measure: StatMeasure,
    dims: readonly EngineDimension[],
    filters: readonly StatFilterKey[],
  ): boolean {
    const needs = [...dims.map((d) => DIMENSIONS[d].needs), ...filters.map((f) => FILTER_NEED[f])];
    return components(measure).every((m) => pickSource(m, needs) !== null);
  }

  async run(input: StatsRunInput): Promise<StatsRunResult> {
    const tenantId = tenantContext.requireTenantId();
    const filters = activeFilters(input.filters);
    const dims = [...new Set(input.sets.flat())];
    const dimNeeds = dims.map((d) => DIMENSIONS[d].needs);
    const needs = [...dimNeeds, ...filters.map((f) => FILTER_NEED[f])];

    // Which fact serves each base measure; a measure nothing can serve stays null.
    const base = [...new Set(input.measures.flatMap(components))];
    const byFact: ByFact = new Map();
    const unserved = new Set<StatMeasure>();
    const notApplicable: StatNotApplicable = {};
    for (const measure of base) {
      const sources = pickSource(measure, needs);
      if (sources) {
        for (const source of sources) {
          byFact.set(source.fact, [...(byFact.get(source.fact) ?? []), { measure, source }]);
        }
        continue;
      }
      unserved.add(measure);
      // The dimensions alone are fine: a filter is what this figure cannot follow.
      if (pickSource(measure, dimNeeds)) {
        notApplicable[measure] = filters.filter(
          (f) => !pickSource(measure, [...dimNeeds, FILTER_NEED[f]]),
        );
      }
    }
    for (const measure of input.measures) {
      const parts = components(measure);
      if (parts.length > 1 && parts.some((p) => unserved.has(p))) {
        unserved.add(measure);
        const blocking = [...new Set(parts.flatMap((p) => notApplicable[p] ?? []))];
        if (blocking.length > 0) notApplicable[measure] = blocking;
      }
    }

    const sets = input.sets.map((s) => [...s]);
    const empty: StatsRunResult = {
      sets: sets.map(() => []),
      blank: input.measures.map((m) => this.cell(m, {}, unserved, input.finance)),
      notApplicable,
    };
    const raw = byFact.size
      ? await this.query(tenantId, input, dims, byFact, await this.categoryIds(input.filters))
      : [];

    // Merge the facts on the keys of each grouping set.
    const n = dims.length;
    const maskOf = (set: readonly EngineDimension[]) =>
      dims.reduce((mask, d, i) => (set.includes(d) ? mask : mask | (1 << (n - 1 - i))), 0);
    const masks = sets.map(maskOf);
    const merged = sets.map(() => new Map<string, { keys: (string | null)[]; v: Values }>());
    for (const row of raw) {
      masks.forEach((mask, index) => {
        if (mask !== row.g) return;
        const keys = sets[index]!.map((d) => (row[`d${dims.indexOf(d)}`] as string | null) ?? null);
        const id = JSON.stringify(keys);
        const group = merged[index]!;
        const entry = group.get(id) ?? { keys, v: {} };
        // Facts meet here, after aggregation: the parts of a measure are added up.
        for (const [key, raw] of Object.entries(row.v)) {
          const had = entry.v[key];
          if (raw === null) continue;
          if (key.endsWith('~est'))
            entry.v[key] = had === 'true' || raw === 'true' ? 'true' : 'false';
          else entry.v[key] = had == null ? raw : money(had).plus(raw).toString();
        }
        group.set(id, entry);
      });
    }
    // The ungrouped total exists even when nothing happened.
    sets.forEach((set, index) => {
      if (set.length === 0 && merged[index]!.size === 0) {
        merged[index]!.set('[]', { keys: [], v: {} });
      }
    });

    empty.sets = merged.map((group) =>
      [...group.values()].map(({ keys, v }) => ({
        keys,
        cells: input.measures.map((m) => this.cell(m, v, unserved, input.finance)),
      })),
    );
    return empty;
  }

  /** A family filter covers its sub-families. */
  private async categoryIds(filters: StatFilters): Promise<string[] | null> {
    const ids = filters.categoryIds;
    if (!ids || ids.length === 0) return null;
    const children = await this.prisma.db.category.findMany({
      where: { parentId: { in: ids } },
      select: { id: true },
    });
    return [...new Set([...ids, ...children.map((c) => c.id)])];
  }

  private cell(
    measure: StatMeasure,
    v: Values,
    unserved: ReadonlySet<StatMeasure>,
    finance: boolean,
  ): StatCell {
    const def: StatMeasureDef = STAT_MEASURES[measure];
    const parts = components(measure);
    const estimated = parts.some((p) => v[`${p}~est`] === 'true');
    const cell = (value: string | null): StatCell => ({
      measure,
      unit: def.unit,
      value,
      estimated: value !== null && estimated,
    });
    if (unserved.has(measure) || (def.finance && !finance)) return cell(null);
    if (def.of) {
      const [a, b] = parts as [StatMeasure, StatMeasure];
      return cell(deriveRatio(measure, v[a] ?? '0', v[b] ?? '0'));
    }
    return cell(format(measure, v[measure] ?? '0'));
  }

  private async query(
    tenantId: string,
    input: StatsRunInput,
    dims: EngineDimension[],
    byFact: ByFact,
    categoryIds: string[] | null,
  ): Promise<RawRow[]> {
    // One statement per fact, a few at a time: each keeps its own (parallel) plan and the
    // facts of a run are read side by side, without taking the whole connection pool.
    const pending = this.statements(tenantId, input, dims, byFact, categoryIds);
    const rows: RawRow[] = [];
    const worker = async (): Promise<void> => {
      for (let sql = pending.shift(); sql; sql = pending.shift()) {
        rows.push(...(await this.prisma.db.$queryRaw<RawRow[]>(sql)));
      }
    };
    await Promise.all(Array.from({ length: FACTS_AT_ONCE }, worker));
    return rows;
  }

  /**
   * The SQL of a run, one statement per fact: the fact as a CTE, then its aggregates.
   * - Sums are aggregated in two levels: a plain GROUP BY on every dimension of the run
   *   (PostgreSQL runs it in parallel, which it cannot do with GROUPING SETS), then the
   *   few groups it gives are rolled up to each grouping set.
   * - Distinct counts cannot be rolled up: they are computed per grouping set directly.
   */
  statements(
    tenantId: string,
    input: StatsRunInput,
    dims: EngineDimension[],
    byFact: ByFact,
    categoryIds: string[] | null,
  ): Prisma.Sql[] {
    const { start, end } = algiersRange(input.range.from, input.range.to);
    const ctx: FactCtx = {
      tenantId,
      start,
      end,
      from: input.range.from,
      to: input.range.to,
      today: algiersDay(this.clock.now()),
      vehicleOfPayment: this.vehicles.vehicleOfPayment('py'),
    };
    const need = (kind: DimensionNeed) =>
      dims.some((d) => DIMENSIONS[d].needs === kind) ||
      activeFilters(input.filters).some((f) => FILTER_NEED[f] === kind);
    const joins = {
      client: need('client'),
      product: need('product'),
      daira: dims.includes('clientDaira'),
    };

    const names = dims.map((_, i) => Prisma.raw(`d${i}`));
    const keys = dims.map((d, i) => Prisma.sql`${DIMENSIONS[d].key} AS ${names[i]!}`);
    const keyed = (name: Prisma.Sql) =>
      Prisma.sql`(SELECT f.*${keys.length ? Prisma.sql`, ${Prisma.join(keys)}` : Prisma.empty}
                 FROM ${name} f) f`;
    const grouping = names.length
      ? Prisma.sql`GROUPING(${Prisma.join(names)})::int`
      : Prisma.sql`0`;
    const groupingSets = names.length
      ? Prisma.sql`GROUP BY GROUPING SETS (${Prisma.join(
          input.sets.map((set) =>
            set.length
              ? Prisma.sql`(${Prisma.join(set.map((d) => Prisma.raw(`d${dims.indexOf(d)}`)))})`
              : Prisma.sql`()`,
          ),
        )})`
      : Prisma.empty;
    const head = (fact: FactKey) => Prisma.sql`
      SELECT ${fact}::text AS fact, ${grouping} AS g
        ${names.length ? Prisma.sql`, ${Prisma.join(names)}` : Prisma.empty}`;

    const out: Prisma.Sql[] = [];
    for (const [fact, measures] of byFact) {
      const name = Prisma.raw(`"fact_${fact}"`);
      const selects: Prisma.Sql[] = [];
      // Inlined (NOT MATERIALIZED): each use is planned as a scan of its own.
      const cte = Prisma.sql`${name} AS NOT MATERIALIZED (
        ${this.frame(fact, ctx, joins, input, categoryIds)})`;
      const sums = measures.filter((m) => m.source.kind === 'sum');
      const distincts = measures.filter((m) => m.source.kind === 'distinct');
      if (sums.length > 0) {
        const inner = sums.flatMap(({ source }, i) => [
          Prisma.sql`${source.expr} AS ${Prisma.raw(`m${i}`)}`,
          ...(source.estimated ? [Prisma.sql`${source.estimated} AS ${Prisma.raw(`e${i}`)}`] : []),
        ]);
        const outer = sums.flatMap(({ measure, source }, i) => [
          Prisma.sql`${measure}::text, COALESCE(SUM(a.${Prisma.raw(`m${i}`)}), 0)::text`,
          ...(source.estimated
            ? [
                Prisma.sql`${`${measure}~est`}::text,
                  COALESCE(bool_or(a.${Prisma.raw(`e${i}`)}), FALSE)::text`,
              ]
            : []),
        ]);
        selects.push(Prisma.sql`${head(fact)}, jsonb_build_object(${Prisma.join(outer)}) AS v
          FROM (
            SELECT ${names.length ? Prisma.sql`${Prisma.join(names)}, ` : Prisma.empty}
                   ${Prisma.join(inner)}
            FROM ${keyed(name)}
            ${names.length ? Prisma.sql`GROUP BY ${Prisma.join(names)}` : Prisma.empty}
          ) a
          ${groupingSets}`);
      }
      if (distincts.length > 0) {
        const values = distincts.map(
          ({ measure, source }) => Prisma.sql`${measure}::text, (${source.expr})::text`,
        );
        selects.push(Prisma.sql`${head(fact)}, jsonb_build_object(${Prisma.join(values)}) AS v
          FROM ${keyed(name)}
          ${groupingSets}`);
      }
      out.push(Prisma.sql`WITH ${cte} ${Prisma.join(selects, ' UNION ALL ')}`);
    }
    return out;
  }

  /**
   * One fact as a CTE: its rows, the truck / dépôt / client / product columns the
   * dimensions read, and — applied here, once — the user's reach and the filters.
   */
  private frame(
    fact: FactKey,
    ctx: FactCtx,
    joins: { client: boolean; product: boolean; daira: boolean },
    input: StatsRunInput,
    categoryIds: string[] | null,
  ): Prisma.Sql {
    const def = FACTS[fact];
    const { reach, filters } = input;
    const unit = businessUnit('r.wh', reach.defaultWarehouseId, 'w');
    const withClient = joins.client && def.has.client;
    const withProduct = joins.product && def.has.product;
    const withDaira = withClient && joins.daira;
    const truck = Prisma.sql`w.type = 'VEHICLE'`;

    const where: Prisma.Sql[] = [];
    if (reach.warehouseIds) {
      const ids = reach.warehouseIds;
      where.push(
        reach.defaultWarehouseId && ids.includes(reach.defaultWarehouseId)
          ? Prisma.sql`(r.wh IS NULL OR r.wh = ANY(${ids}::uuid[]))`
          : Prisma.sql`r.wh = ANY(${ids}::uuid[])`,
      );
    }
    const any = <T>(list: T[] | undefined, sql: (values: T[]) => Prisma.Sql) => {
      if (list && list.length > 0) where.push(sql(list));
    };
    any(filters.warehouseIds, (v) => Prisma.sql`${unit.unit} = ANY(${v}::uuid[])`);
    any(filters.vehicleIds, (v) => Prisma.sql`(${truck} AND w.id = ANY(${v}::uuid[]))`);
    any(
      filters.vehicleTypeIds,
      (v) => Prisma.sql`(${truck} AND w."vehicleTypeId" = ANY(${v}::uuid[]))`,
    );
    any(
      filters.activities,
      (v) => Prisma.sql`(${truck} AND vt.activity::text = ANY(${v}::text[]))`,
    );
    any(
      filters.vehicleWilayas,
      (v) => Prisma.sql`(${truck} AND w."wilayaCode" = ANY(${v}::int[]))`,
    );
    if (withClient) {
      any(filters.clientIds, (v) => Prisma.sql`r."clientId" = ANY(${v}::uuid[])`);
      any(filters.segmentIds, (v) => Prisma.sql`c."segmentId" = ANY(${v}::uuid[])`);
      any(filters.sectorIds, (v) => Prisma.sql`c."sectorId" = ANY(${v}::uuid[])`);
      any(
        filters.clientWilayas,
        (v) => Prisma.sql`c."wilayaCode" = ANY(${wilayaCodesOf(v)}::int[])`,
      );
      any(
        filters.clientDairas,
        (v) => Prisma.sql`c."communeCode" = ANY(${communeCodesOfDairas(v)}::int[])`,
      );
      any(filters.clientCommunes, (v) => Prisma.sql`c."communeCode" = ANY(${v}::int[])`);
      const byPlace = [filters.clientWilayas, filters.clientDairas, filters.clientCommunes];
      if (reach.clientCommuneCodes && byPlace.some((v) => v && v.length > 0)) {
        where.push(Prisma.sql`c."communeCode" = ANY(${reach.clientCommuneCodes}::int[])`);
      }
    }
    if (withProduct) {
      any(filters.productIds, (v) => Prisma.sql`r."productId" = ANY(${v}::uuid[])`);
      any(filters.brandIds, (v) => Prisma.sql`p."brandId" = ANY(${v}::uuid[])`);
      if (categoryIds) where.push(Prisma.sql`p."categoryId" = ANY(${categoryIds}::uuid[])`);
    }

    return Prisma.sql`
      SELECT r.*,
        CASE WHEN ${truck} THEN w.id END AS "vehicleId",
        ${unit.unit} AS "depotId",
        CASE WHEN ${truck} THEN w."vehicleTypeId" END AS "vehicleTypeId",
        CASE WHEN ${truck} THEN vt.activity::text END AS activity,
        CASE WHEN ${truck} THEN w."wilayaCode" END AS "vehicleWilaya"
        ${
          withClient
            ? Prisma.sql`, c."wilayaCode" AS "clientWilaya", c."communeCode" AS "clientCommune",
                c."segmentId", c."sectorId"`
            : Prisma.empty
        }
        ${withDaira ? Prisma.sql`, dm.key AS "clientDaira"` : Prisma.empty}
        ${
          withProduct
            ? Prisma.sql`, p."brandId", COALESCE(cat."parentId", cat.id) AS "familyId",
                CASE WHEN cat."parentId" IS NOT NULL THEN cat.id END AS "subCategoryId"`
            : Prisma.empty
        }
      FROM (${def.rows(ctx)}) r
      ${unit.join}
      LEFT JOIN vehicle_types vt ON vt.id = w."vehicleTypeId"
      ${withClient ? Prisma.sql`LEFT JOIN clients c ON c.id = r."clientId"` : Prisma.empty}
      ${
        withDaira
          ? Prisma.sql`LEFT JOIN unnest(${DAIRA_OF_COMMUNE.codes}::int[],
              ${DAIRA_OF_COMMUNE.keys}::text[]) AS dm(code, key) ON dm.code = c."communeCode"`
          : Prisma.empty
      }
      ${
        withProduct
          ? Prisma.sql`LEFT JOIN products p ON p.id = r."productId"
              LEFT JOIN categories cat ON cat.id = p."categoryId"`
          : Prisma.empty
      }
      ${where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty}`;
  }
}

type Values = Record<string, string | null>;
type ByFact = Map<FactKey, { measure: StatMeasure; source: MeasureSource }[]>;
