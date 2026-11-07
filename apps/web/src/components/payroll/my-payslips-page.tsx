'use client';

import { FileText, Receipt } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Feature } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { usePrint } from '@/components/shared/print-button';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { monthName, useMyPayslips } from '@/lib/payroll';

export function MyPayslipsPage() {
  return (
    <FeatureGate feature={Feature.PAYROLL}>
      <Mine />
    </FeatureGate>
  );
}

function Mine() {
  const t = useTranslations('payroll');
  const locale = useLocale();
  const slips = useMyPayslips();
  const { print, busy } = usePrint();

  return (
    <>
      <PageHeader title={t('myTitle')} description={t('mySubtitle')} />
      {slips.isPending ? <Skeleton className="h-40 w-full" /> : null}
      {slips.isError ? (
        <ErrorState icon={Receipt} error={slips.error} onRetry={() => void slips.refetch()} />
      ) : null}
      {slips.data?.length === 0 ? (
        <EmptyState icon={Receipt} title={t('noPayslips')} description={t('noPayslipsHelp')} />
      ) : null}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {slips.data?.map((s) => (
          <li key={s.id}>
            <Card className="gap-2 p-4">
              <span className="font-medium">{monthName(s.month, locale)}</span>
              <Amount value={s.netToPay} className="text-xl font-bold" />
              <Button
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() =>
                  void print(
                    `/me/payslips/${s.id}/pdf`,
                    s.declared ? 'A4' : 'A5',
                    `paie-${s.month}.pdf`,
                  )
                }
              >
                <FileText aria-hidden />
                {s.declared ? t('printBulletin') : t('printRecu')}
              </Button>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
