'use client';

import { ArrowLeft, ChartColumn } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { addDays, algiersDay, Feature, money } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsOffice, useSellers } from '@/lib/sales-force';
import { useTourneeReport } from '@/lib/tournees';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';

/** Rapport des tournées (phase 16): taux de visite, strike rate, commandes, écarts. */
export function VisitReport() {
  return (
    <FeatureGate feature={Feature.TOURNEES}>
      <Report />
    </FeatureGate>
  );
}

function Report() {
  const t = useTranslations('tournees');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const office = useIsOffice();
  const sellers = useSellers({ orderTakers: true });
  const [to, setTo] = useState(() => algiersDay());
  const [from, setFrom] = useState(() => addDays(algiersDay(), -6));
  const [sellerId, setSellerId] = useState('');
  const report = useTourneeReport(from, to, sellerId);
  const rows = report.data?.rows ?? [];
  const pct = (v: number | null) =>
    v === null ? '—' : format.number(v, { style: 'percent', maximumFractionDigits: 0 });

  return (
    <>
      <PageHeader
        title={t('reportTitle')}
        description={t('reportSubtitle')}
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/tournees' },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="report-from">{t('from')}</Label>
          <Input
            id="report-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="report-to">{t('to')}</Label>
          <Input
            id="report-to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </div>
        {office ? (
          <div className="space-y-2">
            <Label htmlFor="report-seller">{t('seller')}</Label>
            <NativeSelect
              id="report-seller"
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
            >
              <option value="">{t('allSellers')}</option>
              {(sellers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
      </div>

      {report.isPending ? (
        <Skeleton className="h-40 w-full" aria-busy />
      ) : report.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(report.error)}
        </p>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={ChartColumn}
            title={t('reportEmptyTitle')}
            description={t('reportEmptyDescription')}
          />
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="stack-table w-full text-sm">
            <caption className="sr-only">{t('reportTitle')}</caption>
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-3 text-start font-medium">{t('seller')}</th>
                <th className="p-3 text-end font-medium">{t('visitRate')}</th>
                <th className="p-3 text-end font-medium">{t('strikeRate')}</th>
                <th className="p-3 text-end font-medium">{t('visits')}</th>
                <th className="p-3 text-end font-medium">{t('ordersDelivered')}</th>
                <th className="p-3 text-end font-medium">{t('ecart')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.seller.id} className="border-t">
                  <td className="p-3 font-medium" data-cell="main">
                    {r.seller.fullName}
                  </td>
                  <td className="num p-3 text-end" data-label={t('visitRate')}>
                    {pct(r.visitRate)}{' '}
                    <span className="text-xs text-muted-foreground">
                      ({r.visitedStops}/{r.plannedStops})
                    </span>
                  </td>
                  <td className="num p-3 text-end" data-label={t('strikeRate')}>
                    {pct(r.strikeRate)}
                  </td>
                  <td className="num p-3 text-end" data-label={t('visits')}>
                    {r.visits}
                  </td>
                  <td className="p-3 text-end" data-label={t('ordersDelivered')}>
                    <span className="num">
                      {r.delivered}/{r.orders}
                    </span>
                    {r.shortLines > 0 ? (
                      <span className="block text-xs text-amber-700 dark:text-amber-400">
                        {t('shortLinesCount', { count: r.shortLines })}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={cn('p-3 text-end', money(r.ecart).lt(0) && 'text-destructive')}
                    data-label={t('ecart')}
                  >
                    {r.closings > 0 ? (
                      <>
                        {money(r.ecart).lt(0) ? '−' : ''}
                        <Amount value={money(r.ecart).abs().toString()} />
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
