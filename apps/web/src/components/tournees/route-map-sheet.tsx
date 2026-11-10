'use client';

import { Check, ListPlus, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { RouteStopDto } from '@erp/shared';
import { ROUTE_STOPS_MAX } from '@/components/geo/add-to-route-dialog';
import { ClientsMap, type ClientsMapPoint, MapLegend } from '@/components/geo/clients-map-lazy';
import { type BubbleClient, PointBubble } from '@/components/geo/point-bubble';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Switch } from '@/components/ui/switch';
import { type MapBounds, pointState, useClientMap } from '@/lib/client-map';

export type Stop = RouteStopDto['client'];

const inBounds = (b: MapBounds | null, p: { lat: number; lng: number }) =>
  !b || (p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng);

/**
 * "Choisir sur la carte" (phase 35): tap clients to add or remove them; the stops are the
 * editor's in-memory list, saved by its "Enregistrer" (PUT /routes/:id/stops) as before.
 */
export function RouteMapSheet({
  open,
  onOpenChange,
  sellerId,
  stops,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sellerId: string;
  stops: Stop[];
  onChange: (stops: Stop[]) => void;
}) {
  const t = useTranslations('clientMap');
  const [allMine, setAllMine] = useState(false);
  const map = useClientMap(allMine ? {} : { assignedSellerId: sellerId }, null, open);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const onBoundsChange = useCallback((b: MapBounds) => setBounds(b), []);

  const byId = useMemo(() => new Map((map.data?.points ?? []).map((p) => [p.id, p])), [map.data]);
  const onRoute = useMemo(() => new Map(stops.map((s, i) => [s.id, i + 1])), [stops]);
  const points: ClientsMapPoint[] = useMemo(() => {
    const numbered = stops.flatMap((s, i) => {
      const p = byId.get(s.id);
      const lat = p?.lat ?? s.lat;
      const lng = p?.lng ?? s.lng;
      if (lat === null || lng === null) return [];
      return [
        {
          id: s.id,
          lat,
          lng,
          state: p ? pointState(p) : ('normal' as const),
          number: i + 1,
          title: `${i + 1}. ${s.name}`,
        },
      ];
    });
    const plain = (map.data?.points ?? [])
      .filter((p) => !onRoute.has(p.id))
      .map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, state: pointState(p) }));
    return [...plain, ...numbered];
  }, [stops, byId, map.data, onRoute]);
  const path = useMemo(
    () =>
      stops.flatMap((s) => {
        const p = byId.get(s.id);
        const lat = p?.lat ?? s.lat;
        const lng = p?.lng ?? s.lng;
        return lat !== null && lng !== null ? [{ lat, lng }] : [];
      }),
    [stops, byId],
  );
  const withoutPoint = stops.filter((s) => s.lat === null && !byId.has(s.id)).length;

  const toStop = (id: string): Stop | null => {
    const p = byId.get(id);
    return p
      ? {
          id: p.id,
          code: p.code,
          name: p.name,
          commune: p.commune,
          phone: p.phone,
          lat: p.lat,
          lng: p.lng,
        }
      : null;
  };
  const add = (id: string) => {
    if (onRoute.has(id)) return;
    if (stops.length >= ROUTE_STOPS_MAX) {
      toast.error(t('tooManyStops', { max: ROUTE_STOPS_MAX }));
      return;
    }
    const s = toStop(id);
    if (s) onChange([...stops, s]);
  };
  const remove = (id: string) => onChange(stops.filter((s) => s.id !== id));

  const visible = (map.data?.points ?? []).filter((p) => !onRoute.has(p.id) && inBounds(bounds, p));
  const addVisible = () => {
    if (visible.length === 0) return;
    if (stops.length + visible.length > ROUTE_STOPS_MAX) {
      toast.error(t('tooManyStops', { max: ROUTE_STOPS_MAX }));
      return;
    }
    if (!window.confirm(t('addVisibleConfirm', { count: visible.length }))) return;
    onChange([
      ...stops,
      ...visible.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        commune: p.commune,
        phone: p.phone,
        lat: p.lat,
        lng: p.lng,
      })),
    ]);
  };

  const sel = selectedId ? byId.get(selectedId) : undefined;
  const selStop = selectedId ? stops.find((s) => s.id === selectedId) : undefined;
  const bubble: BubbleClient | null = sel
    ? { ...sel, state: pointState(sel) }
    : selStop && selStop.lat !== null && selStop.lng !== null
      ? { ...selStop, lat: selStop.lat, lng: selStop.lng }
      : null;
  const position = selectedId ? onRoute.get(selectedId) : undefined;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="h-[100svh] max-h-[100svh] gap-3 rounded-none pt-5 md:h-[90svh] md:max-h-[90svh] md:max-w-5xl md:rounded-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('pickTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="max-md:text-xs">
            {t('pickHelp')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex min-h-11 items-center gap-3">
            <Switch id="pick-all" checked={allMine} onCheckedChange={setAllMine} />
            <Label htmlFor="pick-all">{t('allMyClients')}</Label>
          </div>
          <Button
            variant="outline"
            className="h-11"
            disabled={visible.length === 0}
            onClick={addVisible}
          >
            <ListPlus aria-hidden />
            {t('addVisible', { count: visible.length })}
          </Button>
        </div>
        {map.data?.truncated ? (
          <Alert role="status">
            <AlertDescription>{t('truncated', { max: '2 000' })}</AlertDescription>
          </Alert>
        ) : null}
        <div className="relative min-h-40 flex-1">
          <ClientsMap
            className="absolute inset-0"
            points={points}
            selectedId={selectedId}
            onSelect={setSelectedId}
            path={path}
            fitKey={`${allMine}:${map.data ? 'y' : 'n'}`}
            onBoundsChange={onBoundsChange}
            labels={{ stop: t('stop') }}
          />
          {bubble && selectedId ? (
            <PointBubble
              client={bubble}
              status={position ? t('stopNumber', { n: position }) : undefined}
              onClose={() => setSelectedId(null)}
              extra={
                position ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-11"
                    onClick={() => remove(selectedId)}
                  >
                    <Minus aria-hidden />
                    {t('removeFromRoute')}
                  </Button>
                ) : sel ? (
                  <Button size="sm" className="h-11" onClick={() => add(selectedId)}>
                    <Plus aria-hidden />
                    {t('addToThisRoute')}
                  </Button>
                ) : null
              }
            />
          ) : null}
        </div>
        <div className="space-y-1">
          <MapLegend states={['normal', 'debt', 'over', 'inactive']} />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check className="size-3.5" aria-hidden />
            {t('pathNote')}
            {withoutPoint > 0 ? ` ${t('stopsWithoutPoint', { count: withoutPoint })}` : ''}
          </p>
        </div>
        <Button className="h-11 shrink-0" onClick={() => onOpenChange(false)}>
          {t('donePicking')}
          <span role="status" className="num font-normal opacity-90">
            ({t('stopCount', { count: stops.length })})
          </span>
        </Button>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
