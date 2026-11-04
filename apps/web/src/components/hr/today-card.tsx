'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { useAttendanceToday, useHrOn } from '@/lib/hr';

/** Dashboard card for managers: who is here today, and who nobody marked yet. */
export function AttendanceTodayCard() {
  const t = useTranslations('hr');
  const on = useHrOn();
  const today = useAttendanceToday(on);
  if (!on || !today.data) return null;
  const { present, absent, unmarked } = today.data;
  if (present + absent + unmarked === 0) return null;
  return (
    <Card className="p-0">
      <Link
        href="/rh/pointage"
        className="flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-xl p-4 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <h2 className="font-semibold">{t('cardTitle')}</h2>
        <p className="flex flex-wrap gap-x-4 text-sm">
          <span>{t('cardPresent', { n: present })}</span>
          <span>{t('cardAbsent', { n: absent })}</span>
          <span className={unmarked > 0 ? 'font-semibold' : undefined}>
            {t('cardUnmarked', { n: unmarked })}
          </span>
        </p>
      </Link>
    </Card>
  );
}
