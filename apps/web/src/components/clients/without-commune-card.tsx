'use client';

import { ChevronRight, MapPinOff } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Feature } from '@erp/shared';
import { useAuth, useFeature } from '@/lib/auth';
import { leadsOrOffice, useClientsWithoutCommune } from '@/lib/zones';

/** "Clients sans commune (N)": shown to whoever must fix them, only while there are some. */
export function WithoutCommuneCard() {
  const on = useFeature(Feature.SALES_FORCE);
  const role = useAuth().state.user?.role;
  if (!on || !leadsOrOffice(role)) return null;
  return <CountLink />;
}

function CountLink() {
  const t = useTranslations('withoutCommune');
  const total = useClientsWithoutCommune(1).data?.pages[0]?.total ?? 0;
  if (total === 0) return null;
  return (
    <Link
      href="/clients/sans-commune"
      className="flex min-h-14 items-center gap-3 rounded-lg border bg-card px-4 py-3 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-muted"
    >
      <MapPinOff className="size-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{t('titleCount', { count: total })}</span>
        <span className="block text-sm text-muted-foreground">{t('cardHelp')}</span>
      </span>
      <ChevronRight className="rtl-flip size-5 shrink-0" aria-hidden />
    </Link>
  );
}
