'use client';

import { useTranslations } from 'next-intl';
import { money } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { cn } from '@/lib/utils';

/**
 * A supplier balance (phase 21): red when we owe the supplier, green when the balance
 * is in our favour. Always a positive amount with words, never a bare "-".
 */
export function SupplierBalance({
  value,
  className,
  showHint = true,
}: {
  value: string;
  className?: string;
  showHint?: boolean;
}) {
  const t = useTranslations('supplierAccount');
  const amount = money(value);
  const tone = amount.gt(0) ? 'owed' : amount.lt(0) ? 'credit' : 'zero';
  return (
    <span className={cn('inline-flex flex-col', className)}>
      <span
        className={cn(
          'font-medium',
          tone === 'owed' && 'text-destructive',
          tone === 'credit' && 'text-primary',
          tone === 'zero' && 'text-muted-foreground',
        )}
      >
        <Amount value={amount.abs()} />
      </span>
      {showHint && tone !== 'zero' ? (
        <span className="text-xs font-normal text-muted-foreground">
          {tone === 'owed' ? t('weOwe') : t('inOurFavour')}
        </span>
      ) : null}
    </span>
  );
}
