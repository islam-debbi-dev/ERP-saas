'use client';

import { CalendarRange, SlidersHorizontal, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useState } from 'react';
import {
  type CategoryDto,
  Feature,
  MAX_REPORT_DAYS,
  rangeLength,
  STAT_COMPARES,
  type StatCompare,
  type StatFilterKey,
  VEHICLE_ACTIVITIES,
  WarehouseType,
  WILAYAS,
} from '@erp/shared';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useCategories } from '@/lib/catalog';
import {
  filterCount,
  STAT_PERIODS,
  STAT_VIEWS,
  type StatPeriod,
  type StatsState,
  type StatsUrl,
  type StatView,
  useClientSegments,
  useHasDistributionStats,
  useStatsState,
} from '@/lib/distribution-stats';
import { useBrands, useSectors } from '@/lib/sales-force';
import { useWarehouses } from '@/lib/stock';
import { cn } from '@/lib/utils';
import { useVehicleTypes } from '@/lib/vehicles';
import { GlobalView, OrdersView, TargetsView, VehiclesView } from './views-vehicles';
import {
  ClientsView,
  DispersionView,
  DayView,
  ProductsView,
  VisitsView,
  ZonesView,
} from './views-other';

/** /statistiques (phase 37): the director's screen of the distribution. */
export function StatisticsPage() {
  return (
    <FeatureGate feature={Feature.DISTRIBUTION_STATS}>
      <Statistics />
    </FeatureGate>
  );
}

function Statistics() {
  const t = useTranslations('stats');
  const allowed = useHasDistributionStats();
  const [state, setUrl] = useStatsState();
  if (!allowed) {
    return (
      <>
        <PageHeader title={t('title')} />
        <p className="rounded-md border p-4 text-sm">{t('notAllowed')}</p>
      </>
    );
  }
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <FilterBar state={state} setUrl={setUrl} />
      <ViewSwitch
        value={state.view}
        onChange={(view) => setUrl({ view: view === 'global' ? '' : view })}
      />
      <section aria-live="polite" className="min-w-0">
        <ViewBody state={state} setUrl={setUrl} />
      </section>
    </>
  );
}

function ViewBody({
  state,
  setUrl,
}: {
  state: StatsState;
  setUrl: (p: Partial<StatsUrl>) => void;
}) {
  switch (state.view) {
    case 'vehicles':
      return <VehiclesView state={state} />;
    case 'zones':
      return <ZonesView state={state} />;
    case 'products':
      return <ProductsView state={state} />;
    case 'clients':
      return <ClientsView state={state} />;
    case 'visits':
      return <VisitsView state={state} />;
    case 'orders':
      return <OrdersView state={state} />;
    case 'dispersion':
      return <DispersionView state={state} />;
    case 'targets':
      return <TargetsView state={state} />;
    case 'day':
      return <DayView state={state} setUrl={setUrl} />;
    default:
      return <GlobalView state={state} />;
  }
}

