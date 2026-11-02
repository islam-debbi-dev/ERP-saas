'use client';

import { useFormatter } from 'next-intl';

/** An Algiers day (`YYYY-MM-DD`) as a medium date. */
export function DayText({ day }: { day: string }) {
  const format = useFormatter();
  return (
    <time dateTime={day} className="whitespace-nowrap">
      {format.dateTime(new Date(`${day}T12:00:00Z`), { dateStyle: 'medium' })}
    </time>
  );
}
