'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { formatDA, money } from '@erp/shared';

/**
 * Sales per day of the month as plain bars. A flex row, so it runs right-to-left
 * in Arabic like the rest of the page; the numbers are also in a hidden table for
 * screen readers. A day with more avoirs than sales shows an empty bar.
 */
export function SalesChart({ days }: { days: { date: string; ttc: string }[] }) {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  const max = days.reduce((m, d) => (money(d.ttc).gt(m) ? money(d.ttc) : m), money(0));
  const label = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { day: 'numeric', month: 'short' });

  return (
    <figure className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>{t('chartMax')}</span>
        <span dir="ltr" className="num">
          {formatDA(max)}
        </span>
      </div>
      <div className="flex h-40 items-end gap-0.5 border-b sm:gap-1" aria-hidden>
        {days.map((d) => {
          const value = money(d.ttc);
          const pct = max.isZero() || value.lte(0) ? 0 : value.div(max).times(100).toNumber();
          return (
            <div
              key={d.date}
              title={`${label(d.date)} · ${formatDA(d.ttc)}`}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <div
                className="w-full rounded-t-sm bg-primary/80 transition-colors hover:bg-primary"
                // A display ratio, not money.
                style={{ height: `${Math.max(pct, value.gt(0) ? 2 : 0)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden>
        <span>{days[0] ? label(days[0].date) : null}</span>
        <span>{days.at(-1) ? label(days.at(-1)!.date) : null}</span>
      </div>
      <table className="sr-only">
        <caption>{t('chartTitle')}</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">{label(d.date)}</th>
              <td>{formatDA(d.ttc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
