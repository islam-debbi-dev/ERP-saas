'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatDA } from '@erp/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { usePackagingLabel, useStockLevel } from '@/lib/stock';

/** Read-only stock and CUMP of a saved product (costs come from purchases and opening stock). */
export function ProductCost({ productId }: { productId: string | null }) {
  const t = useTranslations('productCost');
  const tp = useTranslations('products');
  const level = useStockLevel(productId ?? '');
  const packagingLabel = usePackagingLabel();

  if (!productId) return <p className="text-sm text-muted-foreground">{tp('costPending')}</p>;
  if (!level.data) return <Skeleton className="h-12 w-full" />;
  const l = level.data;
  if (!l.hasOpening && l.qtyBase === '0.000' && (l.avgCost ?? '0.0000') === '0.0000') {
    return <p className="text-sm text-muted-foreground">{t('none')}</p>;
  }
  return (
    <div className="space-y-3">
      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          { label: t('qty'), value: packagingLabel(l), ltr: false },
          // Costs are null without VIEW_COST_AND_MARGIN: those cards are left out.
          ...(l.avgCost !== null && l.value !== null
            ? [
                { label: t('cump'), value: formatDA(l.avgCost), ltr: true },
                { label: t('value'), value: formatDA(l.value), ltr: true },
              ]
            : []),
        ].map((item) => (
          <div key={item.label} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="num font-semibold" dir={item.ltr ? 'ltr' : undefined}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      <Link
        href={`/stock/${productId}`}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('openCard')}
      </Link>
    </div>
  );
}