/** A select on a phone, tabs from md. */
function ViewSwitch({ value, onChange }: { value: StatView; onChange: (v: StatView) => void }) {
  const t = useTranslations('stats');
  return (
    <>
      <div className="md:hidden">
        <Label htmlFor="stats-view" className="sr-only">
          {t('view')}
        </Label>
        <select
          id="stats-view"
          value={value}
          onChange={(e) => onChange(e.target.value as StatView)}
          className="h-11 w-full rounded-md border bg-background px-3 text-base"
        >
          {STAT_VIEWS.map((v) => (
            <option key={v} value={v}>
              {t(`view_${v}`)}
            </option>
          ))}
        </select>
      </div>
      <div
        role="tablist"
        aria-label={t('view')}
        className="hidden flex-wrap gap-1 border-b md:flex"
      >
        {STAT_VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={value === v}
            onClick={() => onChange(v)}
            className={cn(
              '-mb-px min-h-11 border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              value === v
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`view_${v}`)}
          </button>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- filter bar

function FilterBar({
  state,
  setUrl,
}: {
  state: StatsState;
  setUrl: (p: Partial<StatsUrl>) => void;
}) {
  const t = useTranslations('stats');
  const [customOpen, setCustomOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const count = filterCount(state.filters);
  const pick = (p: StatPeriod) => {
    if (p === 'custom') setCustomOpen(true);
    else setUrl({ period: p === 'month' ? '' : p, from: '', to: '' });
  };
  return (
    <div className="sticky top-14 z-20 -mx-4 space-y-2 border-b bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:-mx-6 lg:px-6">
      <div role="group" aria-label={t('period')} className="flex flex-wrap gap-1">
        {STAT_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={state.period === p}
            onClick={() => pick(p)}
            className={cn(
              'inline-flex min-h-11 grow items-center justify-center gap-1 rounded-md border px-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:grow-0',
              state.period === p
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card hover:bg-accent',
            )}
          >
            {p === 'custom' ? <CalendarRange className="size-4" aria-hidden /> : null}
            {t(`period_${p}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="stats-compare" className="text-sm">
          {t('compare')}
        </Label>
        <select
          id="stats-compare"
          value={state.compare}
          onChange={(e) => setUrl({ compare: e.target.value === 'previous' ? '' : e.target.value })}
          className="h-11 rounded-md border bg-background px-2 text-base"
        >
          {STAT_COMPARES.map((c: StatCompare) => (
            <option key={c} value={c}>
              {t(`compare_${c}`)}
            </option>
          ))}
        </select>
        <Button variant="outline" className="ms-auto min-h-11" onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal aria-hidden />
          {t('filters', { count })}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        <bdi dir="ltr" className="num">
          {state.range.from === state.range.to
            ? state.range.from
            : `${state.range.from} → ${state.range.to}`}
        </bdi>
      </p>
      <CustomRange
        open={customOpen}
        onOpenChange={setCustomOpen}
        initial={state.range}
        onApply={(r) => setUrl({ period: 'custom', from: r.from, to: r.to })}
      />
      <FilterSheet open={sheetOpen} onOpenChange={setSheetOpen} state={state} setUrl={setUrl} />
    </div>
  );
}

function CustomRange({
  open,
  onOpenChange,
  initial,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: { from: string; to: string };
  onApply: (r: { from: string; to: string }) => void;
}) {
  const t = useTranslations('stats');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const invalid =
    from === '' || to === '' || from > to || rangeLength({ from, to }) > MAX_REPORT_DAYS;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    onApply({ from, to });
    onOpenChange(false);
  };
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('period_custom')}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="grid gap-3 px-4 sm:grid-cols-2 md:px-0">
            <div className="space-y-1">
              <Label htmlFor="stats-from">{t('from')}</Label>
              <Input
                id="stats-from"
                type="date"
                dir="ltr"
                className="h-11 text-base"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="stats-to">{t('to')}</Label>
              <Input
                id="stats-to"
                type="date"
                dir="ltr"
                className="h-11 text-base"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            {invalid && from !== '' && to !== '' ? (
              <p className="text-sm text-destructive sm:col-span-2">
                {t('rangeInvalid', { days: MAX_REPORT_DAYS })}
              </p>
            ) : null}
          </div>
          <ResponsiveDialogFooter>
            <Button type="submit" className="min-h-11" disabled={invalid}>
              {t('apply')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

type Option = { id: string; label: string };

function flatCategories(list: CategoryDto[], depth = 0): Option[] {
  return list.flatMap((c) => [
    { id: c.id, label: `${depth > 0 ? '— ' : ''}${c.name}` },
    ...flatCategories(c.children ?? [], depth + 1),
  ]);
}

function FilterSheet({
  open,
  onOpenChange,
  state,
  setUrl,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  state: StatsState;
  setUrl: (p: Partial<StatsUrl>) => void;
}) {
  const t = useTranslations('stats');
  const locale = useLocale();
  const warehouses = useWarehouses();
  const types = useVehicleTypes();
  const brands = useBrands();
  const sectors = useSectors();
  const categories = useCategories();
  const segments = useClientSegments(open);
  const [draft, setDraft] = useState<StatsState['filters']>(state.filters);
  const [clientWilaya, setClientWilaya] = useState('');
  const all = warehouses.data ?? [];
  const groups: {
    key: Exclude<StatFilterKey, 'clientWilayas' | 'productIds' | 'clientIds'>;
    options: Option[];
  }[] = [
    {
      key: 'warehouseIds',
      options: all
        .filter((w) => w.type !== WarehouseType.VEHICLE)
        .map((w) => ({ id: w.id, label: w.name })),
    },
    {
      key: 'vehicleIds',
      options: all
        .filter((w) => w.type === WarehouseType.VEHICLE)
        .map((w) => ({ id: w.id, label: w.code ? `${w.code} · ${w.name}` : w.name })),
    },
    {
      key: 'vehicleTypeIds',
      options: (types.data ?? []).map((x) => ({ id: x.id, label: x.name })),
    },
    {
      key: 'activities',
      options: VEHICLE_ACTIVITIES.map((a) => ({ id: a, label: t(`activity_${a}`) })),
    },
    {
      key: 'vehicleWilayas',
      options: WILAYAS.map((w) => ({
        id: String(w.code),
        label: `${w.code} · ${locale === 'ar' ? w.ar : w.fr}`,
      })),
    },
    { key: 'categoryIds', options: flatCategories(categories.data ?? []) },
    { key: 'brandIds', options: (brands.data ?? []).map((b) => ({ id: b.id, label: b.name })) },
    {
      key: 'segmentIds',
      options: (segments.data ?? [])
        .filter((s) => !s.archived)
        .map((s) => ({ id: s.id, label: s.name })),
    },
    { key: 'sectorIds', options: (sectors.data ?? []).map((s) => ({ id: s.id, label: s.name })) },
  ];
  const toggle = (key: StatFilterKey, id: string) =>
    setDraft((d) => {
      const current = d[key] ?? [];
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      return { ...d, [key]: next };
    });
  const apply = () => {
    const patch: Partial<StatsUrl> = {};
    for (const key of [
      ...groups.map((g) => g.key),
      'clientWilayas',
      'productIds',
      'clientIds',
    ] as StatFilterKey[]) {
      patch[key] = (draft[key] ?? []).join(',');
    }
    setUrl(patch);
    onOpenChange(false);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(state.filters);
        onOpenChange(o);
      }}
    >
      <SheetContent side="end" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('filtersTitle')}</SheetTitle>
        </SheetHeader>
        <div className="space-y-2 px-4">
          {groups
            .filter((g) => g.options.length > 0)
            .map((g) => (
              <FilterGroup
                key={g.key}
                title={t(`filter_${g.key}`)}
                count={draft[g.key]?.length ?? 0}
              >
                <ul className="max-h-60 space-y-0.5 overflow-y-auto">
                  {g.options.map((o) => {
                    const id = `f-${g.key}-${o.id}`;
                    return (
                      <li key={o.id}>
                        <label
                          htmlFor={id}
                          className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-accent"
                        >
                          <input
                            id={id}
                            type="checkbox"
                            className="size-4"
                            checked={draft[g.key]?.includes(o.id) ?? false}
                            onChange={() => toggle(g.key, o.id)}
                          />
                          <span className="min-w-0 truncate text-sm">{o.label}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </FilterGroup>
            ))}
          <FilterGroup title={t('filter_clientWilayas')} count={draft.clientWilayas?.length ?? 0}>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Label htmlFor="f-client-wilaya" className="sr-only">
                  {t('filter_clientWilayas')}
                </Label>
                <Input
                  id="f-client-wilaya"
                  className="h-11 text-base"
                  value={clientWilaya}
                  placeholder={t('clientWilayaHint')}
                  onChange={(e) => setClientWilaya(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={clientWilaya.trim() === ''}
                  onClick={() => {
                    toggle('clientWilayas', clientWilaya.trim());
                    setClientWilaya('');
                  }}
                >
                  {t('add')}
                </Button>
              </div>
              <ul className="flex flex-wrap gap-1">
                {(draft.clientWilayas ?? []).map((w) => (
                  <li key={w}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="min-h-11"
                      aria-label={t('remove', { value: w })}
                      onClick={() => toggle('clientWilayas', w)}
                    >
                      {w}
                      <X aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </FilterGroup>
          {(draft.productIds?.length ?? 0) + (draft.clientIds?.length ?? 0) > 0 ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => setDraft((d) => ({ ...d, productIds: [], clientIds: [] }))}
            >
              {t('clearLinkFilters')}
            </Button>
          ) : null}
        </div>
        <SheetFooter className="sticky bottom-0 flex-row gap-2 border-t bg-background pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button variant="ghost" className="min-h-11" onClick={() => setDraft({})}>
            {t('clearFilters')}
          </Button>
          <Button className="ms-auto min-h-11" onClick={apply}>
            {t('apply')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FilterGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="rounded-md border px-2 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-medium">
        <span>{title}</span>
        {count > 0 ? (
          <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">
            <bdi dir="ltr">{count}</bdi>
          </span>
        ) : null}
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}
