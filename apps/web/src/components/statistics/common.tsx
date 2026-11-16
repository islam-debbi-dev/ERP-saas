'use client';

import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  type StatCell,
  type StatDimension,
  type StatMeasure,
  type StatsByDimensionDto,
  type StatsMetaDto,
  type StatTileDto,
  type StatVehicleRef,
  type VehicleActivity,
  wilayaLabel,
} from '@erp/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  cellOf,
  downloadStats,
  formatStat,
  plotValue,
  type StatsState,
  statsQuery,
  useStats,
} from '@/lib/distribution-stats';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { type ChartRow, Num, RankBarChart, StatPanel, StatTable } from './stat-panel';

/** Measures that have a written definition in the messages (`stats.def_<measure>`). */
const DEFINED_LIST = [
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
  'loadValueTtc',
  'loadValueCost',
  'fillRate',
  'damagedTtc',
  'cashEcart',
  'visitsPlanned',
  'visitsDone',
  'visitsSuccess',
  'visitRate',
  'successPlannedRate',
  'successRate',
] as const;
type DefinedMeasure = (typeof DEFINED_LIST)[number];
const DEFINED: ReadonlySet<StatMeasure> = new Set<StatMeasure>(DEFINED_LIST);

export function useStatLabels() {
  const t = useTranslations('stats');
  const locale = useLocale();
  return {
    measure: (m: StatMeasure) => t(`m_${m}`),
    definition: (m: StatMeasure) => (DEFINED.has(m) ? t(`def_${m as DefinedMeasure}`) : undefined),
    vehicle: (v: StatVehicleRef | null) =>
      v ? (v.code ? `${v.code} · ${v.name}` : v.name) : t('noVehicle'),
    dimensionKey: (dimension: StatDimension, key: string | null, label: string | null) => {
      if (key === null) return t('notSet');
      if (label) return label;
      if (dimension === 'vehicleWilaya') return wilayaLabel(Number(key), locale) ?? key;
      if (dimension === 'activity') return t(`activity_${key as VehicleActivity}`);
      return key;
    },
  };
}

/** "Poids estimé" / "poids inconnu (N lignes)" / filters a figure could not follow. */
export function MetaNote({ meta, cells }: { meta: StatsMetaDto; cells?: StatCell[] }) {
  const t = useTranslations('stats');
  const labels = useStatLabels();
  const estimated = cells?.some((c) => c.estimated) ?? false;
  const blocked = Object.entries(meta.notApplicable) as [StatMeasure, string[]][];
  if (!estimated && meta.weightUnknownLines === 0 && blocked.length === 0) return null;
  return (
    <ul className="space-y-0.5">
      {estimated ? <li>{t('weightEstimated')}</li> : null}
      {meta.weightUnknownLines > 0 ? (
        <li>{t('weightUnknown', { count: meta.weightUnknownLines })}</li>
      ) : null}
      {blocked.length > 0 ? (
        <li>
          {t('notApplicable', { measures: blocked.map(([m]) => labels.measure(m)).join(', ') })}
        </li>
      ) : null}
    </ul>
  );
}

export function LoadingBlock() {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-busy>
      <Skeleton className="h-64" />
      <Skeleton className="h-64" />
    </div>
  );
}

export function ErrorBlock({ error }: { error: unknown }) {
  const message = useErrorMessage();
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message(error)}</AlertDescription>
    </Alert>
  );
}

