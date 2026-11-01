'use client';

import { useTranslations } from 'next-intl';
import { formatDA, money } from '@erp/shared';
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
  currency = 'DZD',
}: {
  value: string;
  className?: string;
  showHint?: boolean;
  /** Phase 22: a foreign supplier's balance in its own currency. */
  currency?: string;
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
        {currency === 'DZD' ? (
          <Amount value={amount.abs()} />
        ) : (
          <span dir="ltr" className="num whitespace-nowrap">
            {formatDA(amount.abs(), { currency: false })} {currency}
          </span>
        )}
      </span>
      {showHint && tone !== 'zero' ? (
        <span className="text-xs font-normal text-muted-foreground">
          {tone === 'owed' ? t('weOwe') : t('inOurFavour')}
        </span>
      ) : null}
    </span>
  );
}
