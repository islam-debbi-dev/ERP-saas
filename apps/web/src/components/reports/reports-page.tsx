'use client';

import { CalendarClock, Tags, ChartColumn, Download, Loader2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import {
  Feature,
  monthToDate,
  REPORT_GROUPS,
  SALES_FORCE_GROUPS,
  type ReportColumn,
  type ReportDto,
  type ReportGroupBy,
  type ReportName,
  type PaymentMode,
  Permission,
  type ReportRow,
  REPORTS_BY_ROLE,
  type StockMovementType,
  OFFICE_ROLES,
  isTeamLead,
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
import { useAuth, useFeature, usePermission } from '@/lib/auth';
import { useBrands, useIsOffice, useSellers } from '@/lib/sales-force';
import { useUnitLabel } from '@/lib/catalog';
import { todayInAlgiers } from '@/lib/purchases';
import { downloadReport, type ReportParams, useReport } from '@/lib/reports';
import { formatQty } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { useWarehouseFilter } from '@/lib/warehouse-scope';
import { cn } from '@/lib/utils';
import { Amount } from '@/components/shared/amount';

const NUMERIC: ReadonlySet<ReportColumn['kind']> = new Set(['count', 'qty', 'money', 'percent']);

export function ReportsPage() {
  const t = useTranslations('reports');
  const ta = useTranslations('aging');
  const errorMessage = useErrorMessage();
  const { state } = useAuth();
  const byRole = state.status === 'authenticated' ? REPORTS_BY_ROLE[state.user.role] : [];
  const month = monthToDate(todayInAlgiers());
  const [params, setParams] = useState<ReportParams>({
    name: 'sales',
    groupBy: 'day',
    from: month.from,
    to: month.to,
  });
  const [exporting, setExporting] = useState(false);
  const canExport = usePermission(Permission.EXPORT_DATA);
  const canSeeMargin = usePermission(Permission.VIEW_COST_AND_MARGIN);
  const allowed = byRole.filter((n) => n !== 'margin' || canSeeMargin);
  // A storekeeper has no sales report: start on the first one he has.
  const effective: ReportParams =
    allowed.length > 0 && !allowed.includes(params.name)
      ? { ...params, name: allowed[0]!, groupBy: REPORT_GROUPS[allowed[0]!][0] }
      : params;
  const report = useReport(effective);
  const warehouseId = useWarehouseFilter();
  const set = (patch: Partial<ReportParams>) => setParams({ ...effective, ...patch });

  // Sales force filters (phase 14): office roles narrow sales and versements by seller or
  // team, sales by brand. A seller's figures are always his own (API).
  const salesForce = useFeature(Feature.SALES_FORCE);
  // Charges (phase 25): managers' finance figures.
  const expensesOn = useFeature(Feature.EXPENSES);
  const canFinance = usePermission(Permission.REPORTS_FINANCE);
  const office = useIsOffice();
  const sellers = useSellers();
  const brands = useBrands();
  const supervisors = (sellers.data ?? []).filter((u) => isTeamLead(u.role));
  const peopleFilters = office && (effective.name === 'sales' || effective.name === 'payments');
  const brandFilter = effective.name === 'sales';
  const groups = REPORT_GROUPS[effective.name].filter(
    (g) => salesForce || !SALES_FORCE_GROUPS.includes(g),
  );
  const invalidRange = effective.from > effective.to;

  const exportXlsx = async () => {
    setExporting(true);
    try {
      await downloadReport({ ...effective, warehouseId });
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
          (state.user?.role === 'OWNER' || state.user?.role === 'MANAGER') && {
            label: ta('title'),
            icon: CalendarClock,
            href: '/rapports/balance-agee',
          },
          expensesOn &&
            canFinance && {
              label: t('chargesLink'),
              icon: Wallet,
              href: '/rapports/charges',
            },
          salesForce &&
            !!state.user &&
            OFFICE_ROLES.includes(state.user.role) && {
              label: t('sellOutLink'),
              icon: Tags,
              href: '/rapports/sell-out',
            },
        ]}
        actions={
          canExport ? (
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
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-end gap-3 max-md:[&>*]:w-full">
        <div className="space-y-1">
          <Label htmlFor="report-name">{t('report')}</Label>
          <NativeSelect
            id="report-name"
            className="w-56 max-md:w-full"
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
            className="w-44 max-md:w-full"
            value={effective.groupBy}
            onChange={(e) => set({ groupBy: e.target.value as ReportGroupBy })}
          >
            {groups.map((g) => (
              <option key={g} value={g}>
                {t(`groups.${g}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        {peopleFilters ? (
          <div className="space-y-1">
            <Label htmlFor="report-seller">{t('filterSeller')}</Label>
            <NativeSelect
              id="report-seller"
              className="w-48 max-md:w-full"
              value={effective.sellerId ?? ''}
              onChange={(e) => set({ sellerId: e.target.value })}
            >
              <option value="">{t('allSellers')}</option>
              {(sellers.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        {peopleFilters && salesForce && supervisors.length > 0 ? (
          <div className="space-y-1">
            <Label htmlFor="report-team">{t('filterTeam')}</Label>
            <NativeSelect
              id="report-team"
              className="w-48 max-md:w-full"
              value={effective.teamOf ?? ''}
              onChange={(e) => set({ teamOf: e.target.value })}
            >
              <option value="">{t('allTeams')}</option>
              {supervisors.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        {brandFilter && (brands.data ?? []).length > 0 ? (
          <div className="space-y-1">
            <Label htmlFor="report-brand">{t('filterBrand')}</Label>
            <NativeSelect
              id="report-brand"
              className="w-48 max-md:w-full"
              value={effective.brandId ?? ''}
              onChange={(e) => set({ brandId: e.target.value })}
            >
              <option value="">{t('allBrands')}</option>
              {(brands.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="report-from">{t('from')}</Label>
          <Input
            id="report-from"
            type="date"
            dir="ltr"
            className="w-44 max-md:w-full"
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
            className="w-44 max-md:w-full"
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
      // An office report: on a phone it scrolls in its own box, first column pinned (docs/ui.md rule 2).
      data-scroll-x=""
      className={cn(
        'w-full overflow-x-auto rounded-lg border bg-card transition-opacity',
        'max-md:[&_tr>*:first-child]:sticky max-md:[&_tr>*:first-child]:start-0 max-md:[&_tr>*:first-child]:z-10 max-md:[&_td:first-child]:bg-card max-md:[&_th:first-child]:bg-muted',
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
            : c.key === 'brand'
              ? t('none.brand')
              : c.key === 'sector'
                ? t('none.sector')
                : c.key === 'user'
                  ? t('none.user')
                  : t('none.other');
      // The counter client has no code: its name cell says so, the code cell stays empty.
      return c.key === 'code' ? null : <span className="text-muted-foreground">{none}</span>;
    }
    switch (c.kind) {
      case 'money':
        return (
          <span dir="ltr" className="num">
            <Amount value={value} currency={false} />
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
