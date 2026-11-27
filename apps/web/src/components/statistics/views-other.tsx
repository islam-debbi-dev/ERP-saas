'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  type StatDimension,
  type StatDocumentRef,
  type StatMeasure,
  type StatsDispersionDto,
  type StatsLostClientsDto,
  type StatsVehicleDayDto,
  type StatsVisitsDto,
} from '@erp/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  cellOf,
  downloadStats,
  formatStat,
  plotValue,
  type StatsState,
  type StatsUrl,
  statsQuery,
  useStats,
} from '@/lib/distribution-stats';
import { useVehicles } from '@/lib/vehicles';
import { cn } from '@/lib/utils';
import { DimensionBlock, Empty, ErrorBlock, LoadingBlock, MetaNote, useStatLabels } from './common';
import { type ChartRow, DonutChart, Num, RankBarChart, StatPanel, StatTable } from './stat-panel';

/** Chips to pick one dimension (wrap on a phone, never scroll sideways). */
function DimensionChips({
  options,
  value,
  onChange,
}: {
  options: StatDimension[];
  value: StatDimension;
  onChange: (d: StatDimension) => void;
}) {
  const t = useTranslations('stats');
  return (
    <div
      role="group"
      aria-label={t('groupBy')}
      className="flex flex-wrap gap-1 rounded-lg border bg-card p-1"
    >
      {options.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={value === d}
          onClick={() => onChange(d)}
          className={cn(
            'inline-flex min-h-11 grow items-center justify-center rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:grow-0',
            value === d ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
          )}
        >
          {t(`dim_${d}`)}
        </button>
      ))}
    </div>
  );
}

const ZONE_MEASURES: StatMeasure[] = [
  'caTtc',
  'nbBl',
  'dropSize',
  'weightT',
  'versements',
  'activeClients',
];

// ---------------------------------------------------------------- 3. Types & zones

export function ZonesView({ state }: { state: StatsState }) {
  const [dimension, setDimension] = useState<StatDimension>('vehicleType');
  const t = useTranslations('stats');
  return (
    <div className="space-y-4">
      <DimensionChips
        options={[
          'vehicleType',
          'activity',
          'depot',
          'vehicleWilaya',
          'clientWilaya',
          'clientDaira',
          'clientCommune',
        ]}
        value={dimension}
        onChange={setDimension}
      />
      <DimensionBlock
        key={dimension}
        state={state}
        dimension={dimension}
        title={t(`byDim_${dimension}`)}
        tableMeasures={ZONE_MEASURES}
      />
    </div>
  );
}

// ---------------------------------------------------------------- 4. Produits

