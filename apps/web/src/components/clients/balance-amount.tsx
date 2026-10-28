'use client';

import { useTranslations } from 'next-intl';
import { money } from '@erp/shared';
import { cn } from '@/lib/utils';
import { Amount } from '@/components/shared/amount';

/**
 * A client balance: red when the client owes us, green when the balance is in
 * his favour. Always shown as a positive amount with words, never a bare "-".
 */
export function BalanceAmount({
  value,
  className,
  showHint = true,
}: {
  value: string;
  className?: string;
  showHint?: boolean;
}) {
  const t = useTranslations('clients');
  const amount = money(value);
  const tone = amount.gt(0) ? 'debt' : amount.lt(0) ? 'credit' : 'zero';
  return (
    <span className={cn('inline-flex flex-col', className)}>
      <span
        dir="ltr"
        className={cn(
          'num whitespace-nowrap font-medium',
          tone === 'debt' && 'text-destructive',
          tone === 'credit' && 'text-primary',
          tone === 'zero' && 'text-muted-foreground',
        )}
      >
        <Amount value={amount.abs()} />
      </span>
      {showHint && tone !== 'zero' ? (
        <span className="text-xs font-normal text-muted-foreground">
          {tone === 'debt' ? t('owes') : t('inFavour')}
        </span>
      ) : null}
    </span>
  );
}

/** Plafond usage bar; the colour turns amber near the limit and red above it. */
export function PlafondBar({ usage, label }: { usage: number; label: string }) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={usage}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width]',
          usage >= 100 ? 'bg-destructive' : usage >= 80 ? 'bg-amber-500' : 'bg-primary',
        )}
        style={{ width: `${usage}%` }}
      />
    </div>
  );
}
