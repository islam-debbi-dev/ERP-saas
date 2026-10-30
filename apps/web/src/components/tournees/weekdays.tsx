'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** The Algerian week starts on Sunday (0) and ends on Saturday (6). */
export const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;
type Weekday = (typeof WEEK)[number];

export function useWeekdayLabels(style: 'short' | 'long' = 'long'): (day: number) => string {
  const t = useTranslations('tournees');
  return (day) => {
    // The API only stores 0..6.
    const d = day as Weekday;
    return style === 'short' ? t(`dayShort${d}`) : t(`day${d}`);
  };
}

/** Toggle buttons, one per weekday (aria-pressed: the state is not colour only). */
export function WeekdayPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  const t = useTranslations('tournees');
  const long = useWeekdayLabels('long');
  const short = useWeekdayLabels('short');
  const toggle = (d: number) =>
    onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('weekdays')}</legend>
      <div className="flex flex-wrap gap-2">
        {WEEK.map((d) => {
          const on = value.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              aria-label={long(d)}
              onClick={() => toggle(d)}
              className={cn(
                'min-h-11 min-w-11 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted',
              )}
            >
              {short(d)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
