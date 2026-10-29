'use client';

import { CircleAlert, Clock, Eye, Lock } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { TRIAL_WARNING_DAYS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useSubscription } from '@/lib/billing';
import { cn } from '@/lib/utils';

/**
 * One line under the header when the subscription needs attention: trial ending,
 * payment overdue (grace), suspended (read-only), or a super-admin's support view.
 */
export function SubscriptionBanner() {
  const t = useTranslations('billing');
  const { state, logout } = useAuth();
  const impersonating = state.status === 'authenticated' && state.user.impersonating === true;
  const sub = useSubscription(state.status === 'authenticated');
  const s = sub.data;

  if (impersonating) {
    return (
      <Bar tone="info" icon={<Eye aria-hidden />}>
        <span className="min-w-0 truncate">
          {t('bannerSupport', { name: state.user.tenantName })}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="min-h-9 shrink-0"
          onClick={() => void logout()}
        >
          {t('bannerSupportExit')}
        </Button>
      </Bar>
    );
  }
  if (!s || s.isFree) return null;

  const renew = (
    <Button asChild size="sm" variant="outline" className="min-h-9 shrink-0">
      <Link href="/parametres/abonnement">{t('bannerAction')}</Link>
    </Button>
  );
  if (s.status === 'SUSPENDED') {
    return (
      <Bar tone="danger" icon={<Lock aria-hidden />}>
        <span className="min-w-0">{t('bannerSuspended')}</span>
        {renew}
      </Bar>
    );
  }
  if (s.status === 'PAST_DUE') {
    return (
      <Bar tone="warn" icon={<CircleAlert aria-hidden />}>
        <span className="min-w-0">{t('bannerPastDue', { count: s.daysLeft })}</span>
        {renew}
      </Bar>
    );
  }
  if (s.status === 'TRIAL' && s.daysLeft <= TRIAL_WARNING_DAYS) {
    return (
      <Bar tone="info" icon={<Clock aria-hidden />}>
        <span className="min-w-0">{t('bannerTrial', { count: s.daysLeft })}</span>
        {renew}
      </Bar>
    );
  }
  return null;
}

function Bar({
  tone,
  icon,
  children,
}: {
  tone: 'info' | 'warn' | 'danger';
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      data-testid="subscription-banner"
      className={cn(
        'flex items-center gap-3 border-b px-4 py-2 text-sm lg:px-6 [&>svg]:size-4 [&>svg]:shrink-0',
        tone === 'info' && 'bg-sky-50 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100',
        tone === 'warn' && 'bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100',
        tone === 'danger' && 'bg-destructive/10 text-destructive',
      )}
    >
      {icon}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {children}
      </div>
    </div>
  );
}
