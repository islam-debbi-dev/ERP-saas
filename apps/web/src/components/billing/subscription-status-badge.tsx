'use client';

import { useTranslations } from 'next-intl';
import type { SubscriptionStatus } from '@erp/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const TONE: Record<SubscriptionStatus, string> = {
  TRIAL: 'border-sky-500/60 text-sky-800 dark:text-sky-300',
  ACTIVE: 'border-emerald-600/60 text-emerald-800 dark:text-emerald-300',
  PAST_DUE: 'border-amber-500 text-amber-800 dark:text-amber-300',
  SUSPENDED: 'border-destructive text-destructive',
};

/** The status in words (never colour alone, docs/ui.md rule 12). */
export function SubscriptionStatusBadge({
  status,
  isFree,
  className,
}: {
  status: SubscriptionStatus;
  isFree: boolean;
  className?: string;
}) {
  const t = useTranslations('billing');
  return (
    <Badge variant="outline" className={cn(isFree ? TONE.ACTIVE : TONE[status], className)}>
      {isFree ? t('free') : t(`status${status}`)}
    </Badge>
  );
}
