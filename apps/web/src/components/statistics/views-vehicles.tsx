'use client';

import { ArrowUpDown, Copy, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  monthStart,
  Permission,
  type StatMeasure,
  type StatsByVehicleDto,
  type StatsOverviewDto,
  type StatsTimelineDto,
  type StatVehicleRowDto,
  VEHICLE_TARGET_METRICS,
  type VehicleTargetMetric,
} from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/lib/auth';
import {
  cellOf,
  downloadStats,
  formatStat,
  plotValue,
  type StatsState,
  statsQuery,
  useCopyVehicleTargets,
  useSaveVehicleTargets,
  useStats,
  useVehicleTargets,
} from '@/lib/distribution-stats';
import { useErrorMessage } from '@/lib/use-error-message';
import {
  DimensionBlock,
  Empty,
  ErrorBlock,
  LoadingBlock,
  MetaNote,
  StatTile,
  useStatLabels,
} from './common';
import {
  type ChartRow,
  Num,
  RankBarChart,
  StatPanel,
  StatTable,
  TimeAreaChart,
} from './stat-panel';

function useVehicleRows(dto: StatsByVehicleDto | undefined, measures: StatMeasure[]) {
  const labels = useStatLabels();
  return (dto?.rows ?? []).map((r): ChartRow & { link: string | null } => ({
    id: r.vehicle?.id ?? '∅',
    label: labels.vehicle(r.vehicle),
    link: r.link,
    values: Object.fromEntries(measures.map((m) => [m, plotValue(cellOf(r.cells, m))])),
    display: Object.fromEntries(
      measures.map((m) => {
        const c = cellOf(r.cells, m);
        return [m, formatStat(c?.value ?? null, c?.unit ?? 'COUNT')];
      }),
    ),
  }));
}

/** Sorted by one measure, the largest first (a copy: the API order stays the source). */
function sortBy<T extends ChartRow>(rows: T[], measure: string): T[] {
  return [...rows].sort((a, b) => (b.values[measure] ?? 0) - (a.values[measure] ?? 0));
}

function VehicleBars({
  dto,
  title,
  measures,
  query,
  limit = 15,
}: {
  dto: StatsByVehicleDto;
  title: string;
  measures: StatMeasure[];
  query: string;
  limit?: number;
}) {
  const t = useTranslations('stats');
  const labels = useStatLabels();
  const router = useRouter();
  const rows = sortBy(useVehicleRows(dto, measures), measures[0]!);
  const table = (
    <StatTable
      caption={title}
      head={[t('colVehicle'), ...measures.map((m) => labels.measure(m))]}
      rows={rows.map((r) => ({
        key: r.id,
        cells: [r.label, ...measures.map((m) => <Num key={m}>{r.display[m]}</Num>)],
      }))}
      foot={[
        t('total'),
        ...measures.map((m) => {
          const c = cellOf(dto.totals, m);
          return <Num key={m}>{formatStat(c?.value ?? null, c?.unit ?? 'COUNT')}</Num>;
        }),
      ]}
    />
  );
  return (
    <StatPanel
      title={title}
      definition={labels.definition(measures[0]!)}
      note={<MetaNote meta={dto} cells={dto.totals} />}
      chart={
        rows.length === 0 ? undefined : (
          <RankBarChart
            rows={rows.slice(0, limit)}
            series={measures.map((m) => ({ key: m, label: labels.measure(m) }))}
            onSelect={(row) => {
              const link = rows.find((r) => r.id === row.id)?.link;
              if (link) router.push(link);
            }}
          />
        )
      }
      table={rows.length === 0 ? <Empty /> : table}
      onExport={() => downloadStats('by-vehicle', query)}
    />
  );
}

// ---------------------------------------------------------------- 1. Vue globale

