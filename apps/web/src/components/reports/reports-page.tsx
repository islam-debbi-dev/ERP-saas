'use client';

import { ChartColumn, Download, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import {
  formatDA,
  monthToDate,
  REPORT_GROUPS,
  type ReportColumn,
  type ReportDto,
  type ReportGroupBy,
  type ReportName,
  type PaymentMode,
  type ReportRow,
  REPORTS_BY_ROLE,
  type StockMovementType,
} from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { useUnitLabel } from '@/lib/catalog';
import { todayInAlgiers } from '@/lib/purchases';
import { downloadReport, type ReportParams, useReport } from '@/lib/reports';
import { formatQty } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';

const NUMERIC: ReadonlySet<ReportColumn['kind']> = new Set(['count', 'qty', 'money', 'percent']);

export function ReportsPage() {
  const t = useTranslations('reports');
  const errorMessage = useErrorMessage();
  const { state } = useAuth();
  const allowed = state.status === 'authenticated' ? REPORTS_BY_ROLE[state.user.role] : [];
  const month = monthToDate(todayInAlgiers());
  const [params, setParams] = useState<ReportParams>({
    name: 'sales',
    groupBy: 'day',
    from: month.from,
    to: month.to,
  });
  const [exporting, setExporting] = useState(false);
  // A storekeeper has no sales report: start on the first one he has.
  const effective: ReportParams =
    allowed.length > 0 && !allowed.includes(params.name)
      ? { ...params, name: allowed[0]!, groupBy: REPORT_GROUPS[allowed[0]!][0] }
      : params;
  const report = useReport(effective);
  const set = (patch: Partial<ReportParams>) => setParams({ ...effective, ...patch });
  const invalidRange = effective.from > effective.to;

  const exportXlsx = async () => {
    setExporting(true);
    try {
      await downloadReport(effective);
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
        actions={
          <Button
            onClick={() => void exportXlsx()}
            disabled={exporting || invalidRange || !report.data}
          >
            {exporting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            {t('export')}
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="report-name">{t('report')}</Label>
          <NativeSelect
            id="report-name"
            className="w-56"
            value={effective.name}
            onChange={(e) => {
              const name = e.target.value as ReportName;
              set({ name, groupBy: REPORT_GROUPS[name][0] });
            }}
          >
            {allowed.map((n) => (
              <option key={n} value={n}>
                {t(`names.${n}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-group">{t('groupBy')}</Label>
          <NativeSelect
            id="report-group"
            className="w-44"
            value={effective.groupBy}
            onChange={(e) => set({ groupBy: e.target.value as ReportGroupBy })}
          >
            {REPORT_GROUPS[effective.name].map((g) => (
              <option key={g} value={g}>
                {t(`groups.${g}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-from">{t('from')}</Label>
          <Input
            id="report-from"
            type="date"
            dir="ltr"
            className="w-44"
            value={effective.from}
            max={effective.to}
            onChange={(e) => set({ from: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-to">{t('to')}</Label>
          <Input
            id="report-to"
            type="date"
            dir="ltr"
            className="w-44"
            value={effective.to}
            min={effective.from}
            onChange={(e) => set({ to: e.target.value })}
          />
        </div>
      </div>
      {invalidRange ? (
        <p role="alert" className="text-sm text-destructive">
          {t('invalidRange')}
        </p>
      ) : report.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(report.error)}
        </p>
      ) : !report.data ? (
        <Skeleton className="h-64 w-full" aria-busy />
      ) : report.data.rows.length === 0 ? (
        <EmptyState icon={ChartColumn} title={t('empty')} />
      ) : (
        <ReportTable report={report.data} loading={report.isFetching} />
      )}
    </>
  );
}

function ReportTable({ report, loading }: { report: ReportDto; loading: boolean }) {
  const t = useTranslations('reports');
  const cell = useCellFormatter();
  const firstText = report.columns.findIndex((c) => !NUMERIC.has(c.kind));
  return (
    <div
      className={cn(
        'w-full overflow-x-auto rounded-lg border bg-card transition-opacity',
        loading && 'opacity-60',
      )}
    >
      <Table className="min-w-[40rem]">
        <caption className="sr-only">{t(`names.${report.name}`)}</caption>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            {report.columns.map((c) => (
              <TableHead key={c.key} className={cn(NUMERIC.has(c.kind) && 'text-end')}>
                {t(`columns.${c.key}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.rows.map((r) => (
            <TableRow key={r.key ?? 'none'}>
              {report.columns.map((c, i) => (
                <TableCell key={c.key} className={cn(NUMERIC.has(c.kind) && 'text-end')}>
                  {i === firstText ? (
                    <Linked row={r}>{cell(c, r.values[c.key] ?? null)}</Linked>
                  ) : (
                    cell(c, r.values[c.key] ?? null)
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            {report.columns.map((c, i) => (
              <TableCell
                key={c.key}
                className={cn('font-semibold', NUMERIC.has(c.kind) && 'text-end')}
              >
                {report.totals[c.key] !== undefined
                  ? cell(c, report.totals[c.key] ?? null)
                  : i === 0
                    ? t('total')
                    : null}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function Linked({ row, children }: { row: ReportRow; children: ReactNode }) {
  if (!row.link) return <>{children}</>;
  const href = row.link.type === 'client' ? `/clients/${row.link.id}` : `/stock/${row.link.id}`;
  return (
    <Link href={href} className="font-medium underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}

/** Formats a cell by its column kind; a null label is the "none" group of that column. */
function useCellFormatter() {
  const t = useTranslations('reports');
  const ts = useTranslations('sales');
  const tm = useTranslations('movementTypes');
  const format = useFormatter();
  const unitLabel = useUnitLabel();
  return function formatCell(c: ReportColumn, value: string | null): ReactNode {
    if (value === null) {
      const none =
        c.key === 'code' || c.key === 'name'
          ? t('none.client')
          : c.key === 'category'
            ? t('none.category')
            : t('none.other');
      // The counter client has no code: its name cell says so, the code cell stays empty.
      return c.key === 'code' ? null : <span className="text-muted-foreground">{none}</span>;
    }
    switch (c.kind) {
      case 'money':
        return (
          <span dir="ltr" className="num">
            {formatDA(value, { currency: false })}
          </span>
        );
      case 'qty':
      case 'count':
        return (
          <span dir="ltr" className="num">
            {formatQty(value)}
          </span>
        );
      case 'percent':
        return (
          <span dir="ltr" className="num">
            {`${value.replace('.', ',')} %`}
          </span>
        );
      case 'day':
        return format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: 'medium' });
      case 'month':
        return format.dateTime(new Date(`${value}-15T12:00:00Z`), {
          month: 'long',
          year: 'numeric',
        });
      case 'enum':
        return c.key === 'mode'
          ? ts(`mode${value as PaymentMode}`)
          : tm(value as StockMovementType);
      default:
        return c.key === 'unit' ? unitLabel({ code: value, name: value }) : value;
    }
  };
}
