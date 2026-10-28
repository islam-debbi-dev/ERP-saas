'use client';

import { FileCheck } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { money } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useUnpaidDocuments } from '@/lib/payments';
import { Amount } from '@/components/shared/amount';

/** Documents of a client still to be paid, oldest first (from versement allocations). */
export function UnpaidDocuments({ clientId }: { clientId: string }) {
  const t = useTranslations('payments');
  const ts = useTranslations('sales');
  const format = useFormatter();
  const docs = useUnpaidDocuments(clientId);
  const total = (docs.data ?? []).reduce((s, d) => s.plus(d.remaining), money(0));

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
        <CardTitle role="heading" aria-level={2} className="text-base">
          {t('unpaidTitle')}
        </CardTitle>
        {docs.data && docs.data.length > 0 ? (
          <span className="text-sm text-muted-foreground">
            {t('unpaidTotal')}{' '}
            <span dir="ltr" className="num font-medium text-destructive">
              <Amount value={total} />
            </span>
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        {!docs.data ? (
          <Skeleton className="h-16 w-full" aria-busy />
        ) : docs.data.length === 0 ? (
          <EmptyState icon={FileCheck} title={t('unpaidNone')} />
        ) : (
          <ul className="divide-y text-sm">
            {docs.data.map((d) => (
              <li key={d.saleId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <Link
                    href={`/ventes/${d.saleId}`}
                    dir="ltr"
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {d.number}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {ts(`type${d.type}`)} ·{' '}
                    {format.dateTime(new Date(`${d.documentDate}T12:00:00Z`), {
                      dateStyle: 'medium',
                    })}
                  </p>
                </div>
                <div className="text-end">
                  <p dir="ltr" className="num font-medium">
                    <Amount value={d.remaining} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('ofTotal')}{' '}
                    <span dir="ltr" className="num">
                      <Amount value={d.totalTtc} />
                    </span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