export function GlobalView({ state }: { state: StatsState }) {
  const t = useTranslations('stats');
  const query = statsQuery(state);
  const overview = useStats<StatsOverviewDto>('overview', query);
  const vehicles = useStats<StatsByVehicleDto>('by-vehicle', query);
  const timeline = useStats<StatsTimelineDto>('timeline', statsQuery(state, { measure: 'caTtc' }));
  if (overview.isError) return <ErrorBlock error={overview.error} />;
  const o = overview.data;
  return (
    <div className="space-y-4">
      {o ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {o.tiles.map((tile) => (
              <StatTile key={tile.measure} tile={tile} />
            ))}
            <div className="flex min-h-28 flex-col gap-1 rounded-xl border bg-card p-3">
              <p className="text-xs font-medium text-muted-foreground">{t('bcPreviousDay')}</p>
              <p className="text-lg font-semibold">
                <Num>{formatStat(o.bcPreviousDay.count.value, o.bcPreviousDay.count.unit)}</Num>
              </p>
              <p className="text-xs text-muted-foreground">
                <Num>{formatStat(o.bcPreviousDay.ttc.value, o.bcPreviousDay.ttc.unit)}</Num>
              </p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            <MetaNote meta={o} cells={o.tiles} />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {timeline.data ? (
          <TimelinePanel dto={timeline.data} query={statsQuery(state, { measure: 'caTtc' })} />
        ) : timeline.isError ? (
          <ErrorBlock error={timeline.error} />
        ) : (
          <Skeleton className="h-72" />
        )}
        <DimensionBlock
          state={state}
          dimension="depot"
          title={t('caByDepot')}
          tableMeasures={['caTtc', 'nbBl', 'weightT']}
        />
        {vehicles.data ? (
          <VehicleBars
            dto={vehicles.data}
            title={t('topVehicles')}
            measures={['caTtc']}
            query={query}
            limit={10}
          />
        ) : vehicles.isError ? (
          <ErrorBlock error={vehicles.error} />
        ) : (
          <Skeleton className="h-72" />
        )}
      </div>
    </div>
  );
}

export function TimelinePanel({ dto, query }: { dto: StatsTimelineDto; query: string }) {
  const t = useTranslations('stats');
  const labels = useStatLabels();
  const rows: ChartRow[] = dto.buckets.map((b) => ({
    id: b.bucket,
    label: b.from === b.to ? b.from.slice(5) : `${b.from.slice(5)}`,
    values: { current: Number(b.value ?? 0) || 0, previous: Number(b.previous ?? 0) || 0 },
    display: { current: formatStat(b.value, dto.unit), previous: formatStat(b.previous, dto.unit) },
  }));
  const hasPrevious = dto.compare !== null;
  return (
    <StatPanel
      title={t('timelineOf', { measure: labels.measure(dto.measure) })}
      definition={labels.definition(dto.measure)}
      note={
        <MetaNote
          meta={dto}
          cells={dto.buckets.map((b) => ({
            measure: dto.measure,
            unit: dto.unit,
            value: b.value,
            estimated: b.estimated,
          }))}
        />
      }
      chart={
        <TimeAreaChart
          rows={rows}
          current={{ key: 'current', label: t('thisPeriod') }}
          previous={hasPrevious ? { key: 'previous', label: t('comparePeriod') } : null}
        />
      }
      table={
        <StatTable
          caption={labels.measure(dto.measure)}
          head={[t('colPeriod'), t('thisPeriod'), ...(hasPrevious ? [t('comparePeriod')] : [])]}
          rows={dto.buckets.map((b, i) => ({
            key: b.bucket,
            cells: [
              b.from === b.to ? b.from : `${b.from} → ${b.to}`,
              <Num key="c">{rows[i]!.display.current}</Num>,
              ...(hasPrevious ? [<Num key="p">{rows[i]!.display.previous}</Num>] : []),
            ],
          }))}
        />
      }
      onExport={() => downloadStats('timeline', query)}
    />
  );
}

// ---------------------------------------------------------------- 2. Véhicules

const SORTABLE: StatMeasure[] = [
  'caTtc',
  'nbBl',
  'dropSize',
  'weightT',
  'versements',
  'recouvrement',
  'activeClients',
];

export function VehiclesView({ state }: { state: StatsState }) {
  const t = useTranslations('stats');
  const labels = useStatLabels();
  const query = statsQuery(state);
  const res = useStats<StatsByVehicleDto>('by-vehicle', query);
  const [sort, setSort] = useState<StatMeasure>('caTtc');
  if (res.isError) return <ErrorBlock error={res.error} />;
  const dto = res.data;
  if (!dto) return <LoadingBlock />;
  const sorted = [...dto.rows].sort(
    (a, b) => plotValue(cellOf(b.cells, sort)) - plotValue(cellOf(a.cells, sort)),
  );
  const text = (r: StatVehicleRowDto, m: StatMeasure) => {
    const c = cellOf(r.cells, m);
    return formatStat(c?.value ?? null, c?.unit ?? 'COUNT');
  };
  const drivers = (r: StatVehicleRowDto) => r.drivers.map((d) => d.fullName).join(', ');
  return (
    <div className="space-y-4">
      <StatPanel
        title={t('byVehicleTable')}
        note={<MetaNote meta={dto} cells={dto.totals} />}
        onExport={() => downloadStats('by-vehicle', query)}
        table={
          <>
            {/* Phone: one card per truck. */}
            <ul className="space-y-2 md:hidden">
              {sorted.map((r) => (
                <li key={r.vehicle?.id ?? '∅'} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate font-medium">{labels.vehicle(r.vehicle)}</p>
                    <Num className="font-semibold">{text(r, 'caTtc')}</Num>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[r.vehicle?.type?.name, r.vehicle?.depot?.name, drivers(r)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {(
                      [
                        'nbBl',
                        'dropSize',
                        'weightT',
                        'versements',
                        'recouvrement',
                        'visitRate',
                      ] as StatMeasure[]
                    ).map((m) => (
                      <div key={m} className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{labels.measure(m)}</dt>
                        <dd>
                          <Num>{text(r, m)}</Num>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {r.link ? (
                    <Link
                      href={r.link}
                      className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {t('openSales')}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
            {/* md+: a sortable table. */}
            <div className="hidden md:block">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <ArrowUpDown className="size-4 text-muted-foreground" aria-hidden />
                <label htmlFor="stats-sort">{t('sortBy')}</label>
                <select
                  id="stats-sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as StatMeasure)}
                  className="h-9 rounded-md border bg-background px-2"
                >
                  {SORTABLE.map((m) => (
                    <option key={m} value={m}>
                      {labels.measure(m)}
                    </option>
                  ))}
                </select>
              </div>
              <StatTable
                caption={t('byVehicleTable')}
                head={[
                  t('colVehicle'),
                  t('colType'),
                  t('colDepot'),
                  t('colDrivers'),
                  ...SORTABLE.map((m) => labels.measure(m)),
                  labels.measure('visitRate'),
                  dto.finance ? labels.measure('loadValueCost') : labels.measure('loadValueTtc'),
                  labels.measure('damagedTtc'),
                  labels.measure('cashEcart'),
                ]}
                rows={sorted.map((r) => ({
                  key: r.vehicle?.id ?? '∅',
                  cells: [
                    r.link ? (
                      <Link key="v" href={r.link} className="underline-offset-4 hover:underline">
                        {labels.vehicle(r.vehicle)}
                      </Link>
                    ) : (
                      labels.vehicle(r.vehicle)
                    ),
                    r.vehicle?.type?.name ?? '—',
                    r.vehicle?.depot?.name ?? '—',
                    drivers(r) || '—',
                    ...SORTABLE.map((m) => <Num key={m}>{text(r, m)}</Num>),
                    <Num key="vr">{text(r, 'visitRate')}</Num>,
                    <Num key="lv">{text(r, dto.finance ? 'loadValueCost' : 'loadValueTtc')}</Num>,
                    <Num key="d">{text(r, 'damagedTtc')}</Num>,
                    <Num key="e">{text(r, 'cashEcart')}</Num>,
                  ],
                }))}
                foot={[
                  t('total'),
                  '',
                  '',
                  '',
                  ...[
                    ...SORTABLE,
                    'visitRate' as const,
                    dto.finance ? ('loadValueCost' as const) : ('loadValueTtc' as const),
                    'damagedTtc' as const,
                    'cashEcart' as const,
                  ].map((m) => {
                    const c = cellOf(dto.totals, m);
                    return <Num key={m}>{formatStat(c?.value ?? null, c?.unit ?? 'COUNT')}</Num>;
                  }),
                ]}
              />
            </div>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <VehicleBars
          dto={dto}
          title={t('caVersementsByVehicle')}
          measures={['caTtc', 'versements']}
          query={query}
        />
        <VehicleBars
          dto={dto}
          title={labels.measure('dropSize')}
          measures={['dropSize']}
          query={query}
        />
        <VehicleBars
          dto={dto}
          title={labels.measure('weightT')}
          measures={['weightT']}
          query={query}
        />
        <VehicleBars dto={dto} title={labels.measure('nbBl')} measures={['nbBl']} query={query} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 7. Commandes & livraison

export function OrdersView({ state }: { state: StatsState }) {
  const t = useTranslations('stats');
  const query = statsQuery(state);
  const overview = useStats<StatsOverviewDto>('overview', query);
  const res = useStats<StatsByVehicleDto>('by-vehicle', query);
  if (res.isError) return <ErrorBlock error={res.error} />;
  if (!res.data) return <LoadingBlock />;
  const tiles = overview.data?.tiles.filter((x) =>
    (['bcCount', 'bcTtc', 'deliveryRate', 'openOrders'] as StatMeasure[]).includes(x.measure),
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles ? (
          tiles.map((tile) => <StatTile key={tile.measure} tile={tile} />)
        ) : (
          <Skeleton className="col-span-full h-28" />
        )}
        {overview.data ? (
          <div className="flex min-h-28 flex-col gap-1 rounded-xl border bg-card p-3">
            <p className="text-xs font-medium text-muted-foreground">{t('bcPreviousDay')}</p>
            <p className="text-lg font-semibold">
              <Num>{formatStat(overview.data.bcPreviousDay.count.value, 'COUNT')}</Num>
            </p>
            <p className="text-xs text-muted-foreground">
              <Num>{formatStat(overview.data.bcPreviousDay.ttc.value, 'DA')}</Num>
            </p>
          </div>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <VehicleBars dto={res.data} title={t('bcByVehicle')} measures={['bcTtc']} query={query} />
        <VehicleBars
          dto={res.data}
          title={t('deliveryByVehicle')}
          measures={['deliveryRate']}
          query={query}
        />
        <VehicleBars
          dto={res.data}
          title={t('openByVehicle')}
          measures={['openOrders']}
          query={query}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 9. Objectifs

const METRIC_DECIMALS: Record<VehicleTargetMetric, number> = {
  CA_TTC: 2,
  POIDS_KG: 3,
  NB_BL: 0,
  CLIENTS_ACTIFS: 0,
};

export function TargetsView({ state }: { state: StatsState }) {
  const t = useTranslations('stats');
  const labels = useStatLabels();
  const canEdit = usePermission(Permission.SETTINGS_EDIT);
  const period = monthStart(state.range.to);
  const oneMonth = monthStart(state.range.from) === period;
  const query = statsQuery(state);
  const res = useStats<StatsByVehicleDto>('by-vehicle', query, oneMonth);
  const [editing, setEditing] = useState(false);
  if (!oneMonth) return <p className="rounded-md border p-4 text-sm">{t('targetsOneMonth')}</p>;
  if (res.isError) return <ErrorBlock error={res.error} />;
  if (!res.data) return <LoadingBlock />;
  const rows = res.data.rows.filter((r) => r.vehicle);
  const unit = (m: VehicleTargetMetric) => (m === 'POIDS_KG' ? ' kg' : '');
  return (
    <div className="space-y-4">
      <StatPanel
        title={t('targetsTitle', { month: period.slice(0, 7) })}
        definition={t('def_targets')}
        onExport={() => downloadStats('by-vehicle', query)}
        table={
          rows.every((r) => r.objectives.length === 0) ? (
            <Empty />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {rows
                .filter((r) => r.objectives.length > 0)
                .map((r) => (
                  <li key={r.vehicle!.id} className="space-y-2 rounded-lg border p-3">
                    <p className="font-medium">{labels.vehicle(r.vehicle)}</p>
                    {r.objectives.map((o) => {
                      const pct = o.pct === null ? 0 : Math.min(100, Number(o.pct));
                      return (
                        <div key={o.metric} className="space-y-1">
                          <div className="flex flex-wrap justify-between gap-2 text-xs">
                            <span>{t(`metric_${o.metric}`)}</span>
                            <Num>
                              {formatNumber(o.achieved)}
                              {unit(o.metric)} / {formatNumber(o.target)}
                              {unit(o.metric)} · {formatStat(o.pct, 'PERCENT')}
                            </Num>
                          </div>
                          <div
                            role="progressbar"
                            aria-label={t(`metric_${o.metric}`)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={pct}
                            aria-valuetext={formatStat(o.pct, 'PERCENT')}
                            className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                          >
                            <div
                              className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </li>
                ))}
            </ul>
          )
        }
      />
      {canEdit ? (
        editing ? (
          <TargetEditor period={period} vehicles={rows} onDone={() => setEditing(false)} />
        ) : (
          <Button variant="outline" className="min-h-11" onClick={() => setEditing(true)}>
            {t('editTargets')}
          </Button>
        )
      ) : null}
    </div>
  );
}

const formatNumber = (v: string) => formatStat(v, 'QTY');

function TargetEditor({
  period,
  vehicles,
  onDone,
}: {
  period: string;
  vehicles: StatVehicleRowDto[];
  onDone: () => void;
}) {
  const t = useTranslations('stats');
  const labels = useStatLabels();
  const errorMessage = useErrorMessage();
  const targets = useVehicleTargets(period);
  const save = useSaveVehicleTargets();
  const copy = useCopyVehicleTargets();
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!targets.data) return <Skeleton className="h-40" />;
  const key = (vehicleId: string, metric: VehicleTargetMetric) => `${vehicleId}:${metric}`;
  const saved = new Map(
    targets.data.targets.map((x) => [key(x.vehicleId, x.metric), x.targetValue]),
  );
  const valueOf = (k: string) => draft[k] ?? saved.get(k) ?? '';
  const submit = () => {
    const changes = Object.entries(draft)
      .filter(([k, v]) => v.trim() !== (saved.get(k) ?? ''))
      .map(([k, v]) => {
        const [vehicleId, metric] = k.split(':') as [string, VehicleTargetMetric];
        return { vehicleId, metric, targetValue: v.trim() === '' ? null : v.trim() };
      });
    if (changes.length === 0) return onDone();
    save.mutate(
      { period, targets: changes },
      {
        onSuccess: () => {
          toast.success(t('targetsSaved'));
          onDone();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };
  return (
    <StatPanel
      title={t('editTargets')}
      table={
        <div className="space-y-3">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={copy.isPending}
            onClick={() =>
              copy.mutate(period, {
                onSuccess: () => toast.success(t('targetsCopied')),
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            {copy.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Copy aria-hidden />
            )}
            {t('copyPrevious')}
          </Button>
          <ul className="space-y-3">
            {vehicles.map((r) => (
              <li key={r.vehicle!.id} className="rounded-lg border p-3">
                <p className="mb-2 font-medium">{labels.vehicle(r.vehicle)}</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {VEHICLE_TARGET_METRICS.map((m) => {
                    const k = key(r.vehicle!.id, m);
                    const id = `target-${k}`;
                    return (
                      <div key={m} className="space-y-1">
                        <label htmlFor={id} className="text-xs text-muted-foreground">
                          {t(`metric_${m}`)}
                          {m === 'POIDS_KG' ? ' (kg)' : m === 'CA_TTC' ? ' (DA)' : ''}
                        </label>
                        <Input
                          id={id}
                          inputMode="decimal"
                          dir="ltr"
                          className="h-11 text-base"
                          value={valueOf(k)}
                          placeholder={METRIC_DECIMALS[m] > 0 ? '0' : '0'}
                          onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                        />
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button className="min-h-11" disabled={save.isPending} onClick={submit}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('save')}
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={onDone}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      }
    />
  );
}