export function ProductsView({ state }: { state: StatsState }) {
  const [dimension, setDimension] = useState<StatDimension>('category');
  const t = useTranslations('stats');
  return (
    <div className="space-y-4">
      <DimensionChips
        options={['category', 'subCategory', 'brand', 'product']}
        value={dimension}
        onChange={setDimension}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <DimensionBlock
          key={`${dimension}-ca`}
          state={state}
          dimension={dimension}
          title={t(`byDim_${dimension}`)}
          tableMeasures={['caTtc', 'weightT', 'nbBl', 'activeClients']}
        />
        <DimensionBlock
          key={`${dimension}-w`}
          state={state}
          dimension={dimension}
          title={t('weightBy', { dim: t(`dim_${dimension}`) })}
          chartMeasure="weightT"
          tableMeasures={['weightT', 'caTtc']}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 5. Clients

export function ClientsView({ state }: { state: StatsState }) {
  const t = useTranslations('stats');
  const lost = useStats<StatsLostClientsDto>('lost-clients', statsQuery(state));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <DimensionBlock
          state={state}
          dimension="segment"
          title={t('byDim_segment')}
          tableMeasures={['caTtc', 'nbBl', 'activeClients', 'dropSize']}
        />
        <DimensionBlock
          state={state}
          dimension="sector"
          title={t('byDim_sector')}
          tableMeasures={['caTtc', 'nbBl', 'activeClients', 'dropSize']}
        />
      </div>
      {lost.isError ? (
        <ErrorBlock error={lost.error} />
      ) : !lost.data ? (
        <Skeleton className="h-40" />
      ) : (
        <StatPanel
          title={t('lostClients')}
          definition={t('def_lostClients')}
          table={
            <div className="space-y-3">
              <dl className="grid grid-cols-3 gap-2 text-center">
                {(
                  [
                    ['activeNow', lost.data.active],
                    ['activeBefore', lost.data.previousActive],
                    ['lostCount', lost.data.count],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="rounded-lg border p-2">
                    <dt className="text-xs text-muted-foreground">{t(k)}</dt>
                    <dd className="text-lg font-semibold">
                      <Num>{formatStat(String(v), 'COUNT')}</Num>
                    </dd>
                  </div>
                ))}
              </dl>
              {lost.data.clients.length === 0 ? (
                <Empty />
              ) : (
                <StatTable
                  caption={t('lostClients')}
                  head={[t('colClient'), t('previousCa')]}
                  rows={lost.data.clients.map((c) => ({
                    key: c.id,
                    cells: [
                      <Link key="c" href={c.link} className="underline-offset-4 hover:underline">
                        {c.name}
                      </Link>,
                      <Num key="a">{formatStat(c.previousCaTtc, 'DA')}</Num>,
                    ],
                  }))}
                />
              )}
            </div>
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 6. Visites

const FUNNEL: StatMeasure[] = ['visitsPlanned', 'visitsDone', 'visitsSuccess'];

export function VisitsView({ state }: { state: StatsState }) {
  const t = useTranslations('stats');
  const labels = useStatLabels();
  const router = useRouter();
  const query = statsQuery(state);
  const res = useStats<StatsVisitsDto>('visits', query);
  if (res.isError) return <ErrorBlock error={res.error} />;
  const dto = res.data;
  if (!dto) return <LoadingBlock />;
  const text = (cells: typeof dto.totals, m: StatMeasure) => {
    const c = cellOf(cells, m);
    return formatStat(c?.value ?? null, c?.unit ?? 'COUNT');
  };
  const rows: (ChartRow & { link: string | null })[] = dto.rows.map((r) => ({
    id: r.vehicle?.id ?? '∅',
    label: labels.vehicle(r.vehicle),
    link: r.link,
    values: Object.fromEntries(FUNNEL.map((m) => [m, plotValue(cellOf(r.cells, m))])),
    display: Object.fromEntries(FUNNEL.map((m) => [m, text(r.cells, m)])),
  }));
  const reasonsTotal = dto.reasons.reduce((n, r) => n + r.count, 0);
  const rates: StatMeasure[] = ['visitRate', 'successPlannedRate', 'successRate'];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[...FUNNEL, ...rates].map((m) => (
          <div key={m} className="rounded-xl border bg-card p-3">
            <p className="text-xs font-medium text-muted-foreground">{labels.measure(m)}</p>
            <p className="text-lg font-semibold">
              <Num>{text(dto.totals, m)}</Num>
            </p>
          </div>
        ))}
      </div>
      {dto.planningKnownFrom === null || dto.planningKnownFrom > state.range.from ? (
        <p className="text-xs text-muted-foreground">
          {dto.planningKnownFrom === null
            ? t('planningNone')
            : t('planningFrom', { day: dto.planningKnownFrom })}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <StatPanel
          title={t('visitFunnel')}
          definition={labels.definition('visitsDone')}
          note={<MetaNote meta={dto} />}
          onExport={() => downloadStats('visits', query)}
          chart={
            rows.length === 0 ? undefined : (
              <RankBarChart
                rows={rows}
                series={FUNNEL.map((m) => ({ key: m, label: labels.measure(m) }))}
                onSelect={(row) => {
                  const link = rows.find((r) => r.id === row.id)?.link;
                  if (link) router.push(link);
                }}
              />
            )
          }
          table={
            rows.length === 0 ? (
              <Empty />
            ) : (
              <StatTable
                caption={t('visitFunnel')}
                head={[t('colVehicle'), ...[...FUNNEL, ...rates].map((m) => labels.measure(m))]}
                rows={dto.rows.map((r) => ({
                  key: r.vehicle?.id ?? '∅',
                  cells: [
                    labels.vehicle(r.vehicle),
                    ...[...FUNNEL, ...rates].map((m) => <Num key={m}>{text(r.cells, m)}</Num>),
                  ],
                }))}
                foot={[
                  t('total'),
                  ...[...FUNNEL, ...rates].map((m) => <Num key={m}>{text(dto.totals, m)}</Num>),
                ]}
              />
            )
          }
        />
        <StatPanel
          title={t('noSaleReasons')}
          chart={
            reasonsTotal === 0 ? undefined : (
              <DonutChart
                slices={dto.reasons.map((r) => ({
                  id: r.reason,
                  label: t(`reason_${r.reason}`),
                  value: r.count,
                  display: formatStat(String(r.count), 'COUNT'),
                }))}
                centre={formatStat(String(reasonsTotal), 'COUNT')}
                centreLabel={labels.measure('visitsNoSale')}
              />
            )
          }
          table={
            reasonsTotal === 0 ? (
              <Empty />
            ) : (
              <StatTable
                caption={t('noSaleReasons')}
                head={[t('colReason'), labels.measure('visitsNoSale')]}
                rows={dto.reasons.map((r) => ({
                  key: r.reason,
                  cells: [
                    t(`reason_${r.reason}`),
                    <Num key="n">{formatStat(String(r.count), 'COUNT')}</Num>,
                  ],
                }))}
              />
            )
          }
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 8. Dispersion

export function DispersionView({ state }: { state: StatsState }) {
  const t = useTranslations('stats');
  const labels = useStatLabels();
  const query = statsQuery(state);
  const res = useStats<StatsDispersionDto>('dispersion', query);
  if (res.isError) return <ErrorBlock error={res.error} />;
  const dto = res.data;
  if (!dto) return <LoadingBlock />;
  const max = Number(dto.maxCaTtc) || 0;
  // Five steps of one hue; the number in the cell is the first clue, the colour the second.
  const level = (ca: string) => {
    const v = Number(ca) || 0;
    if (v <= 0 || max === 0) return 0;
    return Math.min(4, Math.ceil((v / max) * 4));
  };
  const shades = ['', 'bg-chart-2/15', 'bg-chart-2/30', 'bg-chart-2/50', 'bg-chart-2/70'];
  return (
    <StatPanel
      title={t('dispersionTitle')}
      definition={t('def_dispersion')}
      onExport={() => downloadStats('dispersion', query)}
      table={
        dto.rows.length === 0 ? (
          <Empty />
        ) : (
          <div data-scroll-x="" className="max-w-full overflow-x-auto rounded-md border">
            <table className="text-xs">
              <caption className="sr-only">{t('dispersionTitle')}</caption>
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th scope="col" className="sticky start-0 bg-muted px-2 py-2 text-start">
                    {t('colVehicle')}
                  </th>
                  {dto.days.map((d) => (
                    <th key={d} scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                      <Num>{d.slice(8)}</Num>
                    </th>
                  ))}
                  <th scope="col" className="px-2 py-2 text-end">
                    {t('total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {dto.rows.map((r) => (
                  <tr key={r.vehicle?.id ?? '∅'} className="border-t">
                    <th
                      scope="row"
                      className="sticky start-0 max-w-32 truncate bg-card px-2 py-1.5 text-start font-medium"
                    >
                      {labels.vehicle(r.vehicle)}
                    </th>
                    {r.cells.map((c, i) => (
                      <td
                        key={dto.days[i]}
                        className={cn(
                          'num px-2 py-1.5 text-end whitespace-nowrap',
                          shades[level(c.caTtc)],
                        )}
                        title={`${formatStat(c.caTtc, 'DA')} · ${c.nbBl} BL`}
                      >
                        <Num>{c.nbBl === 0 ? '·' : formatCompact(c.caTtc)}</Num>
                      </td>
                    ))}
                    <td className="num px-2 py-1.5 text-end font-semibold whitespace-nowrap">
                      <Num>{formatStat(r.caTtc, 'DA')}</Num>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      note={t('dispersionNote')}
    />
  );
}

/** "12,4 k" for a cell of the heat table; the full amount is in the export and the total. */
function formatCompact(ca: string): string {
  const v = Number(ca) || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.', ',')} M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1).replace('.', ',')} k`;
  return String(Math.round(v));
}

// ---------------------------------------------------------------- 10. Journée véhicule

export function DayView({
  state,
  setUrl,
}: {
  state: StatsState;
  setUrl: (p: Partial<StatsUrl>) => void;
}) {
  const t = useTranslations('stats');
  const labels = useStatLabels();
  const vehicles = useVehicles();
  const vehicleId = state.vehicleId || vehicles.data?.[0]?.id || '';
  const query = new URLSearchParams({ vehicleId, date: state.date }).toString();
  const res = useStats<StatsVehicleDayDto>('vehicle-day', query, vehicleId !== '');
  const dto = res.data;
  const docs = (title: string, list: StatDocumentRef[], extra?: (d: StatDocumentRef) => string) =>
    list.length === 0 ? null : (
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <ul className="divide-y rounded-md border text-sm">
          {list.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
              <Link
                href={d.link}
                className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
              >
                {d.number ?? t('draft')}
              </Link>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {[d.party, extra?.(d)].filter(Boolean).join(' · ')}
              </span>
              {d.amount !== null ? <Num>{formatStat(d.amount, 'DA')}</Num> : null}
              {d.weightKg !== null ? (
                <Num className="text-muted-foreground">{formatStat(d.weightKg, 'QTY')} kg</Num>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="day-vehicle">{t('colVehicle')}</Label>
          <select
            id="day-vehicle"
            value={vehicleId}
            onChange={(e) => setUrl({ vehicleId: e.target.value })}
            className="h-11 w-full rounded-md border bg-background px-3 text-base"
          >
            {(vehicles.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.code ? `${v.code} · ${v.name}` : v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="day-date">{t('day')}</Label>
          <Input
            id="day-date"
            type="date"
            dir="ltr"
            className="h-11 text-base"
            value={state.date}
            onChange={(e) => setUrl({ date: e.target.value })}
          />
        </div>
      </div>
      {vehicleId === '' ? (
        <Empty />
      ) : res.isError ? (
        <ErrorBlock error={res.error} />
      ) : !dto ? (
        <LoadingBlock />
      ) : (
        <StatPanel
          title={t('dayTitle', { vehicle: labels.vehicle(dto.vehicle), day: dto.date })}
          onExport={() => downloadStats('vehicle-day', query)}
          table={
            <div className="space-y-4">
              {dto.drivers.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {dto.drivers.map((d) => d.fullName).join(', ')}
                </p>
              ) : null}
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {dto.cells
                  .filter((c) => c.value !== null)
                  .map((c) => (
                    <div key={c.measure} className="rounded-lg border p-2">
                      <dt className="text-xs text-muted-foreground">{labels.measure(c.measure)}</dt>
                      <dd className="font-semibold">
                        <Num>{formatStat(c.value, c.unit)}</Num>
                      </dd>
                    </div>
                  ))}
              </dl>
              <section className="space-y-1">
                <h3 className="text-sm font-semibold">{t('cash')}</h3>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  {(['expected', 'handed', 'ecart'] as const).map((k) => (
                    <div key={k} className="rounded-lg border p-2">
                      <dt className="text-xs text-muted-foreground">{t(`cash_${k}`)}</dt>
                      <dd>
                        <Num>{formatStat(dto.cash[k], 'DA')}</Num>
                      </dd>
                    </div>
                  ))}
                </dl>
                {!dto.cash.closed ? (
                  <p className="text-xs text-muted-foreground">{t('cashOpen')}</p>
                ) : null}
              </section>
              {docs(t('loads'), dto.loads)}
              {docs(t('sales'), dto.sales)}
              {docs(t('returns'), dto.returns, (d) =>
                (d as StatDocumentRef & { damaged: boolean }).damaged ? t('damaged') : '',
              )}
              {docs(t('unloads'), dto.unloads)}
              {docs(t('payments'), dto.payments)}
            </div>
          }
        />
      )}
    </div>
  );
}
