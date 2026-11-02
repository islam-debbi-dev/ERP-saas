'use client';

import { ArrowLeft, Download, Loader2, ReceiptText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { type ChargesReportDto, Feature, monthToDate, Permission } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useFeature, usePermission } from '@/lib/auth';
import { type ChargesParams, downloadCharges, useCharges } from '@/lib/expenses';
import { todayInAlgiers } from '@/lib/purchases';
import { useErrorMessage } from '@/lib/use-error-message';
import { useWarehouseFilter } from '@/lib/warehouse-scope';

/**
 * Charges of a period (phase 25): rent charged by day from the baux, plus the other
 * dépenses spread over the period they cover. Rent paid is shown apart (cash).
 */
export function ChargesReport() {
  return (
    <FeatureGate feature={Feature.EXPENSES}>
      <Report />
    </FeatureGate>
  );
}

function Report() {
  const t = useTranslations('charges');
  const errorMessage = useErrorMessage();
  const allowed = usePermission(Permission.REPORTS_FINANCE);
  const canExport = usePermission(Permission.EXPORT_DATA);
  const warehouseId = useWarehouseFilter();
  const [range, setRange] = useState(() => monthToDate(todayInAlgiers()));
  const params: ChargesParams = { ...range, warehouseId };
  const report = useCharges(params, allowed);
  const [exporting, setExporting] = useState(false);
  const invalid = range.from > range.to;

  const exportXlsx = async () => {
    setExporting(true);
    try {
      await downloadCharges(params);
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
          canExport && allowed ? (
            <Button
              onClick={() => void exportXlsx()}
              disabled={exporting || invalid || !report.data}
            >
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
      {!allowed ? (
        <Alert role="status">
          <AlertDescription>{t('managersOnly')}</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="grid grid-cols-2 items-end gap-3 sm:flex">
            <div className="space-y-1">
              <Label htmlFor="charges-from">{t('from')}</Label>
              <Input
                id="charges-from"
                type="date"
                dir="ltr"
                value={range.from}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="charges-to">{t('to')}</Label>
              <Input
                id="charges-to"
                type="date"
                dir="ltr"
                min={range.from}
                aria-invalid={invalid}
                value={range.to}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              />
            </div>
          </div>
          {invalid ? (
            <Alert variant="destructive">
              <AlertDescription>{t('invalidRange')}</AlertDescription>
            </Alert>
          ) : report.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(report.error)}</AlertDescription>
            </Alert>
          ) : report.data ? (
            <ChargesTables report={report.data} />
          ) : (
            <div className="grid gap-3" aria-busy>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          )}
        </>
      )}
    </>
  );
}

function ChargesTables({ report }: { report: ChargesReportDto }) {
  const t = useTranslations('charges');
  const multiUnit = useFeature(Feature.MULTI_UNIT);
  const empty = report.byCategory.length === 0;

  return (
    <>
      {/* The totals first: on a phone they are what the owner looks for. */}
      <Card className="py-4">
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <p className="text-xs text-muted-foreground">{t('total')}</p>
            <Amount value={report.total} className="text-lg font-semibold" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('rent')}</p>
            <Amount value={report.rent} className="font-medium" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('expenses')}</p>
            <Amount value={report.expenses} className="font-medium" />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className="text-xs text-muted-foreground">{t('rentPaid')}</p>
            <Amount value={report.rentPaid} className="font-medium" />
            <p className="text-xs text-muted-foreground">{t('rentPaidHelp')}</p>
          </div>
        </CardContent>
      </Card>

      {empty ? (
        <Card>
          <EmptyState icon={ReceiptText} title={t('empty')} />
        </Card>
      ) : (
        <>
          <ChargesTable
            caption={t('byCategory')}
            head={t('colCategory')}
            rows={report.byCategory.map((r) => ({
              key: r.category.id,
              name: r.category.name,
              rent: r.rent,
              expenses: r.expenses,
              total: r.total,
            }))}
            report={report}
          />
          {multiUnit ? (
            <ChargesTable
              caption={t('byDepot')}
              head={t('colDepot')}
              rows={report.byWarehouse.map((r) => ({
                key: r.warehouse?.id ?? 'none',
                name: r.warehouse?.name ?? t('noDepot'),
                rent: r.rent,
                expenses: r.expenses,
                total: r.total,
              }))}
              report={report}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function ChargesTable({
  caption,
  head,
  rows,
  report,
}: {
  caption: string;
  head: string;
  rows: { key: string; name: string; rent: string; expenses: string; total: string }[];
  report: ChargesReportDto;
}) {
  const t = useTranslations('charges');
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{caption}</h2>
      <div className="rounded-lg border bg-card">
        <table className="stack-table w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="p-3 text-start font-medium">{head}</th>
              <th className="p-3 text-end font-medium">{t('rent')}</th>
              <th className="p-3 text-end font-medium">{t('expenses')}</th>
              <th className="p-3 text-end font-medium">{t('total')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t">
                <td data-cell="main" className="p-3 font-medium">
                  <span className="block truncate" title={r.name}>
                    {r.name}
                  </span>
                </td>
                <td data-label={t('rent')} className="p-3 text-end">
                  <Amount value={r.rent} />
                </td>
                <td data-label={t('expenses')} className="p-3 text-end">
                  <Amount value={r.expenses} />
                </td>
                <td data-label={t('total')} className="p-3 text-end font-semibold">
                  <Amount value={r.total} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/30 font-semibold">
            <tr>
              <td data-cell="main" className="p-3">
                {t('total')}
              </td>
              <td data-label={t('rent')} className="p-3 text-end">
                <Amount value={report.rent} />
              </td>
              <td data-label={t('expenses')} className="p-3 text-end">
                <Amount value={report.expenses} />
              </td>
              <td data-label={t('total')} className="p-3 text-end">
                <Amount value={report.total} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
