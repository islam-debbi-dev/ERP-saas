'use client';

import { Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Feature, type ObjectiveDto } from '@erp/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth, useFeature } from '@/lib/auth';
import { useMyObjectives } from '@/lib/incentives';
import { cn } from '@/lib/utils';
import { useMetricLabel, useMetricValue, usePct } from './explanation';

/**
 * "Mes objectifs" on the dashboard (phase 18): one bar per target of the month, with a
 * mark at every tier of the plan, and what is left for the next one. A supervisor sees
 * his team's target first, then each member's. Hidden when there is no target.
 */
export function MyObjectivesCard() {
  const on = useFeature(Feature.INCENTIVES);
  if (!on) return null;
  return <ObjectivesCard />;
}

function ObjectivesCard() {
  const t = useTranslations('incentives');
  const me = useAuth().state.user?.id;
  const mine = useMyObjectives();
  const items = mine.data?.items ?? [];
  if (!mine.data || items.length === 0) return null;

  const own = items.filter((i) => i.subject.id === me);
  const members = items.filter((i) => i.subject.id !== me);
  const byMember = new Map<string, ObjectiveDto[]>();
  for (const i of members) byMember.set(i.subject.id, [...(byMember.get(i.subject.id) ?? []), i]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="size-4" aria-hidden />
            {t('myObjectives')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('daysLeft', { count: mine.data.daysLeft })}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {own.length > 0 ? (
          <ul className="space-y-5">
            {own.map((o) => (
              <li key={o.targetId}>
                <ObjectiveBar o={o} />
              </li>
            ))}
          </ul>
        ) : null}
        {byMember.size > 0 ? (
          <section aria-labelledby="team-objectives" className="space-y-3">
            <h3 id="team-objectives" className="text-sm font-semibold">
              {t('teamObjectives')}
            </h3>
            <ul className="space-y-4">
              {[...byMember.values()].map((list) => (
                <li key={list[0]!.subject.id} className="space-y-3 rounded-md border p-3">
                  <p className="truncate font-medium" title={list[0]!.subject.fullName}>
                    {list[0]!.subject.fullName}
                  </p>
                  {list.map((o) => (
                    <ObjectiveBar key={o.targetId} o={o} compact />
                  ))}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ObjectiveBar({ o, compact = false }: { o: ObjectiveDto; compact?: boolean }) {
  const t = useTranslations('incentives');
  const value = useMetricValue();
  const pctLabel = usePct();
  const metricLabel = useMetricLabel();
  // Display only: positions on the bar.
  const pct = o.pct === null ? 0 : Number(o.pct);
  const marks = o.thresholds.map(Number);
  const scale = Math.max(100, ...marks) * 1.15;
  const at = (p: number) => `${(Math.min(Math.max(p, 0), scale) / scale) * 100}%`;
  const reached = o.next === null && o.pct !== null;
  const title = `${metricLabel(o.metric)}${o.scopeLabel ? ` (${o.scopeLabel})` : ''}${
    o.team ? ` · ${t('teamTarget')}` : ''
  }`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn('min-w-0 truncate', compact ? 'text-sm' : 'font-medium')} title={title}>
          {title}
        </p>
        {o.pct !== null ? (
          <bdi dir="ltr" className="num shrink-0 text-sm font-semibold whitespace-nowrap">
            {pctLabel(o.pct)}
          </bdi>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(pct, 100))}
        aria-valuetext={o.pct !== null ? pctLabel(o.pct) : undefined}
        className="relative h-3 rounded-full bg-muted"
      >
        <div
          className={cn(
            'absolute inset-y-0 start-0 rounded-full transition-[width] duration-500 motion-reduce:transition-none',
            reached ? 'bg-emerald-600' : 'bg-primary',
          )}
          style={{ width: at(pct) }}
        />
        {marks.map((m) => (
          <span
            key={m}
            aria-hidden
            className={cn(
              'absolute -inset-y-1 w-0.5 rounded-full',
              pct >= m ? 'bg-background/90' : 'bg-foreground/40',
            )}
            style={{ insetInlineStart: at(m) }}
          />
        ))}
      </div>
      {!compact ? (
        <div aria-hidden className="relative h-4 text-[11px] text-muted-foreground">
          {marks.map((m) => (
            // Positioned by a wrapper in the page's direction; only the text is isolated
            // (a dir="ltr" element would resolve inline-start to the left).
            <span
              key={m}
              className="absolute -translate-x-1/2 rtl:translate-x-1/2"
              style={{ insetInlineStart: at(m) }}
            >
              <bdi dir="ltr" className="num">
                {m}%
              </bdi>
            </span>
          ))}
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {o.achieved !== null && o.target !== null ? (
          <>
            <bdi dir="ltr" className="num whitespace-nowrap text-foreground">
              {value(o.metric, o.achieved)}
            </bdi>{' '}
            {t('ofTarget')}{' '}
            <bdi dir="ltr" className="num whitespace-nowrap">
              {value(o.metric, o.target)}
            </bdi>
          </>
        ) : null}
      </p>
      <p
        className={cn(
          'text-sm',
          reached ? 'font-medium text-emerald-700 dark:text-emerald-400' : '',
        )}
      >
        {o.next
          ? o.next.remaining !== null
            ? t.rich('remaining', {
                remaining: value(o.metric, o.next.remaining),
                pct: pctLabel(o.next.pct),
                n: (c) => (
                  <bdi dir="ltr" className="num font-medium whitespace-nowrap">
                    {c}
                  </bdi>
                ),
              })
            : t('nextTier', { pct: pctLabel(o.next.pct) })
          : reached
            ? t('allReached')
            : null}
      </p>
    </div>
  );
}
