'use client';

import { Crosshair, ListFilter, Loader2, MapPinned, Route } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type CSSProperties, useMemo, useRef, useState } from 'react';
import {
  type ClientNearbyPointDto,
  Feature,
  haversineM,
  type LatLng,
  OFFICE_ROLES,
  isFieldSeller,
} from '@erp/shared';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Switch } from '@/components/ui/switch';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useRemainingHeight } from '@/hooks/use-remaining-height';
import { useAuth, useFeature } from '@/lib/auth';
import {
  type ClientMapFilters,
  pointState,
  useClientMapByView,
  useMyPosition,
} from '@/lib/client-map';
import { useSectors, useSellers } from '@/lib/sales-force';
import { useErrorMessage } from '@/lib/use-error-message';
import { AddToRouteDialog } from './add-to-route-dialog';
import { ClientsMap, MapLegend } from './clients-map-lazy';
import { NearbySheet } from './nearby-sheet';
import { type BubbleClient, PointBubble } from './point-bubble';

const PLANNERS = new Set<string>(OFFICE_ROLES);

interface FilterState {
  search: string;
  sectorId: string;
  sellerId: string;
  hasDebt: boolean;
  overLimit: boolean;
  includeInactive: boolean;
}
const NO_FILTERS: FilterState = {
  search: '',
  sectorId: '',
  sellerId: '',
  hasDebt: false,
  overLimit: false,
  includeInactive: false,
};

/** Clients > Carte (phase 35): where the clients are, who is near a point. */
export function ClientsMapScreen() {
  return (
    <FeatureGate feature={Feature.GEO_CHECK}>
      <Screen />
    </FeatureGate>
  );
}

type Selected = BubbleClient & { assignedSellerId: string | null };

function Screen() {
  const t = useTranslations('clientMap');
  const errorMessage = useErrorMessage();
  const role = useAuth().state.user?.role;
  const canPlan = useFeature(Feature.TOURNEES) && !!role && PLANNERS.has(role);
  const [f, setF] = useState<FilterState>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const search = useDebouncedValue(f.search.trim(), 300);
  const filters: ClientMapFilters = useMemo(
    () => ({
      search,
      sectorId: f.sectorId,
      assignedSellerId: f.sellerId,
      hasDebt: f.hasDebt,
      overLimit: f.overLimit,
      includeInactive: f.includeInactive,
    }),
    [search, f.sectorId, f.sellerId, f.hasDebt, f.overLimit, f.includeInactive],
  );
  const filterKey = JSON.stringify(filters);

  // Above the cap the map asks for the current view only (bounds of the last pan / zoom,
  // debounced in the map). Back to the whole scope when the filters change.
  const { map, onBoundsChange } = useClientMapByView(filters);
  const truncated = map.data?.truncated ?? false;

  const points = useMemo(
    () => (map.data?.points ?? []).map((p) => ({ ...p, state: pointState(p) })),
    [map.data],
  );
  const [selected, setSelected] = useState<Selected | null>(null);
  const [focus, setFocus] = useState<(LatLng & { zoom?: number }) | null>(null);
  const me = useMyPosition();
  const [nearby, setNearby] = useState<{
    center: LatLng;
    around: string;
    accuracyM?: number;
  } | null>(null);
  const [nearbyOpen, setNearbyOpen] = useState(false);
  const [radiusM, setRadiusM] = useState(5000);
  const [addTo, setAddTo] = useState<Selected | null>(null);

  const select = (id: string) => {
    const p = points.find((x) => x.id === id);
    if (p) setSelected(p);
  };
  const nearMe = async () => {
    const pos = me.position ?? (await me.locate());
    if (!pos) return;
    setFocus({ lat: pos.lat, lng: pos.lng, zoom: 14 });
    setNearby({ center: pos, around: t('aroundMe'), accuracyM: pos.accuracyM });
    setNearbyOpen(true);
  };
  const showFromList = (c: ClientNearbyPointDto) => {
    setNearbyOpen(false);
    setSelected({ ...c, state: pointState(c) });
    setFocus({ lat: c.lat, lng: c.lng, zoom: 16 });
  };

  const active =
    Number(f.sectorId !== '') +
    Number(f.sellerId !== '') +
    Number(f.hasDebt) +
    Number(f.overLimit) +
    Number(f.includeInactive) +
    Number(search !== '');

  const distance =
    selected && me.position ? Math.round(haversineM(me.position, selected)) : undefined;

  // Phone: the map takes what is left of the screen under the buttons, legend included.
  const legendRef = useRef<HTMLDivElement>(null);
  const [mapBoxRef, mapHeight] = useRemainingHeight<HTMLDivElement>({ below: legendRef });

  return (
    <>
      {/* Phone: the top bar already gives the title; the screen goes to the map. */}
      <PageHeader title={t('title')} description={t('subtitle')} className="max-md:sr-only" />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="h-11 md:hidden" onClick={() => setFiltersOpen(true)}>
          <ListFilter aria-hidden />
          {t('filters')}
          {active > 0 ? (
            <Badge variant="secondary" className="num">
              {active}
            </Badge>
          ) : null}
        </Button>
        <Button className="h-11" onClick={() => void nearMe()} disabled={me.status === 'locating'}>
          {me.status === 'locating' ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Crosshair aria-hidden />
          )}
          {t('nearMe')}
        </Button>
        {map.isFetching ? (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label={t('loading')}
          />
        ) : null}
      </div>
      {me.status === 'denied' || me.status === 'unavailable' ? (
        <Alert role="status">
          <AlertDescription>
            {me.status === 'denied' ? t('positionDenied') : t('positionUnavailable')}
          </AlertDescription>
        </Alert>
      ) : null}
      {map.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(map.error)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="hidden space-y-4 md:block" aria-label={t('filters')}>
          <MapFilters value={f} onChange={setF} idPrefix="side" />
        </aside>
        <div className="space-y-2">
          <div
            ref={mapBoxRef}
            // `isolate`: what is drawn over the map (z-1000, above Leaflet's panes) must
            // stay under the sheets and dialogs of the page.
            className="relative isolate"
            style={mapHeight ? ({ '--map-h': `${mapHeight}px` } as CSSProperties) : undefined}
          >
            {/* Over the map, not above it: each row above costs the map its height on a
                phone. Physical left inset: the zoom buttons stay top-left in Arabic too. */}
            {truncated || (map.data && map.data.withoutLocation > 0) ? (
              <div className="pointer-events-none absolute top-2 right-2 left-14 z-[1000] flex flex-col items-end gap-1.5">
                {truncated ? (
                  <p
                    role="status"
                    className="pointer-events-auto rounded-md border bg-background/95 px-2.5 py-1.5 text-xs shadow-sm"
                  >
                    {t('truncated', { max: '2 000' })}
                  </p>
                ) : null}
                {map.data && map.data.withoutLocation > 0 ? (
                  <Link
                    href="/clients?hasLocation=false"
                    className="pointer-events-auto inline-flex min-h-11 items-center rounded-md border bg-background/95 px-3 text-sm font-medium text-primary underline-offset-4 shadow-sm hover:underline"
                  >
                    {t('withoutLocation', { count: map.data.withoutLocation })}
                  </Link>
                ) : null}
              </div>
            ) : null}
            <ClientsMap
              className="h-[var(--map-h,calc(100svh-15rem))] min-h-60 w-full md:h-[calc(100svh-12rem)] md:min-h-80"
              points={points}
              selectedId={selected?.id ?? null}
              onSelect={select}
              me={me.position}
              fitKey={filterKey}
              focus={focus}
              onBoundsChange={onBoundsChange}
            />
            {selected ? (
              <PointBubble
                client={selected}
                distanceM={distance}
                onClose={() => setSelected(null)}
                extra={
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-11"
                      onClick={() => {
                        setNearby({ center: selected, around: selected.name });
                        setNearbyOpen(true);
                      }}
                    >
                      <MapPinned aria-hidden />
                      {t('nearThisClient')}
                    </Button>
                    {canPlan ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-11"
                        onClick={() => setAddTo(selected)}
                      >
                        <Route aria-hidden />
                        {t('addToRoute')}
                      </Button>
                    ) : null}
                  </>
                }
              />
            ) : null}
          </div>
          <div ref={legendRef}>
            <MapLegend states={['normal', 'debt', 'over', 'inactive']} />
          </div>
        </div>
      </div>

      {filtersOpen ? (
        <ResponsiveDialog open onOpenChange={setFiltersOpen}>
          <ResponsiveDialogContent className="md:max-w-md">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{t('filters')}</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            <MapFilters value={f} onChange={setF} idPrefix="sheet" />
            <div className="flex gap-2">
              <Button variant="ghost" className="h-11" onClick={() => setF(NO_FILTERS)}>
                {t('clearFilters')}
              </Button>
              <Button className="ms-auto h-11" onClick={() => setFiltersOpen(false)}>
                {t('showResults')}
              </Button>
            </div>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      ) : null}

      <NearbySheet
        open={nearbyOpen}
        onOpenChange={setNearbyOpen}
        center={nearby?.center ?? null}
        accuracyM={nearby?.accuracyM}
        around={nearby?.around ?? ''}
        filters={filters}
        radiusM={radiusM}
        onRadiusChange={setRadiusM}
        onShow={showFromList}
      />
      {addTo ? (
        <AddToRouteDialog client={addTo} open onOpenChange={(o) => !o && setAddTo(null)} />
      ) : null}
    </>
  );
}

