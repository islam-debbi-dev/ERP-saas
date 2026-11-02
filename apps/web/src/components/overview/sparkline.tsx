'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { type PointerEvent, useState } from 'react';
import { money } from '@erp/shared';
import { Amount } from '@/components/shared/amount';

const W = 200;
const H = 48;

/**
 * Daily CA of a dépôt as one thin line (phase 26). Time runs with the reading direction,
 * like the dashboard bars. A tap or a drag shows that day's figure below it (no hover-only
 * tooltip); the summary for screen readers is the label.
 */
export function Sparkline({
  days,
  label,
}: {
  days: { date: string; ttc: string }[];
  label: string;
}) {
  const t = useTranslations('overview');
  const format = useFormatter();
  const [active, setActive] = useState<number | null>(null);
  if (days.length < 2) return null;

  // Display ratios only, never money maths: a day with more avoirs than sales sits at 0.
  const values = days.map((d) => Math.max(0, money(d.ttc).toNumber()));
  const max = Math.max(...values);
  const x = (i: number) => (i / (days.length - 1)) * W;
  const y = (v: number) => (max === 0 ? H - 1 : H - 1 - (v / max) * (H - 4));
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const ratio = (e.clientX - box.left) / box.width;
    const i = Math.round((rtl ? 1 - ratio : ratio) * (days.length - 1));
    setActive(Math.min(days.length - 1, Math.max(0, i)));
  };
  const shown = active === null ? null : days[active];
  const dayLabel = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

  return (
    <figure className="space-y-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        className="h-12 w-full touch-pan-y text-primary rtl:-scale-x-100"
        onPointerDown={pick}
        onPointerMove={(e) => (e.buttons > 0 || e.pointerType === 'mouse' ? pick(e) : undefined)}
        onPointerLeave={(e) => (e.pointerType === 'mouse' ? setActive(null) : undefined)}
      >
        <line
          x1="0"
          x2={W}
          y1={H - 0.5}
          y2={H - 0.5}
          className="stroke-border"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <polygon points={`0,${H} ${points} ${W},${H}`} className="fill-current opacity-10" />
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {active !== null ? (
          <line
            x1={x(active)}
            x2={x(active)}
            y1="0"
            y2={H}
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      <figcaption
        className="flex min-h-5 items-baseline justify-between gap-2 text-xs text-muted-foreground"
        aria-live="polite"
      >
        {shown ? (
          <>
            <span>{dayLabel(shown.date)}</span>
            <Amount value={shown.ttc} />
          </>
        ) : (
          <span>{t('sparklineHint')}</span>
        )}
      </figcaption>
    </figure>
  );
}
