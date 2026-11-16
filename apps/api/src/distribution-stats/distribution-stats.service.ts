import { Injectable } from '@nestjs/common';
import {
  achievementPercent,
  deriveRatio,
  addDays,
  algiersDay,
  comparisonRange,
  type DayRange,
  type DistributionStatsQuery,
  ErrorCode,
  money,
  monthRange,
  monthStart,
  NO_SALE_REASONS,
  type NoSaleReason,
  Permission,
  STAT_MAX_SPLIT,
  STAT_MEASURES,
  STAT_TOP_ROWS,
  type StatBucket,
  statBuckets,
  type StatCell,
  type StatDimension,
  type StatDimensionRowDto,
  type StatDocumentRef,
  type StatFilterKey,
  type StatFilters,
  type StatGroupBy,
  type StatMeasure,
  type StatMeasureDef,
  type StatObjectiveDto,
  type StatsByDimensionDto,
  type StatsByDimensionQuery,
  type StatsByVehicleDto,
  type StatsDispersionDto,
  type StatsLostClientsDto,
  type StatsMetaDto,
  type StatsMyVehicleDto,
  type StatsOverviewDto,
  type StatsTimelineDto,
  type StatsTimelineQuery,
  type StatsVehicleDayDto,
  type StatsVehicleDayQuery,
  type StatsVisitsDto,
  type StatTileDto,
  StatUnit,
  type StatVehicleRef,
  type StatVehicleRowDto,
  TARGET_MEASURE,
  VEHICLE_TARGET_METRICS,
  toMoneyString,
  trendPercent,
  type VehicleActivity,
  type VehicleTargetMetric,
  WarehouseType,
} from '@erp/shared';
import { type CurrentUserInfo } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { ClockService } from '../clock/clock.service';
import { algiersRange } from '../common/algiers';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { fromIsoDate } from '../sales/sale.mapper';
import { VehiclesService } from '../stock/vehicles.service';
import { type EngineDimension, type FactCtx, vehicleOfSql } from './registry';
import { dimensionLink, measureLink, salesLink } from './stats-links';
import {
  activeFilters,
  components,
  type StatsReach,
  type StatsRow,
  StatsQueryService,
  type StatsRunResult,
} from './stats-query.service';
import { StatsScopeService } from './stats-scope.service';

/** The KPI tiles of the "Vue globale". */
export const OVERVIEW_MEASURES: readonly StatMeasure[] = [
  'caTtc',
  'nbBl',
  'dropSize',
  'skuPerBl',
  'weightT',
  'activeClients',
  'versements',
  'recouvrement',
  'bcCount',
  'bcTtc',
  'deliveryRate',
  'openOrders',
  'activeVehicles',
];

/** Every figure of a truck (and of a row of a "by dimension" table). */
export const ROW_MEASURES: readonly StatMeasure[] = [
  'caTtc',
  'nbBl',
  'dropSize',
  'skuPerBl',
  'weightT',
  'weightUnknownLines',
  'activeClients',
  'versements',
  'recouvrement',
  'bcCount',
  'bcTtc',
  'deliveryRate',
  'openOrders',
  'loadCount',
  'loadValueCost',
  'loadValueTtc',
  'loadWeightT',
  'fillRate',
  'damagedQty',
  'damagedTtc',
  'cashEcart',
  'visitsPlanned',
  'visitsDone',
  'visitsSuccess',
  'visitRate',
  'successPlannedRate',
  'successRate',
];

export const VISIT_MEASURES: readonly StatMeasure[] = [
  'visitsPlanned',
  'plannedVisited',
  'plannedSuccess',
  'visitsDone',
  'visitsSuccess',
  'visitsNoSale',
  'visitRate',
  'successPlannedRate',
  'successRate',
];

const DAY_MEASURES: readonly StatMeasure[] = [
  'loadCount',
  'loadValueCost',
  'loadValueTtc',
  'loadWeightT',
  'fillRate',
  'caTtc',
  'nbBl',
  'weightT',
  'weightUnknownLines',
  'damagedQty',
  'damagedTtc',
  'versements',
  'cashEcart',
  'visitsPlanned',
  'visitsDone',
  'visitsSuccess',
];

const MY_VEHICLE_MEASURES: readonly StatMeasure[] = [
  'caTtc',
  'nbBl',
  'versements',
  'visitsDone',
  'visitsPlanned',
];

const cellOf = (cells: StatCell[], measure: StatMeasure) =>
  cells.find((c) => c.measure === measure);
const num = (cells: StatCell[], measure: StatMeasure) =>
  money(cellOf(cells, measure)?.value ?? '0');

const VEHICLE_SELECT = {
  id: true,
  code: true,
  name: true,
  wilayaCode: true,
  capacityKg: true,
  vehicleType: { select: { id: true, code: true, name: true, activity: true } },
  parent: { select: { id: true, name: true } },
} as const;

/**
 * The distribution statistics (phase 37). Each method picks measures, dimensions and
 * filters and calls `StatsQueryService.run()`; it adds names, drivers, targets and the
 * links to the lists behind the figures. Reads only.
 */
