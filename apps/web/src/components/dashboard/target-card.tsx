'use client';

import { Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatDA, type GreetingFact, money, type SalesTargetProgress } from '@erp/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isolateLtr } from '@/lib/utils';

/**
 * Objectif du mois (phase 33): the owner's target against the month so far. The bar has
 * its value in text too, never colour alone. Everything is computed by the API.
 */
export function TargetCard({ target }: { target: SalesTargetProgress }) {
  const t = useTranslations('dashboard');
  const pct = target.pct.replace('.', ',');
  const reached = money(target.remaining).isZero();
  // A display ratio, not money.
  const width = Math.min(money(target.pct).toNumber(), 100);
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row items-center gap-2">
        <Target className="size-4 text-primary" aria-hidden />
        <CardTitle role="heading" aria-level={2} className="text-base">
          {t('targetTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm">
            {t('targetOf', {
              achieved: isolateLtr(formatDA(target.achieved)),
              amount: isolateLtr(formatDA(target.amount)),
            })}
          </p>
          <p dir="ltr" className="num text-sm font-semibold">
            {t('targetValue', { pct })}
          </p>
        </div>
        <div
          role="progressbar"
          aria-label={t('targetTitle')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={width}
          aria-valuetext={t('targetValue', { pct })}
          className="h-3 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-300"
            style={{ width: `${width}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {reached
            ? t('targetReached')
            : t('targetLeft', {
                amount: isolateLtr(formatDA(target.remaining)),
                days: target.daysLeft,
              })}
        </p>
      </CardContent>
    </Card>
  );
}

/** The line under "Bonjour": the API picks the fact, the messages say it. */
export function GreetingLine({ fact }: { fact: GreetingFact | null }) {
  const t = useTranslations('dashboard');
  // The line keeps its height while loading or empty, so nothing below it jumps.
  if (!fact) return <p className="min-h-5 text-sm" aria-hidden />;
  const params = Object.fromEntries(
    Object.entries(fact.params).map(([k, v]) => [
      k,
      k === 'amount' && typeof v === 'string' ? isolateLtr(formatDA(v)) : v,
    ]),
  );
  return <p className="min-h-5 text-sm font-medium">{t(`greeting_${fact.key}`, params)}</p>;
}
