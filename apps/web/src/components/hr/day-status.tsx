'use client';

import { useTranslations } from 'next-intl';
import { DAY_STATUSES, DayStatus, STATUS_LETTERS } from '@erp/shared';
import { cn } from '@/lib/utils';

/**
 * The one visual language of the pointage: a colour family per kind of day, always with a
 * letter or a word (docs/ui.md rule 12: status is never shown by colour alone). Worked days
 * are green, absences red, sickness and leave their own hues; days off stay quiet so a
 * month grid reads as "who was missing" at a glance, and an unmarked day has a dashed edge
 * because it is a task, not a fact.
 */
const TONE: Record<DayStatus, string> = {
  [DayStatus.PRESENT]: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  [DayStatus.HALF_DAY]: 'bg-lime-100 text-lime-900 dark:bg-lime-950 dark:text-lime-200',
  [DayStatus.ABSENT_UNJUSTIFIED]: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  [DayStatus.ABSENT_JUSTIFIED]:
    'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
  [DayStatus.SICK]: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
  [DayStatus.LEAVE_PAID]: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  [DayStatus.LEAVE_UNPAID]: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200',
  [DayStatus.REST]: 'bg-muted text-muted-foreground',
  [DayStatus.HOLIDAY]: 'bg-muted text-muted-foreground',
  [DayStatus.NOT_EMPLOYED]: 'text-muted-foreground',
  [DayStatus.UNMARKED]: 'border border-dashed border-muted-foreground/60 text-foreground',
};

export function DayStatusBadge({ status, className }: { status: DayStatus; className?: string }) {
  const t = useTranslations('hr');
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE[status],
        className,
      )}
    >
      {t(`status_${status}`)}
    </span>
  );
}

/** One square of the month grid. The full word is in the title and for screen readers. */
export function DayStatusCell({ status, date }: { status: DayStatus; date: string }) {
  const t = useTranslations('hr');
  const label = `${date}: ${t(`status_${status}`)}`;
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className={cn(
        'inline-flex size-7 items-center justify-center rounded text-xs font-semibold',
        TONE[status],
      )}
    >
      {STATUS_LETTERS[status]}
    </span>
  );
}

export function DayStatusLegend() {
  const t = useTranslations('hr');
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs" aria-label={t('legend')}>
      {DAY_STATUSES.filter((s) => s !== DayStatus.NOT_EMPLOYED).map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              'inline-flex size-5 items-center justify-center rounded font-semibold',
              TONE[s],
            )}
          >
            {STATUS_LETTERS[s]}
          </span>
          {t(`status_${s}`)}
        </li>
      ))}
    </ul>
  );
}
