'use client';

import { CircleCheck, Crosshair, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { type ClientNearbyPointDto, haversineM, type TodayStopDto } from '@erp/shared';
import { ClientsMap, type ClientsMapPoint } from '@/components/geo/clients-map-lazy';
import { NearbySheet } from '@/components/geo/nearby-sheet';
import { type BubbleClient, PointBubble } from '@/components/geo/point-bubble';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { pointState, useMyPosition } from '@/lib/client-map';

/**
 * The seller's day on a map (phase 35): today's stops numbered in order, a check mark on
 * the ones visited today. "Près de moi" lists his own clients around him (the API scope).
 */
export function TodayMap({
  stops,
  onVisit,
}: {
  stops: TodayStopDto[];
  onVisit: (stop: TodayStopDto) => void;
}) {
  const t = useTranslations('clientMap');
  const tt = useTranslations('tournees');
  const me = useMyPosition();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [extra, setExtra] = useState<BubbleClient | null>(null);
  const [nearOpen, setNearOpen] = useState(false);
  const [radiusM, setRadiusM] = useState(5000);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);

  const located = stops.filter((s) => s.client.lat !== null && s.client.lng !== null);
  const points: ClientsMapPoint[] = stops.flatMap((s, i) =>
    s.client.lat !== null && s.client.lng !== null
      ? [
          {
            id: s.client.id,
            lat: s.client.lat,
            lng: s.client.lng,
            state: 'normal' as const,
            number: i + 1,
            checked: s.visitedToday,
            title: `${i + 1}. ${s.client.name}`,
          },
        ]
      : [],
  );
  const path = located.map((s) => ({ lat: s.client.lat!, lng: s.client.lng! }));
  const index = stops.findIndex((s) => s.client.id === selectedId);
  const stop = index >= 0 ? stops[index] : undefined;
  const bubble: BubbleClient | null =
    stop && stop.client.lat !== null && stop.client.lng !== null
      ? {
          ...stop.client,
          lat: stop.client.lat,
          lng: stop.client.lng,
          balance: stop.balance,
        }
      : extra;

  const nearMe = async () => {
    const pos = me.position ?? (await me.locate());
    if (!pos) return;
    setFocus({ lat: pos.lat, lng: pos.lng, zoom: 14 });
    setNearOpen(true);
  };
  const show = (c: ClientNearbyPointDto) => {
    setNearOpen(false);
    setSelectedId(c.id);
    setExtra({ ...c, state: pointState(c) });
    setFocus({ lat: c.lat, lng: c.lng, zoom: 16 });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-11" onClick={() => void nearMe()} disabled={me.status === 'locating'}>
          {me.status === 'locating' ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Crosshair aria-hidden />
          )}
          {t('nearMe')}
        </Button>
        {located.length < stops.length ? (
          <p className="text-sm text-muted-foreground">
            {t('stopsWithoutPoint', { count: stops.length - located.length })}
          </p>
        ) : null}
      </div>
      {me.status === 'denied' || me.status === 'unavailable' ? (
        <Alert role="status">
          <AlertDescription>
            {me.status === 'denied' ? t('positionDenied') : t('positionUnavailable')}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="relative">
        <ClientsMap
          className="h-[calc(100svh-17rem)] min-h-80 w-full"
          points={points}
          selectedId={selectedId}
          onSelect={(id) => {
            setExtra(null);
            setSelectedId(id);
          }}
          me={me.position}
          path={path}
          fitKey={String(points.length)}
          focus={focus}
          labels={{ stop: t('stop') }}
        />
        {bubble && selectedId ? (
          <PointBubble
            client={bubble}
            status={
              stop
                ? stop.visitedToday
                  ? tt('visitedToday')
                  : t('stopNumber', { n: index + 1 })
                : undefined
            }
            distanceM={me.position ? Math.round(haversineM(me.position, bubble)) : undefined}
            onClose={() => setSelectedId(null)}
            extra={
              stop ? (
                <Button size="sm" className="h-11" onClick={() => onVisit(stop)}>
                  <CircleCheck aria-hidden />
                  {tt('actionVisit')}
                </Button>
              ) : null
            }
          />
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{t('pathNote')}</p>
      <NearbySheet
        open={nearOpen}
        onOpenChange={setNearOpen}
        center={me.position}
        accuracyM={me.position?.accuracyM}
        around={t('aroundMe')}
        filters={{}}
        radiusM={radiusM}
        onRadiusChange={setRadiusM}
        onShow={show}
      />
    </div>
  );
}