/** A tiny line of the period (decorative: the value and the trend are written beside it). */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * 100).toFixed(1)},${(28 - ((v - min) / span) * 26).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="h-7 w-full rtl:-scale-x-100"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--chart-2)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** One KPI tile: value, trend against the comparison (in words and an arrow), sparkline. */
export function StatTile({ tile }: { tile: StatTileDto }) {
  const t = useTranslations('stats');
  const labels = useStatLabels();
  const Arrow =
    tile.trend === 'up' ? ArrowUpRight : tile.trend === 'down' ? ArrowDownRight : ArrowRight;
  const body = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{labels.measure(tile.measure)}</p>
      <p className="text-lg font-semibold">
        <Num>{formatStat(tile.value, tile.unit)}</Num>
        {tile.estimated ? (
          <span className="ms-1 text-xs font-normal text-muted-foreground">
            {t('estimatedShort')}
          </span>
        ) : null}
      </p>
      {tile.trend ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Arrow className="size-3.5 rtl:-scale-x-100" aria-hidden />
          <span>
            {tile.changePct !== null
              ? t(`trend_${tile.trend}`, { pct: formatStat(tile.changePct, 'PERCENT') })
              : t('trendNone')}
          </span>
        </p>
      ) : null}
      {tile.spark ? <Spark values={tile.spark.map((s) => Number(s.value) || 0)} /> : null}
    </>
  );
  const box =
    'flex min-h-28 flex-col gap-1 rounded-xl border bg-card p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';
  return tile.link ? (
    <Link href={tile.link} className={cn(box, 'hover:bg-accent active:bg-accent')}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** Rows of a "by dimension" answer as chart rows for one measure. */
export function dimensionRows(
  dto: StatsByDimensionDto,
  measures: StatMeasure[],
  name: (key: string | null, label: string | null) => string,
): (ChartRow & { link: string | null })[] {
  return dto.rows.map((r) => ({
    id: r.key ?? '∅',
    label: name(r.key, r.label),
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

/**
 * One dimension (dépôt, wilaya, famille, segment…): bars of `chartMeasure`, and the table
 * of `tableMeasures` with the "Autres" row and the total. A bar opens the list behind it.
 */
export function DimensionBlock({
  state,
  dimension,
  title,
  chartMeasure = 'caTtc',
  tableMeasures,
  limit = 12,
}: {
  state: StatsState;
  dimension: StatDimension;
  title: string;
  chartMeasure?: StatMeasure;
  tableMeasures: StatMeasure[];
  /** Bars drawn (the table has every row). */
  limit?: number;
}) {
  const t = useTranslations('stats');
  const labels = useStatLabels();
  const router = useRouter();
  const query = statsQuery(state, { dimension });
  const res = useStats<StatsByDimensionDto>('by-dimension', query);
  if (res.isError) return <ErrorBlock error={res.error} />;
  const dto = res.data;
  if (!dto) return <Skeleton className="h-64" />;
  const name = (key: string | null, label: string | null) =>
    labels.dimensionKey(dimension, key, label);
  const rows = dimensionRows(dto, [chartMeasure], name);
  const cellText = (cells: StatCell[], m: StatMeasure) => {
    const c = cellOf(cells, m);
    return <Num>{formatStat(c?.value ?? null, c?.unit ?? 'COUNT')}</Num>;
  };
  const table = (
    <StatTable
      caption={title}
      head={[t('colName'), ...tableMeasures.map((m) => labels.measure(m))]}
      rows={[
        ...dto.rows.map((r) => ({
          key: r.key ?? '∅',
          cells: [
            r.link ? (
              <Link key="n" href={r.link} className="underline-offset-4 hover:underline">
                {name(r.key, r.label)}
              </Link>
            ) : (
              name(r.key, r.label)
            ),
            ...tableMeasures.map((m) => cellText(r.cells, m)),
          ],
        })),
        ...(dto.others
          ? [
              {
                key: '__others',
                cells: [
                  t('others', { count: dto.others.count }),
                  ...tableMeasures.map((m) => cellText(dto.others!.cells, m)),
                ],
              },
            ]
          : []),
      ]}
      foot={[t('total'), ...tableMeasures.map((m) => cellText(dto.totals, m))]}
    />
  );
  return (
    <StatPanel
      title={title}
      definition={labels.definition(chartMeasure)}
      note={<MetaNote meta={dto} cells={dto.totals} />}
      chart={
        rows.length === 0 ? undefined : (
          <RankBarChart
            rows={rows.slice(0, limit)}
            series={[{ key: chartMeasure, label: labels.measure(chartMeasure) }]}
            onSelect={(row) => {
              const link = rows.find((r) => r.id === row.id)?.link;
              if (link) router.push(link);
            }}
          />
        )
      }
      table={rows.length === 0 ? <Empty /> : table}
      onExport={() => downloadStats('by-dimension', query)}
    />
  );
}

export function Empty() {
  const t = useTranslations('stats');
  return <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>;
}
