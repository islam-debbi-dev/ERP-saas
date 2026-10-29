'use client';

import { ArrowLeft, CalendarClock, Download, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { AGING_BUCKETS, type AgingReportDto, money, Permission } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { usePermission } from '@/lib/auth';
import { useCanManageCredit } from '@/lib/clients';
import { agingPath, useAging } from '@/lib/credit';
import { todayInAlgiers } from '@/lib/purchases';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';

type Kind = 'clients' | 'suppliers';

/** Balance âgée (phase 21): what each account has owed for 0–30, 31–60, 61–90, 90+ days. */
export function AgingReport() {
  const t = useTranslations('aging');
  const errorMessage = useErrorMessage();
  const canManage = useCanManageCredit();
  const canExport = usePermission(Permission.EXPORT_DATA);
  const [kind, setKind] = useState<Kind>('clients');
  const [asOf, setAsOf] = useState(todayInAlgiers);
  const report = useAging(kind, canManage ? asOf : '');
  const [exporting, setExporting] = useState(false);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const blob = await api.download(`${agingPath(kind)}/export.xlsx?asOf=${asOf}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `balance-agee-${kind === 'clients' ? 'clients' : 'fournisseurs'}-${asOf}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/rapports' },
        ]}
        actions={
          canExport && canManage ? (
            <Button onClick={() => void exportXlsx()} disabled={exporting || !report.data}>
              {exporting ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              {t('export')}
            </Button>
          ) : undefined
        }
      />
      {!canManage ? (
        <Alert role="status">
          <AlertDescription>{t('managersOnly')}</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="grid grid-cols-2 items-end gap-3 sm:flex">
            <div className="space-y-1">
              <Label htmlFor="aging-kind">{t('accounts')}</Label>
              <NativeSelect
                id="aging-kind"
                className="sm:w-48"
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
              >
                <option value="clients">{t('kindClients')}</option>
                <option value="suppliers">{t('kindSuppliers')}</option>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="aging-asof">{t('asOf')}</Label>
              <Input
                id="aging-asof"
                type="date"
                dir="ltr"
                value={asOf}
                max={todayInAlgiers()}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </div>
          </div>
          {report.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(report.error)}</AlertDescription>
            </Alert>
          ) : report.data ? (
            <AgingTable report={report.data} />
          ) : (
            <div className="grid gap-3" aria-busy>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}
        </>
      )}
    </>
  );
}

function AgingTable({ report }: { report: AgingReportDto }) {
  const t = useTranslations('aging');
  const base = report.kind === 'clients' ? '/clients' : '/achats/fournisseurs';
  const tone = (bucket: string, value: string) =>
    money(value).gt(0) && (bucket === 'd61_90' || bucket === 'd90') ? 'text-destructive' : '';

  return (
    <>
      {/* The totals first: on a phone they are what the owner looks for. */}
      <Card className="py-4">
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="col-span-2 sm:col-span-1">
            <p className="text-xs text-muted-foreground">{t('total')}</p>
            <Amount value={report.totals.balance} className="text-lg font-semibold" />
          </div>
          {AGING_BUCKETS.map((b) => (
            <div key={b}>
              <p className="text-xs text-muted-foreground">{t(`bucket.${b}`)}</p>
              <Amount
                value={report.totals.buckets[b]}
                className={cn('font-medium', tone(b, report.totals.buckets[b]))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {report.rows.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarClock} title={t('empty')} />
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="stack-table w-full min-w-[48rem] text-sm">
            <caption className="sr-only">
              {t('caption', {
                kind: t(report.kind === 'clients' ? 'kindClients' : 'kindSuppliers'),
              })}
            </caption>
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-3 text-start font-medium">{t('colAccount')}</th>
                <th className="p-3 text-end font-medium">{t('colBalance')}</th>
                {AGING_BUCKETS.map((b) => (
                  <th key={b} className="p-3 text-end font-medium">
                    {t(`bucket.${b}`)}
                  </th>
                ))}
                <th className="p-3 text-end font-medium">{t('colOldest')}</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.party.id} className="border-t">
                  <td data-cell="main" className="p-3">
                    <Link
                      href={`${base}/${r.party.id}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {r.party.name}
                    </Link>
                    {r.party.code ? (
                      <span dir="ltr" className="text-xs text-muted-foreground">
                        {r.party.code}
                      </span>
                    ) : null}
                  </td>
                  <td data-label={t('colBalance')} className="p-3 text-end font-semibold">
                    <Amount value={r.balance} />
                  </td>
                  {AGING_BUCKETS.map((b) => (
                    <td
                      key={b}
                      data-label={t(`bucket.${b}`)}
                      className={cn('p-3 text-end', tone(b, r.buckets[b]))}
                    >
                      {money(r.buckets[b]).isZero() ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Amount value={r.buckets[b]} />
                      )}
                    </td>
                  ))}
                  <td data-label={t('colOldest')} className="num p-3 text-end">
                    {r.oldestDays === null ? '—' : t('days', { n: r.oldestDays })}
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
