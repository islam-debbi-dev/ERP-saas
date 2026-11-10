'use client';

import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { type DashboardSeriesPoint, formatDA, money } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

export type ChartSeries = 'ttc' | 'cash' | 'margin';

/** The value of a bar in a series; null when the role does not see it. */
function valueOf(p: DashboardSeriesPoint, s: ChartSeries): string | null {
  return s === 'ttc' ? p.ttc : s === 'cash' ? p.cash : p.margin;
}

/**
 * The period's bars (phase 33): plain divs in a flex row, so they run right-to-left in
 * Arabic like the page; no chart library. A bar is a button: tap or focus shows its day,
 * amount and documents above the chart, arrow keys move between bars, a second tap (or
 * Enter on the shown bar) opens the sales of that day or week. The numbers are also in a
 * hidden table for screen readers.
 */
export function SalesChart({
  points,
  bucket,
  salesHref,
}: {
  points: DashboardSeriesPoint[];
  bucket: 'day' | 'week';
  /** The sales list of a bar, or null when the user cannot open it. */
  salesHref: ((from: string, to: string) => string) | null;
}) {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  const router = useRouter();
  const isMobile = useIsMobile();
  const id = useId();
  const bars = useRef<(HTMLButtonElement | null)[]>([]);
  const hasCash = points.some((p) => p.cash !== null);
  const hasMargin = points.some((p) => p.margin !== null);
  const [series, setSeries] = useState<ChartSeries>('ttc');
  const [picked, setPicked] = useState<number | null>(null);
  const [compareChoice, setCompareChoice] = useState<boolean | null>(null);
  // Off by default on a phone (the bars are thin), on from md.
  const compare = compareChoice ?? !isMobile;
  const shown =
    series === 'cash' && !hasCash ? 'ttc' : series === 'margin' && !hasMargin ? 'ttc' : series;

  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { day: 'numeric', month: 'short' });
  const name = (p: DashboardSeriesPoint) =>
    bucket === 'week' ? t('chartWeekOf', { day: day(p.from) }) : day(p.from);
  const values = points.map((p) => money(valueOf(p, shown) ?? 0));
  const previous = points.map((p) => money(p.previousTtc));
  let max = money(0);
  for (const v of [...values, ...(compare && shown === 'ttc' ? previous : [])])
    if (v.gt(max)) max = v;
  // A display ratio, not money: the height of a bar in %.
  const pct = (v: ReturnType<typeof money>) =>
    max.isZero() || v.lte(0) ? 0 : Math.max(v.div(max).times(100).toNumber(), 2);

  const open = (i: number) => {
    const p = points[i];
    if (p && salesHref) router.push(salesHref(p.from, p.to));
  };
  const focusBar = (i: number) => {
    setPicked(i);
    bars.current[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const rtl = document.documentElement.dir === 'rtl';
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      focusBar(Math.min(Math.max(i + step, 0), points.length - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusBar(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusBar(points.length - 1);
    }
  };
  const current = picked !== null ? points[picked] : undefined;
  // Roving focus: the picked bar, else the last one (today) is the tab stop.
  const tabStop = picked ?? points.length - 1;

  const seriesOptions: ChartSeries[] = [
    'ttc',
    ...(hasCash ? ['cash' as const] : []),
    ...(hasMargin ? ['margin' as const] : []),
  ];

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {seriesOptions.length > 1 ? (
          <div
            role="group"
            aria-label={t('chartSeries')}
            className="inline-flex rounded-md border p-0.5"
          >
            {seriesOptions.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={shown === s}
                onClick={() => setSeries(s)}
                className={cn(
                  'min-h-11 rounded px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  shown === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                {t(`series_${s}`)}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        {shown === 'ttc' ? (
          <div className="flex min-h-11 items-center gap-2">
            <Switch id={`${id}-cmp`} checked={compare} onCheckedChange={setCompareChoice} />
            <Label htmlFor={`${id}-cmp`} className="font-normal">
              {t('chartCompare')}
            </Label>
          </div>
        ) : null}
      </div>

      {/* The picked bar, said once: day, amount, documents. */}
      <p aria-live="polite" className="flex min-h-10 flex-wrap items-baseline gap-x-2 text-sm">
        {current ? (
          <>
            <span className="font-medium">{name(current)}</span>
            <span dir="ltr" className="num font-semibold">
              <Amount value={valueOf(current, shown) ?? '0'} />
            </span>
            <span className="text-muted-foreground">
              {t('documents', { count: current.count })}
            </span>
            {salesHref ? (
              <span className="text-xs text-muted-foreground">{t('chartOpenHint')}</span>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">{t('chartHint')}</span>
        )}
      </p>

      <div
        role="group"
        aria-label={t('chartBars')}
        className="flex h-40 items-end gap-px border-b sm:gap-1"
      >
        {points.map((p, i) => {
          const v = values[i]!;
          const selected = picked === i;
          return (
            <button
              key={p.from}
              ref={(el) => {
                bars.current[i] = el;
              }}
              type="button"
              tabIndex={i === tabStop ? 0 : -1}
              aria-pressed={selected}
              aria-label={t('chartBarLabel', {
                day: name(p),
                amount: formatDA(valueOf(p, shown) ?? '0'),
                count: p.count,
              })}
              onFocus={() => setPicked(i)}
              onClick={() => (selected ? open(i) : setPicked(i))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && selected) {
                  e.preventDefault();
                  open(i);
                } else onKeyDown(e, i);
              }}
              className="group relative flex h-full min-w-0 flex-1 items-end rounded-t-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {compare && shown === 'ttc' ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 rounded-t-sm border border-b-0 border-dashed border-muted-foreground/50"
                  style={{ height: `${pct(previous[i]!)}%` }}
                />
              ) : null}
              <span
                aria-hidden
                className={cn(
                  'relative w-full rounded-t-sm motion-safe:transition-colors',
                  selected ? 'bg-primary' : 'bg-primary/70 group-hover:bg-primary/90',
                )}
                style={{ height: `${pct(v)}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden>
        <span>{points[0] ? day(points[0].from) : null}</span>
        <span>{points.at(-1) ? day(points.at(-1)!.to) : null}</span>
      </div>
      <table className="sr-only">
        <caption>{t('chartTitlePeriod')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('chartColDay')}</th>
            <th scope="col">{t('series_ttc')}</th>
            {hasCash ? <th scope="col">{t('series_cash')}</th> : null}
            {hasMargin ? <th scope="col">{t('series_margin')}</th> : null}
            <th scope="col">{t('chartColPrevious')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.from}>
              <th scope="row">{name(p)}</th>
              <td>
                <Amount value={p.ttc} />
              </td>
              {hasCash ? (
                <td>
                  <Amount value={p.cash ?? '0'} />
                </td>
              ) : null}
              {hasMargin ? (
                <td>
                  <Amount value={p.margin ?? '0'} />
                </td>
              ) : null}
              <td>
                <Amount value={p.previousTtc} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