@Injectable()
export class DistributionStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: StatsQueryService,
    private readonly scopes: StatsScopeService,
    private readonly vehicles: VehiclesService,
    private readonly clock: ClockService,
  ) {}

  // ---------------------------------------------------------------- overview

  async overview(query: DistributionStatsQuery, user: CurrentUserInfo): Promise<StatsOverviewDto> {
    const reach = await this.scopes.reach(user);
    const finance = can(user, Permission.REPORTS_FINANCE);
    const range: DayRange = { from: query.from, to: query.to };
    this.assertFilters(OVERVIEW_MEASURES, [], query);
    const measures: StatMeasure[] = [...OVERVIEW_MEASURES, 'weightUnknownLines'];
    const compare = comparisonRange(range, query.compare);
    const eve = addDays(query.to, -1);
    const [current, previous, dayBefore] = await Promise.all([
      this.engine.run({
        range,
        measures,
        sets: [[], [query.groupBy]],
        filters: query,
        reach,
        finance,
      }),
      compare
        ? this.engine.run({ range: compare, measures, sets: [[]], filters: query, reach, finance })
        : null,
      this.engine.run({
        range: { from: eve, to: eve },
        measures: ['bcCount', 'bcTtc'],
        sets: [[]],
        filters: query,
        reach,
        finance,
      }),
    ]);
    const totals = current.sets[0]![0]!.cells;
    const before = previous?.sets[0]![0]!.cells ?? null;
    const buckets = statBuckets(range, query.groupBy);
    const perBucket = new Map(current.sets[1]!.map((r) => [r.keys[0], r.cells]));
    const tiles: StatTileDto[] = OVERVIEW_MEASURES.map((measure) => {
      const cell = cellOf(totals, measure)!;
      const def: StatMeasureDef = STAT_MEASURES[measure];
      const prev = before ? (cellOf(before, measure)?.value ?? null) : null;
      const changePct =
        cell.value !== null && prev !== null ? trendPercent(cell.value, prev) : null;
      return {
        ...cell,
        previous: prev,
        changePct,
        trend:
          changePct === null
            ? null
            : money(changePct).gt(0)
              ? 'up'
              : money(changePct).lt(0)
                ? 'down'
                : 'flat',
        // A sum can be drawn bucket by bucket; a distinct count or a rate cannot be summed.
        spark:
          def.additivity === 'sum' && cell.value !== null
            ? buckets.map((b) => ({
                bucket: b.bucket,
                value: cellOf(perBucket.get(b.bucket) ?? current.blank, measure)?.value ?? '0',
              }))
            : null,
        link: measureLink(measure, range, query),
      };
    });
    const j1 = dayBefore.sets[0]![0]!.cells;
    return {
      ...this.meta(query, current, finance, totals),
      tiles,
      bcPreviousDay: { day: eve, count: cellOf(j1, 'bcCount')!, ttc: cellOf(j1, 'bcTtc')! },
    };
  }

  // ---------------------------------------------------------------- by vehicle

  async byVehicle(
    query: DistributionStatsQuery,
    user: CurrentUserInfo,
  ): Promise<StatsByVehicleDto> {
    const reach = await this.scopes.reach(user);
    const finance = can(user, Permission.REPORTS_FINANCE);
    const range: DayRange = { from: query.from, to: query.to };
    this.assertFilters(ROW_MEASURES, ['vehicle'], query);
    const result = await this.engine.run({
      range,
      measures: ROW_MEASURES,
      sets: [[], ['vehicle']],
      filters: query,
      reach,
      finance,
    });
    const totals = result.sets[0]![0]!.cells;
    const byKey = new Map(result.sets[1]!.map((r) => [r.keys[0] ?? null, r.cells]));
    const listed = await this.listedVehicles(reach, query, [...byKey.keys()]);
    const { start, end } = algiersRange(query.from, query.to);
    const drivers = await this.vehicles.driversDuring(
      listed.map((v) => v.id),
      start,
      end,
    );
    const objectives = await this.objectives(
      range,
      listed.map((v) => v.id),
      reach,
      result.sets[1]!,
    );
    const rows: StatVehicleRowDto[] = listed.map((vehicle) => ({
      vehicle,
      drivers: (drivers.get(vehicle.id) ?? []).map((d) => ({
        id: d.id,
        fullName: d.fullName,
        fromAt: d.fromAt.toISOString(),
      })),
      cells: byKey.get(vehicle.id) ?? result.blank,
      objectives: objectives.get(vehicle.id) ?? [],
      link: salesLink(range, { warehouseId: vehicle.id }),
    }));
    const none = byKey.get(null);
    if (none) {
      rows.push({ vehicle: null, drivers: [], cells: none, objectives: [], link: null });
    }
    return { ...this.meta(query, result, finance, totals), rows, totals };
  }

  /**
   * The trucks of a "by vehicle" table: the live trucks in reach that pass the truck
   * filters (a truck without a sale is a row of zeros, not a missing row), plus any truck
   * with figures in the period (an archived one keeps its history).
   */
  private async listedVehicles(
    reach: StatsReach,
    filters: StatFilters,
    withFigures: (string | null)[],
  ): Promise<StatVehicleRef[]> {
    const ids = withFigures.filter((k): k is string => k !== null);
    const narrowed = activeFilters(filters).some((f) =>
      (
        [
          'clientWilayas',
          'segmentIds',
          'sectorIds',
          'clientIds',
          'brandIds',
          'categoryIds',
          'productIds',
        ] as StatFilterKey[]
      ).includes(f),
    );
    const live: Prisma.WarehouseWhereInput = {
      deletedAt: null,
      active: true,
      ...(reach.warehouseIds ? { id: { in: reach.warehouseIds } } : {}),
      ...(filters.vehicleIds?.length ? { AND: [{ id: { in: filters.vehicleIds } }] } : {}),
      ...(filters.vehicleTypeIds?.length ? { vehicleTypeId: { in: filters.vehicleTypeIds } } : {}),
      ...(filters.vehicleWilayas?.length ? { wilayaCode: { in: filters.vehicleWilayas } } : {}),
      ...(filters.activities?.length
        ? { vehicleType: { activity: { in: filters.activities } } }
        : {}),
      ...(filters.warehouseIds?.length ? { parentWarehouseId: { in: filters.warehouseIds } } : {}),
    };
    const rows = await this.prisma.db.warehouse.findMany({
      where: {
        type: WarehouseType.VEHICLE,
        // A client or product filter shows the trucks it concerns, not every truck at 0.
        OR: narrowed ? [{ id: { in: ids } }] : [{ id: { in: ids } }, live],
      },
      select: VEHICLE_SELECT,
      orderBy: [{ code: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toVehicleRef);
  }

  /**
   * Réalisation vs objectif: the targets of the month the period ends in (when the period
   * stays inside one month), against that whole month's figures.
   */
  private async objectives(
    range: DayRange,
    vehicleIds: string[],
    reach: StatsReach,
    periodRows: StatsRow[],
  ): Promise<Map<string, StatObjectiveDto[]>> {
    const out = new Map<string, StatObjectiveDto[]>();
    if (vehicleIds.length === 0 || monthStart(range.from) !== monthStart(range.to)) return out;
    const periodStart = monthStart(range.to);
    const targets = await this.prisma.db.vehicleTarget.findMany({
      where: { vehicleId: { in: vehicleIds }, periodStart: fromIsoDate(periodStart) },
      select: { vehicleId: true, metric: true, targetValue: true },
    });
    if (targets.length === 0) return out;
    // One fixed order (the metrics as listed in the shared definitions), whatever the DB returns.
    targets.sort(
      (a, b) => VEHICLE_TARGET_METRICS.indexOf(a.metric) - VEHICLE_TARGET_METRICS.indexOf(b.metric),
    );
    const month = monthRange(range.to);
    const whole = month.from === range.from && month.to === range.to;
    const rows = whole
      ? periodRows
      : (
          await this.engine.run({
            range: month,
            measures: Object.values(TARGET_MEASURE),
            sets: [['vehicle']],
            // The month's figure of the truck, whatever the screen is filtered on.
            filters: { vehicleIds: [...new Set(targets.map((t) => t.vehicleId))] },
            reach,
            finance: false,
          })
        ).sets[0]!;
    const byVehicle = new Map(rows.map((r) => [r.keys[0], r.cells]));
    for (const t of targets) {
      const metric = t.metric;
      const cell = cellOf(byVehicle.get(t.vehicleId) ?? [], TARGET_MEASURE[metric]);
      const achieved = achievedValue(metric, cell?.value ?? '0');
      const target = t.targetValue.toString();
      const list = out.get(t.vehicleId) ?? [];
      list.push({
        metric,
        periodStart,
        target: money(target).toFixed(metric === 'CA_TTC' ? 2 : metric === 'POIDS_KG' ? 3 : 0),
        achieved,
        pct: achievementPercent(achieved, target),
      });
      out.set(t.vehicleId, list);
    }
    return out;
  }

  // ---------------------------------------------------------------- by dimension

  async byDimension(
    query: StatsByDimensionQuery,
    user: CurrentUserInfo,
  ): Promise<StatsByDimensionDto> {
    const reach = await this.scopes.reach(user);
    const finance = can(user, Permission.REPORTS_FINANCE);
    const range: DayRange = { from: query.from, to: query.to };
    const dimension = query.dimension;
    // The figures this dimension can carry (a versement has no brand).
    const measures = ROW_MEASURES.filter((m) => this.engine.canApply(m, [dimension], []));
    this.assertFilters(measures, [dimension], query);
    // The parts of each rate come along, to derive the rate of "Autres" again.
    const withParts = [...new Set([...measures, ...measures.flatMap(components)])];
    const shown = (cells: StatCell[]) => cells.filter((c) => measures.includes(c.measure));
    const result = await this.engine.run({
      range,
      measures: withParts,
      sets: [[], [dimension]],
      filters: query,
      reach,
      finance,
    });
    const totals = result.sets[0]![0]!.cells;
    const ranked = [...result.sets[1]!].sort((a, b) => {
      const diff = num(b.cells, 'caTtc').comparedTo(num(a.cells, 'caTtc'));
      return diff !== 0 ? diff : (a.keys[0] ?? '').localeCompare(b.keys[0] ?? '');
    });
    const top = ranked.slice(0, STAT_TOP_ROWS);
    const rest = ranked.slice(STAT_TOP_ROWS);
    const labels = await this.labels(
      dimension,
      top.map((r) => r.keys[0] ?? null),
    );
    const rows: StatDimensionRowDto[] = top.map((r) => {
      const key = r.keys[0] ?? null;
      return {
        key,
        label: key === null ? null : (labels.get(key) ?? null),
        cells: shown(r.cells),
        link: dimensionLink(dimension, key, range),
      };
    });
    return {
      ...this.meta(query, result, finance, totals),
      dimension,
      rows,
      others: rest.length
        ? { count: rest.length, cells: shown(foldOthers(withParts, totals, top, finance)) }
        : null,
      totals: shown(totals),
    };
  }

  /** The names of the values of a dimension; a key the web names itself has no label. */
  private async labels(
    dimension: StatDimension | 'vehicle',
    keys: (string | null)[],
  ): Promise<Map<string, string>> {
    const ids = keys.filter((k): k is string => k !== null);
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const db = this.prisma.db;
    const named = (rows: { id: string; name: string }[]) =>
      rows.forEach((r) => out.set(r.id, r.name));
    switch (dimension) {
      case 'vehicle':
      case 'depot': {
        const rows = await db.warehouse.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, code: true },
        });
        rows.forEach((r) => out.set(r.id, r.code ? `${r.code} · ${r.name}` : r.name));
        break;
      }
      case 'vehicleType': {
        const rows = await db.vehicleType.findMany({
          where: { id: { in: ids } },
          select: { id: true, code: true, name: true },
        });
        rows.forEach((r) => out.set(r.id, `${r.code} · ${r.name}`));
        break;
      }
      case 'segment':
        named(
          await db.clientSegment.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          }),
        );
        break;
      case 'sector':
        named(
          await db.sector.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          }),
        );
        break;
      case 'brand':
        named(
          await db.brand.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
        );
        break;
      case 'category':
      case 'subCategory':
        named(
          await db.category.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          }),
        );
        break;
      case 'product': {
        const rows = await db.product.findMany({
          where: { id: { in: ids } },
          select: { id: true, reference: true, designation: true },
        });
        rows.forEach((r) => out.set(r.id, `${r.reference} · ${r.designation}`));
        break;
      }
      case 'client':
        named(
          await db.client.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          }),
        );
        break;
      case 'clientWilaya': {
        // The key is the wilaya in lower case; print it as one client wrote it.
        const rows = await db.$queryRaw<{ key: string; label: string }[]>`
          SELECT lower(btrim(c.wilaya)) AS key, MIN(btrim(c.wilaya)) AS label
          FROM clients c
          WHERE c."tenantId" = ${tenantContext.requireTenantId()}::uuid
            AND lower(btrim(c.wilaya)) = ANY(${ids}::text[])
          GROUP BY 1`;
        rows.forEach((r) => out.set(r.key, r.label));
        break;
      }
      // activity and vehicleWilaya: the web translates the enum / names the wilaya number.
      default:
        break;
    }
    return out;
  }

  // ---------------------------------------------------------------- timeline

  async timeline(query: StatsTimelineQuery, user: CurrentUserInfo): Promise<StatsTimelineDto> {
    const reach = await this.scopes.reach(user);
    const finance = can(user, Permission.REPORTS_FINANCE);
    const range: DayRange = { from: query.from, to: query.to };
    const { measure, groupBy, splitBy } = query;
    const dims: EngineDimension[] = splitBy ? [groupBy, splitBy] : [groupBy];
    if (!this.engine.canApply(measure, splitBy ? [splitBy] : [], [])) {
      throw new AppException(
        ErrorCode.STATS_FILTER_NOT_APPLICABLE,
        'This figure cannot be split by this dimension',
        { measure, splitBy },
      );
    }
    this.assertFilters([measure], dims, query);
    const compare = comparisonRange(range, query.compare);
    const sets: EngineDimension[][] = splitBy
      ? [[], [groupBy], [splitBy], [groupBy, splitBy]]
      : [[], [groupBy]];
    const [current, previous] = await Promise.all([
      this.engine.run({ range, measures: [measure], sets, filters: query, reach, finance }),
      compare
        ? this.engine.run({
            range: compare,
            measures: [measure],
            sets: [[groupBy]],
            filters: query,
            reach,
            finance,
          })
        : null,
    ]);
    const buckets = statBuckets(range, groupBy);
    const value = (cells: StatCell[] | undefined) =>
      cellOf(cells ?? current.blank, measure) ?? current.blank[0]!;
    const perBucket = new Map(current.sets[1]!.map((r) => [r.keys[0], r.cells]));
    const before = compare ? statBuckets(compare, groupBy) : [];
    const perBefore = new Map((previous?.sets[0] ?? []).map((r) => [r.keys[0], r.cells]));

    let series: StatsTimelineDto['series'] = [];
    if (splitBy) {
      // The truck picker gives the series; otherwise the largest values of the dimension.
      const ranked = [...current.sets[2]!]
        .sort((a, b) => num(b.cells, measure).comparedTo(num(a.cells, measure)))
        .slice(0, STAT_MAX_SPLIT);
      const keys = ranked.map((r) => r.keys[0] ?? null);
      const labels = await this.labels(splitBy, keys);
      const cellsOf = new Map(
        current.sets[3]!.map((r) => [`${r.keys[0]}|${r.keys[1] ?? ''}`, r.cells]),
      );
      series = keys.map((key) => ({
        key,
        label: key === null ? null : (labels.get(key) ?? null),
        values: buckets.map((b) => value(cellsOf.get(`${b.bucket}|${key ?? ''}`)).value),
      }));
    }
    const totals = current.sets[0]![0]!.cells;
    return {
      ...this.meta(query, current, finance, totals),
      measure,
      unit: STAT_MEASURES[measure].unit,
      buckets: buckets.map((b, i) => {
        const cell = value(perBucket.get(b.bucket));
        const twin: StatBucket | undefined = before[i];
        return {
          bucket: b.bucket,
          from: b.from,
          to: b.to,
          value: cell.value,
          previous: twin ? value(perBefore.get(twin.bucket)).value : null,
          estimated: cell.estimated,
        };
      }),
      splitBy: splitBy ?? null,
      series,
    };
  }

  // ---------------------------------------------------------------- visits

  async visits(query: DistributionStatsQuery, user: CurrentUserInfo): Promise<StatsVisitsDto> {
    const reach = await this.scopes.reach(user);
    const finance = can(user, Permission.REPORTS_FINANCE);
    const range: DayRange = { from: query.from, to: query.to };
    this.assertFilters(VISIT_MEASURES, ['vehicle'], query);
    const [result, reasons, firstRoute] = await Promise.all([
      this.engine.run({
        range,
        measures: VISIT_MEASURES,
        sets: [[], ['vehicle']],
        filters: query,
        reach,
        finance,
      }),
      this.engine.run({
        range,
        measures: ['visitsNoSale'],
        sets: [['noSaleReason']],
        filters: query,
        reach,
        finance,
      }),
      this.prisma.db.route.findFirst({
        where: { vehicleId: { not: null } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    const totals = result.sets[0]![0]!.cells;
    const byKey = new Map(result.sets[1]!.map((r) => [r.keys[0] ?? null, r.cells]));
    const vehicles = await this.prisma.db.warehouse.findMany({
      where: { id: { in: [...byKey.keys()].filter((k): k is string => k !== null) } },
      select: VEHICLE_SELECT,
      orderBy: [{ code: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    const rows: StatsVisitsDto['rows'] = vehicles.map((v) => ({
      vehicle: toVehicleRef(v),
      cells: byKey.get(v.id)!,
      link: measureLink('visitsDone', range, query, v.id),
    }));
    const none = byKey.get(null);
    if (none) rows.push({ vehicle: null, cells: none, link: null });
    const counted = new Map(
      reasons.sets[0]!.map((r) => [r.keys[0], Number(cellOf(r.cells, 'visitsNoSale')!.value)]),
    );
    return {
      ...this.meta(query, result, finance, totals),
      rows,
      totals,
      reasons: NO_SALE_REASONS.map((reason: NoSaleReason) => ({
        reason,
        count: counted.get(reason) ?? 0,
      })).filter((r) => r.count > 0),
      planningKnownFrom: firstRoute ? algiersDay(firstRoute.createdAt) : null,
    };
  }

  // ---------------------------------------------------------------- clients perdus

  /**
   * Clients who bought in the comparison period (the previous one unless `lastYear`) and
   * did not in this one, by what they bought then.
   */
  async lostClients(
    query: DistributionStatsQuery,
    user: CurrentUserInfo,
  ): Promise<StatsLostClientsDto> {
    const reach = await this.scopes.reach(user);
    const range: DayRange = { from: query.from, to: query.to };
    const measures: StatMeasure[] = ['caTtc', 'nbBl'];
    this.assertFilters(measures, ['client'], query);
    const compare = comparisonRange(range, query.compare === 'lastYear' ? 'lastYear' : 'previous')!;
    const run = (r: DayRange) =>
      this.engine.run({
        range: r,
        measures,
        sets: [['client']],
        filters: query,
        reach,
        finance: false,
      });
    const [now, before] = await Promise.all([run(range), run(compare)]);
    const bought = (rows: StatsRow[]) =>
      rows.filter((r) => r.keys[0] != null && num(r.cells, 'nbBl').gt(0));
    const current = new Set(bought(now.sets[0]!).map((r) => r.keys[0]));
    const previous = bought(before.sets[0]!);
    const lost = previous
      .filter((r) => !current.has(r.keys[0]))
      .sort((a, b) => num(b.cells, 'caTtc').comparedTo(num(a.cells, 'caTtc')));
    const top = lost.slice(0, STAT_TOP_ROWS);
    const names = await this.labels(
      'client',
      top.map((r) => r.keys[0] ?? null),
    );
    return {
      from: query.from,
      to: query.to,
      compare,
      active: current.size,
      previousActive: previous.length,
      count: lost.length,
      clients: top.map((r) => ({
        id: r.keys[0]!,
        name: names.get(r.keys[0]!) ?? '',
        previousCaTtc: toMoneyString(num(r.cells, 'caTtc')),
        link: `/clients/${r.keys[0]!}`,
      })),
    };
  }

  // ---------------------------------------------------------------- dispersion

  async dispersion(
    query: DistributionStatsQuery,
    user: CurrentUserInfo,
  ): Promise<StatsDispersionDto> {
    const reach = await this.scopes.reach(user);
    const finance = can(user, Permission.REPORTS_FINANCE);
    const range: DayRange = { from: query.from, to: query.to };
    const measures: StatMeasure[] = ['caTtc', 'nbBl'];
    this.assertFilters(measures, ['vehicle', 'day'], query);
    const result = await this.engine.run({
      range,
      measures,
      sets: [[], ['vehicle'], ['vehicle', 'day']],
      filters: query,
      reach,
      finance,
    });
    const totals = result.sets[0]![0]!.cells;
    const days = statBuckets(range, 'day').map((b) => b.bucket);
    const perVehicle = new Map(result.sets[1]!.map((r) => [r.keys[0] ?? null, r.cells]));
    const perDay = new Map(
      result.sets[2]!.map((r) => [`${r.keys[0] ?? ''}|${r.keys[1]}`, r.cells]),
    );
    const listed = await this.listedVehicles(reach, query, [...perVehicle.keys()]);
    const entries: { vehicle: StatVehicleRef | null; key: string | null }[] = listed.map((v) => ({
      vehicle: v,
      key: v.id,
    }));
    if (perVehicle.has(null)) entries.push({ vehicle: null, key: null });
    let max = money(0);
    const rows = entries.map(({ vehicle, key }) => {
      const total = perVehicle.get(key) ?? result.blank;
      return {
        vehicle,
        cells: days.map((day) => {
          const cells = perDay.get(`${key ?? ''}|${day}`) ?? result.blank;
          const ca = num(cells, 'caTtc');
          if (ca.gt(max)) max = ca;
          return { caTtc: toMoneyString(ca), nbBl: num(cells, 'nbBl').toNumber() };
        }),
        caTtc: toMoneyString(num(total, 'caTtc')),
        nbBl: num(total, 'nbBl').toNumber(),
      };
    });
    return {
      ...this.meta(query, result, finance, totals),
      days,
      rows,
      maxCaTtc: toMoneyString(max),
    };
  }

  // ---------------------------------------------------------------- vehicle day

  async vehicleDay(
    query: StatsVehicleDayQuery,
    user: CurrentUserInfo,
  ): Promise<StatsVehicleDayDto> {
    const reach = await this.scopes.reach(user);
    const finance = can(user, Permission.REPORTS_FINANCE);
    const vehicle = await this.prisma.db.warehouse.findFirst({
      where: {
        id: query.vehicleId,
        type: WarehouseType.VEHICLE,
        ...(reach.warehouseIds ? { AND: [{ id: { in: reach.warehouseIds } }] } : {}),
      },
      select: VEHICLE_SELECT,
    });
    // Outside the reach it is not there (phase 24).
    if (!vehicle) throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Vehicle not found');
    return this.dayOf(toVehicleRef(vehicle), query.date, reach, finance);
  }

  private async dayOf(
    vehicle: StatVehicleRef,
    date: string,
    reach: StatsReach,
    finance: boolean,
  ): Promise<StatsVehicleDayDto> {
    const tenantId = tenantContext.requireTenantId();
    const range: DayRange = { from: date, to: date };
    const { start, end } = algiersRange(date, date);
    const id = vehicle.id;
    const ctx: FactCtx = {
      tenantId,
      start,
      end,
      from: date,
      to: date,
      today: algiersDay(this.clock.now()),
      vehicleOfPayment: this.vehicles.vehicleOfPayment('py'),
    };
    const db = this.prisma.db;
    type Doc = {
      id: string;
      number: string | null;
      at: Date;
      party: string | null;
      amount: Prisma.Decimal | null;
      kg: Prisma.Decimal | null;
    };
    const kg = (lines: string, alias: string, parent: string) =>
      Prisma.raw(`(SELECT SUM(COALESCE(${alias}."weightKg", ${alias}."qtyBase" * p0."weightKg"))
        FROM ${lines} ${alias} JOIN products p0 ON p0.id = ${alias}."productId"
        WHERE ${alias}."${parent}" = d.id)`);
    const [result, drivers, loads, unloads, sales, returns, payments, session] = await Promise.all([
      this.engine.run({
        range,
        measures: DAY_MEASURES,
        sets: [[]],
        filters: { vehicleIds: [id] },
        reach,
        finance,
      }),
      this.vehicles.driversDuring([id], start, end),
      db.$queryRaw<Doc[]>`
        SELECT d.id, d.number, d."validatedAt" AS at, w.name AS party, NULL::numeric AS amount,
               ${kg('stock_transfer_lines', 'l', 'transferId')} AS kg
        FROM stock_transfers d JOIN warehouses w ON w.id = d."fromWarehouseId"
        WHERE d."tenantId" = ${tenantId}::uuid AND d.type = 'LOAD' AND d.status = 'VALIDATED'
          AND d."toWarehouseId" = ${id}::uuid AND d."validatedAt" >= ${start}
          AND d."validatedAt" < ${end}
        ORDER BY d."validatedAt", d.id`,
      db.$queryRaw<Doc[]>`
        SELECT d.id, d.number, d."validatedAt" AS at, w.name AS party, NULL::numeric AS amount,
               ${kg('stock_transfer_lines', 'l', 'transferId')} AS kg
        FROM stock_transfers d JOIN warehouses w ON w.id = d."toWarehouseId"
        WHERE d."tenantId" = ${tenantId}::uuid AND d.type = 'UNLOAD' AND d.status = 'VALIDATED'
          AND d."fromWarehouseId" = ${id}::uuid AND d."validatedAt" >= ${start}
          AND d."validatedAt" < ${end}
        ORDER BY d."validatedAt", d.id`,
      db.$queryRaw<Doc[]>`
        SELECT d.id, d.number, d."validatedAt" AS at, c.name AS party, d."totalTtc" AS amount,
               ${kg('sale_lines', 'l', 'saleId')} AS kg
        FROM sales d LEFT JOIN clients c ON c.id = d."clientId"
        WHERE d."tenantId" = ${tenantId}::uuid AND d.status = 'VALIDATED'
          AND NOT EXISTS (SELECT 1 FROM sales g WHERE g."tenantId" = d."tenantId" AND g."invoiceId" = d.id)
          AND d."warehouseId" = ${id}::uuid AND d."validatedAt" >= ${start}
          AND d."validatedAt" < ${end}
        ORDER BY d."validatedAt", d.id`,
      db.$queryRaw<(Doc & { saleId: string; damaged: boolean })[]>`
        SELECT d.id, d.number, d."createdAt" AS at, c.name AS party, d."totalTtc" AS amount,
               ${kg('sale_return_lines', 'l', 'returnId')} AS kg, d."saleId",
               (d.disposition = 'DAMAGED') AS damaged
        FROM sale_returns d JOIN sales s ON s.id = d."saleId"
        LEFT JOIN clients c ON c.id = s."clientId"
        WHERE d."tenantId" = ${tenantId}::uuid AND s.status = 'VALIDATED'
          AND s."warehouseId" = ${id}::uuid AND d."createdAt" >= ${start} AND d."createdAt" < ${end}
        ORDER BY d."createdAt", d.id`,
      db.$queryRaw<Doc[]>`
        SELECT py.id, py.number, py."receivedAt" AS at, c.name AS party, py.amount,
               NULL::numeric AS kg
        FROM payments py
        ${ctx.vehicleOfPayment.join}
        LEFT JOIN clients c ON c.id = py."clientId"
        WHERE py."tenantId" = ${tenantId}::uuid AND py.status = 'VALID'
          AND py."receivedAt" >= ${start} AND py."receivedAt" < ${end}
          AND ${vehicleOfSql('payments', ctx)} = ${id}::uuid
        ORDER BY py."receivedAt", py.id`,
      db.$queryRaw<
        {
          id: string;
          status: string;
          expected: Prisma.Decimal | null;
          handed: Prisma.Decimal | null;
          ecart: Prisma.Decimal | null;
        }[]
      >`
        SELECT ss.id, ss.status::text AS status,
               ss."expectedCash" AS expected,
               COALESCE(a."handedCash", ss."handedCash") AS handed,
               COALESCE(a.ecart, ss.ecart) AS ecart
        FROM seller_sessions ss
        LEFT JOIN LATERAL (
          SELECT x."handedCash", x.ecart FROM seller_sessions x
          WHERE x."adjustsSessionId" = ss.id AND x.ecart IS NOT NULL
          ORDER BY x."createdAt" DESC, x.id DESC LIMIT 1) a ON TRUE
        WHERE ss."tenantId" = ${tenantId}::uuid AND ss."adjustsSessionId" IS NULL
          AND ss."warehouseId" = ${id}::uuid AND ss.date = ${date}::date
        ORDER BY ss."createdAt"`,
    ]);
    const ref =
      (link: (d: Doc) => string) =>
      (d: Doc): StatDocumentRef => ({
        id: d.id,
        number: d.number,
        link: link(d),
        at: d.at.toISOString(),
        party: d.party,
        amount: d.amount ? toMoneyString(d.amount.toString()) : null,
        weightKg: d.kg ? money(d.kg.toString()).toFixed(3) : null,
      });
    type CashKey = 'expected' | 'handed' | 'ecart';
    const sumOf = (key: CashKey) =>
      session.reduce((acc, r) => (r[key] ? acc.plus(r[key].toString()) : acc), money(0));
    const closed = session.length > 0 && session.every((s) => s.status === 'CLOSED');
    const known = (key: CashKey) =>
      session.some((s) => s[key] !== null) ? toMoneyString(sumOf(key)) : null;
    return {
      date,
      vehicle,
      drivers: (drivers.get(id) ?? []).map((d) => ({
        id: d.id,
        fullName: d.fullName,
        fromAt: d.fromAt.toISOString(),
      })),
      finance,
      cells: result.sets[0]![0]!.cells,
      loads: loads.map(ref((d) => `/stock/transferts/${d.id}`)),
      sales: sales.map(ref((d) => `/ventes/${d.id}`)),
      returns: returns.map((r) => ({
        ...ref(() => `/ventes/${r.saleId}`)(r),
        damaged: r.damaged,
      })),
      unloads: unloads.map(ref((d) => `/stock/transferts/${d.id}`)),
      payments: payments.map(ref(() => `/versements?from=${date}&to=${date}&warehouseId=${id}`)),
      cash: {
        expected: known('expected'),
        handed: closed ? known('handed') : null,
        ecart: closed ? known('ecart') : null,
        closed,
        link: session.length ? `/tournees/cloture?date=${date}` : null,
      },
    };
  }

  // ---------------------------------------------------------------- mon véhicule

  /** The dashboard card of a seller or a livreur: the truck he drives today, nothing else. */
  async myVehicle(user: CurrentUserInfo): Promise<StatsMyVehicleDto> {
    const date = algiersDay(this.clock.now());
    const { vehicleId, reach } = await this.scopes.own(user);
    const range: DayRange = { from: date, to: date };
    if (!vehicleId) return { vehicle: null, date, today: [], objectives: [] };
    const [vehicle, result] = await Promise.all([
      this.prisma.db.warehouse.findFirstOrThrow({
        where: { id: vehicleId },
        select: VEHICLE_SELECT,
      }),
      this.engine.run({
        range,
        measures: MY_VEHICLE_MEASURES,
        sets: [[]],
        filters: { vehicleIds: [vehicleId] },
        reach,
        finance: false,
      }),
    ]);
    const objectives = await this.objectives(range, [vehicleId], reach, []);
    return {
      vehicle: toVehicleRef(vehicle),
      date,
      today: result.sets[0]![0]!.cells,
      objectives: objectives.get(vehicleId) ?? [],
    };
  }

  // ---------------------------------------------------------------- shared

  /**
   * A filter that none of the view's figures can follow is refused, never ignored. One
   * that only some figures follow is applied to those; the others come back null and are
   * listed in `notApplicable`.
   */
  private assertFilters(
    measures: readonly StatMeasure[],
    dims: readonly EngineDimension[],
    filters: StatFilters,
  ): void {
    const refused = activeFilters(filters).filter(
      (f) => !measures.some((m) => this.engine.canApply(m, dims, [f])),
    );
    if (refused.length > 0) {
      throw new AppException(
        ErrorCode.STATS_FILTER_NOT_APPLICABLE,
        'This view cannot apply this filter',
        { filters: refused },
      );
    }
  }

  private meta(
    query: DayRange & { compare: DistributionStatsQuery['compare']; groupBy: StatGroupBy },
    result: StatsRunResult,
    finance: boolean,
    totals: StatCell[],
  ): StatsMetaDto {
    const range: DayRange = { from: query.from, to: query.to };
    return {
      from: query.from,
      to: query.to,
      compare: comparisonRange(range, query.compare),
      groupBy: query.groupBy,
      notApplicable: result.notApplicable,
      weightUnknownLines: Number(cellOf(totals, 'weightUnknownLines')?.value ?? 0),
      finance,
    };
  }
}

type VehicleRow = {
  id: string;
  code: string | null;
  name: string;
  wilayaCode: number | null;
  capacityKg: number | null;
  vehicleType: { id: string; code: string; name: string; activity: string } | null;
  parent: { id: string; name: string } | null;
};

function toVehicleRef(v: VehicleRow): StatVehicleRef {
  return {
    id: v.id,
    code: v.code,
    name: v.name,
    type: v.vehicleType
      ? { ...v.vehicleType, activity: v.vehicleType.activity as VehicleActivity }
      : null,
    wilayaCode: v.wilayaCode,
    capacityKg: v.capacityKg,
    depot: v.parent,
  };
}

/** A month's figure in the unit of its target: the weight target is in kg. */
function achievedValue(metric: VehicleTargetMetric, value: string): string {
  if (metric === 'POIDS_KG') return money(value).times(1000).toFixed(3);
  if (metric === 'CA_TTC') return toMoneyString(value);
  return money(value).toFixed(0);
}

/**
 * "Autres": the total minus the rows shown, for the figures that add up; a rate is derived
 * again from those; a distinct count cannot be folded and stays null.
 */
function foldOthers(
  measures: readonly StatMeasure[],
  totals: StatCell[],
  top: StatsRow[],
  finance: boolean,
): StatCell[] {
  const rest = new Map<StatMeasure, string | null>();
  const base = (measure: StatMeasure): string | null => {
    if (rest.has(measure)) return rest.get(measure)!;
    const def: StatMeasureDef = STAT_MEASURES[measure];
    const total = cellOf(totals, measure);
    let value: string | null = null;
    if (def.additivity === 'sum' && total && total.value !== null) {
      value = top
        .reduce((acc, r) => acc.minus(cellOf(r.cells, measure)?.value ?? '0'), money(total.value))
        .toFixed(
          def.unit === StatUnit.DA
            ? 2
            : def.unit === StatUnit.COUNT
              ? 0
              : def.unit === StatUnit.TONNE
                ? 6
                : 3,
        );
    }
    rest.set(measure, value);
    return value;
  };
  return measures.map((measure) => {
    const def: StatMeasureDef = STAT_MEASURES[measure];
    const total = cellOf(totals, measure)!;
    let value: string | null = null;
    if (def.finance && !finance) value = null;
    else if (def.additivity === 'sum') value = base(measure);
    else if (def.of) {
      const [a, b] = def.of as unknown as [StatMeasure, StatMeasure];
      const top2 = base(a);
      const bottom = base(b);
      value = top2 !== null && bottom !== null ? deriveRatio(measure, top2, bottom) : null;
    }
    return { measure, unit: def.unit, value, estimated: value !== null && total.estimated };
  });
}