function MapFilters({
  value,
  onChange,
  idPrefix,
}: {
  value: FilterState;
  onChange: (f: FilterState) => void;
  idPrefix: string;
}) {
  const t = useTranslations('clientMap');
  const tc = useTranslations('clients');
  const salesForce = useFeature(Feature.SALES_FORCE);
  const role = useAuth().state.user?.role;
  const sectors = useSectors();
  const sellers = useSellers({ orderTakers: true });
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor={id('search')}>{tc('searchLabel')}</Label>
        <Input
          id={id('search')}
          type="search"
          value={value.search}
          onChange={(e) => set({ search: e.target.value })}
        />
      </div>
      {salesForce ? (
        <>
          <div className="space-y-1">
            <Label htmlFor={id('sector')}>{tc('filterSector')}</Label>
            <NativeSelect
              id={id('sector')}
              value={value.sectorId}
              onChange={(e) => set({ sectorId: e.target.value })}
            >
              <option value="">{tc('allSectors')}</option>
              {(sectors.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {!role || !isFieldSeller(role) ? (
            <div className="space-y-1">
              <Label htmlFor={id('seller')}>{tc('filterSeller')}</Label>
              <NativeSelect
                id={id('seller')}
                value={value.sellerId}
                onChange={(e) => set({ sellerId: e.target.value })}
              >
                <option value="">{tc('allSellers')}</option>
                {(sellers.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
        </>
      ) : null}
      {(
        [
          ['hasDebt', tc('filterDebt')],
          ['overLimit', tc('filterOverLimit')],
          ['includeInactive', t('includeInactive')],
        ] as const
      ).map(([k, label]) => (
        <div key={k} className="flex min-h-11 items-center gap-3">
          <Switch id={id(k)} checked={value[k]} onCheckedChange={(on) => set({ [k]: on })} />
          <Label htmlFor={id(k)}>{label}</Label>
        </div>
      ))}
    </div>
  );
}
