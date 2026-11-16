'use client';

import { useQuery } from '@tanstack/react-query';
import { Van } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Feature, Role, type StatMeasure, type StatsMyVehicleDto } from '@erp/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { useAuth, useFeature } from '@/lib/auth';
import { cellOf, formatStat } from '@/lib/distribution-stats';

const TODAY: StatMeasure[] = ['caTtc', 'nbBl', 'versements'];

/**
 * "Mon véhicule" (phase 37): what a seller or a livreur gets of the statistics, for the
 * truck he drives today only. Every figure comes from the API as text.
 */
export function MyVehicleCard() {
  const t = useTranslations('stats');
  const { state } = useAuth();
  const on = useFeature(Feature.DISTRIBUTION_STATS);
  const road =
    state.status === 'authenticated' &&
    (state.user.role === Role.SELLER || state.user.role === Role.LIVREUR);
  const res = useQuery({
    queryKey: ['distribution-stats', 'my-vehicle'],
    queryFn: ({ signal }) =>
      api.request<StatsMyVehicleDto>('/stats/distribution/my-vehicle', { signal }),
    enabled: on && road,
    staleTime: 60_000,
  });
  if (!on || !road || res.isError) return null;
  const d = res.data;
  const text = (m: StatMeasure) => {
    const c = d ? cellOf(d.today, m) : undefined;
    return formatStat(c?.value ?? null, c?.unit ?? 'COUNT');
  };
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row items-center gap-2">
        <Van className="size-4 text-primary" aria-hidden />
        <CardTitle role="heading" aria-level={2} className="min-w-0 truncate text-base">
          {d?.vehicle
            ? t('myVehicleOf', {
                vehicle: d.vehicle.code ? `${d.vehicle.code} · ${d.vehicle.name}` : d.vehicle.name,
              })
            : t('myVehicle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!d ? (
          <Skeleton className="h-16" />
        ) : !d.vehicle ? (
          <p className="text-sm text-muted-foreground">{t('myVehicleNone')}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TODAY.map((m) => (
                <div key={m} className="rounded-lg border p-2">
                  <dt className="text-xs text-muted-foreground">{t(`m_${m}`)}</dt>
                  <dd className="font-semibold">
                    <bdi dir="ltr" className="num whitespace-nowrap">
                      {text(m)}
                    </bdi>
                  </dd>
                </div>
              ))}
              <div className="rounded-lg border p-2">
                <dt className="text-xs text-muted-foreground">{t('visitsDoneOfPlanned')}</dt>
                <dd className="font-semibold">
                  <bdi dir="ltr" className="num whitespace-nowrap">
                    {text('visitsDone')} / {text('visitsPlanned')}
                  </bdi>
                </dd>
              </div>
            </dl>
            {d.objectives.length > 0 ? (
              <ul className="space-y-2">
                {d.objectives.map((o) => {
                  // A display ratio for the bar width, never money maths.
                  const width = o.pct === null ? 0 : Math.min(100, Number(o.pct));
                  return (
                    <li key={o.metric} className="space-y-1">
                      <div className="flex justify-between gap-2 text-xs">
                        <span>{t(`metric_${o.metric}`)}</span>
                        <bdi dir="ltr" className="num">
                          {formatStat(o.pct, 'PERCENT')}
                        </bdi>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={t(`metric_${o.metric}`)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={width}
                        aria-valuetext={formatStat(o.pct, 'PERCENT')}
                        className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                      >
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
