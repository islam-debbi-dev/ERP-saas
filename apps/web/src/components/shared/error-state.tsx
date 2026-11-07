'use client';

import type { LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useErrorMessage } from '@/lib/use-error-message';
import { EmptyState } from './empty-state';

/** A list that failed to load: never shown as an empty list. */
export function ErrorState({
  icon,
  error,
  onRetry,
  className,
}: {
  icon: LucideIcon;
  error: unknown;
  onRetry: () => void;
  className?: string;
}) {
  const t = useTranslations('common');
  const errorMessage = useErrorMessage();
  return (
    <EmptyState icon={icon} title={errorMessage(error)} className={className}>
      <Button variant="outline" className="min-h-11" onClick={onRetry}>
        {t('retry')}
      </Button>
    </EmptyState>
  );
}
