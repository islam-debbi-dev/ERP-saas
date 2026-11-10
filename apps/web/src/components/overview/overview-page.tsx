'use client';

import { ArrowDownUp, ChevronRight, Download, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  type DayRange,
  Feature,
  money,
  type OverviewFigures,
  type OverviewPeriod,
  OVERVIEW_PERIODS,
  overviewQuerySchema,
  type OverviewWarehouse,
  periodRange,
  Permission,
} from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/lib/auth';
import { downloadOverview, useOverview } from '@/lib/overview';
import { todayInAlgiers } from '@/lib/purchases';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { useWarehouseScope } from '@/lib/warehouse-scope';
import { Sparkline } from './sparkline';

type View = 'cards' | 'compare';

/**
 * Vue d'ensemble (phase 26, MULTI_UNIT): how every dépôt the user sees is doing, on one
 * screen. The total first, then one card per dépôt; a card opens the dashboard on that
 * dépôt. "Comparer" puts the same figures side by side.
 */
export function OverviewPage() {
  return (
    <FeatureGate feature={Feature.MULTI_UNIT}>
      <Overview />
    </FeatureGate>
  );
}

/** A valid ?from=&to= range (at most a year), or null: a bad link opens the month. */
function linkedRange(from: string | null, to: string | null): DayRange | null {
  const parsed = overviewQuerySchema.safeParse({ from, to });
  return parsed.success ? parsed.data : null;
}

function Overview() {
  const t = useTranslations('overview');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const allowed = usePermission(Permission.REPORTS_FINANCE);
  const canExport = usePermission(Permission.EXPORT_DATA);
  // Phase 33: the dashboard opens this page on its period with ?from=&to= (read once).
  const params = useSearchParams();
  const linked = linkedRange(params.get('from'), params.get('to'));
  const [period, setPeriod] = useState<OverviewPeriod>(linked ? 'custom' : 'month');
  const [custom, setCustom] = useState<DayRange>(
    () => linked ?? periodRange('month', todayInAlgiers()),
  );
  const [view, setView] = useState<View>('cards');
  const [exporting, setExporting] = useState(false);
  const range = period === 'custom' ? custom : periodRange(period, todayInAlgiers());
  const invalid = range.from === '' || range.to === '' || range.from > range.to;
  const overview = useOverview(range, allowed);
  const o = overview.data;

  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { day: 'numeric', month: 'short' });
  const span = (r: DayRange) =>
    r.from === r.to ? day(r.from) : t('periodSpan', { from: day(r.from), to: day(r.to) });

  const exportXlsx = async () => {
    setExporting(true);
    try {
      await downloadOverview(range);
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
        description={
          o && !invalid
            ? t('comparedTo', {
                period: span(o),
                previous: span({ from: o.previousFrom, to: o.previousTo }),
              })
            : t('subtitle')
        }
        actions={
          canExport && allowed && view === 'compare' ? (
            <Button onClick={() => void exportXlsx()} disabled={exporting || invalid || !o}>
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
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <fieldset className="min-w-0">
              <legend className="sr-only">{t('period')}</legend>
              <div className="flex flex-wrap gap-2">
                {OVERVIEW_PERIODS.map((p) => (
                  <Button
                    key={p}
                    type="button"
                    size="sm"
                    variant={period === p ? 'default' : 'outline'}
                    aria-pressed={period === p}
                    className="h-11 md:h-9"
                    onClick={() => {
                      if (p === 'custom' && period !== 'custom') setCustom(range);
                      setPeriod(p);
                    }}
                  >
                    {t(`period_${p}`)}
                  </Button>
                ))}
              </div>
            </fieldset>
            <div
              role="group"
              aria-label={t('viewLabel')}
              className="flex gap-1 rounded-lg bg-muted p-1"
            >
              {(['cards', 'compare'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  className={cn(
                    'h-11 flex-1 rounded-md px-4 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none md:h-8 md:flex-none',
                    view === v
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setView(v)}
                >
                  {t(`view_${v}`)}
                </button>
              ))}
            </div>
          </div>
          {period === 'custom' ? (
            <div className="grid grid-cols-2 items-end gap-3 sm:flex">
              <div className="space-y-1">
                <Label htmlFor="overview-from">{t('from')}</Label>
                <Input
                  id="overview-from"
                  type="date"
                  dir="ltr"
                  value={custom.from}
                  onChange={(e) => setCustom((r) => ({ ...r, from: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="overview-to">{t('to')}</Label>
                <Input
                  id="overview-to"
                  type="date"
                  dir="ltr"
                  min={custom.from}
                  aria-invalid={invalid}
                  value={custom.to}
                  onChange={(e) => setCustom((r) => ({ ...r, to: e.target.value }))}
                />
              </div>
            </div>
          ) : null}
          {invalid ? (
            <Alert variant="destructive">
              <AlertDescription>{t('invalidRange')}</AlertDescription>
            </Alert>
          ) : overview.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(overview.error)}</AlertDescription>
            </Alert>
          ) : !o ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-96 w-full" />
              ))}
            </div>
          ) : view === 'cards' ? (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <UnitCard name={t('allWarehouses')} figures={o.total} warehouseId="" total />
              {o.warehouses.map((w) => (
                <UnitCard
                  key={w.warehouse.id}
                  name={w.warehouse.name}
                  figures={w}
                  warehouseId={w.warehouse.id}
                />
              ))}
            </div>
          ) : (
            <CompareTable rows={o.warehouses} total={o.total} />
          )}
        </>
      )}
    </>
  );
}

/** ▲ / ▼ with the sign, and the words for screen readers: never colour alone. */
function Change({ pct }: { pct: string | null }) {
  const t = useTranslations('overview');
  if (pct === null)
    return <span className="text-xs text-muted-foreground">{t('noComparison')}</span>;
  const value = money(pct);
  const up = value.gte(0);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap',
        up ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive',
      )}
    >
      <span
        dir="ltr"
        className="num"
      >{`${up ? '▲ +' : '▼ '}${value.toFixed(1).replace('.', ',')} %`}</span>
      <span className="sr-only">{t('vsPrevious')}</span>
    </span>
  );
}

/** A signed amount: red with its minus sign when negative. */
function Signed({ value, className }: { value: string; className?: string }) {
  return (
    <Amount
      value={value}
      className={cn(money(value).isNegative() && 'text-destructive', className)}
    />
  );
}

function Line({
  label,
  children,
  strong,
}: {
  label: string;
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt
        className={cn(
          'min-w-0 truncate text-muted-foreground',
          strong && 'font-medium text-foreground',
        )}
      >
        {label}
      </dt>
      <dd className={cn('shrink-0 text-end', strong && 'font-semibold')}>{children}</dd>
    </div>
  );
}

function UnitCard({
  name,
  figures: f,
  warehouseId,
  total,
}: {
  name: string;
  figures: OverviewFigures;
  /** '' = every dépôt. */
  warehouseId: string;
  total?: boolean;
}) {
  const t = useTranslations('overview');
  const router = useRouter();
  const { setWarehouseId } = useWarehouseScope();
  const open = () => {
    setWarehouseId(warehouseId);
    router.push('/tableau-de-bord');
  };

  return (
    <Card className={cn('gap-0 py-0', total && 'border-primary/60 ring-1 ring-primary/20')}>
      <button
        type="button"
        onClick={open}
        aria-label={t('openDashboard', { name })}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-t-xl px-4 pt-4 pb-2 text-start hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <h2 dir="auto" className="min-w-0 truncate text-base font-semibold" title={name}>
          {name}
        </h2>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
          aria-hidden
        />
      </button>
      <CardContent className="space-y-3 px-4 pb-4">
        <div>
          <p className="text-xs text-muted-foreground">{t('revenue')}</p>
          <Amount value={f.sales.ttc} className="block text-2xl font-semibold" />
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{t('salesCount', { count: f.sales.count })}</span>
            <Change pct={f.sales.changePct} />
          </div>
        </div>
        <Sparkline days={f.sales.perDay} label={t('sparklineLabel', { name })} />
        <dl className="divide-y text-sm">
          <Line label={t('cashIn')}>
            <Amount value={f.cashIn} />
          </Line>
          <Line label={t('cashOut')}>
            <Amount value={f.cashOut.total} />
          </Line>
          <Line label={t('netCash')} strong>
            <Signed value={f.netCash} />
          </Line>
          {f.balances ? (
            <>
              <Line label={t('balanceCaisses')}>
                <Amount value={f.balances.caisses} />
              </Line>
              <Line label={t('balanceBanques')}>
                <Amount value={f.balances.banques} />
              </Line>
            </>
          ) : null}
          {f.margin !== null ? (
            <Line label={t('margin')}>
              <Amount value={f.margin} />
            </Line>
          ) : null}
          {f.charges !== null ? (
            <Line label={t('charges')}>
              <Amount value={f.charges} />
            </Line>
          ) : null}
          {f.netResult !== null ? (
            <Line label={t('netResult')} strong>
              <Signed value={f.netResult} />
            </Line>
          ) : null}
          <Line label={t('credit')}>
            <span className="flex flex-col items-end">
              <Amount value={f.credit.total} />
              {f.credit.over90Pct !== null ? (
                <span className="text-xs text-muted-foreground">
                  {t('over90', { pct: f.credit.over90Pct.replace('.', ',') })}
                </span>
              ) : null}
            </span>
          </Line>
          {f.stock.value !== null ? (
            <Line label={t('stockValue')}>
              <Amount value={f.stock.value} />
            </Line>
          ) : null}
          <Line label={t('lowStock')}>
            <span className={cn('num', f.stock.lowStock > 0 && 'font-medium')}>
              {f.stock.lowStock}
            </span>
          </Line>
          <Line label={t('topSeller')}>
            {f.topSeller ? (
              <span className="flex max-w-40 flex-col items-end">
                <span dir="auto" className="max-w-full truncate" title={f.topSeller.fullName}>
                  {f.topSeller.fullName}
                </span>
                <Amount value={f.topSeller.ttc} className="text-xs text-muted-foreground" />
              </span>
            ) : (
              <span className="text-muted-foreground">{t('none')}</span>
            )}
          </Line>
        </dl>
      </CardContent>
    </Card>
  );
}

type SortKey =
  | 'name'
  | 'revenue'
  | 'change'
  | 'count'
  | 'cashIn'
  | 'cashOut'
  | 'netCash'
  | 'margin'
  | 'charges'
  | 'netResult'
  | 'credit'
  | 'over90'
  | 'stockValue'
  | 'lowStock';

interface Column {
  key: Exclude<SortKey, 'name'>;
  value: (f: OverviewFigures) => string | number | null;
  kind: 'money' | 'signed' | 'pct' | 'count';
}

const COLUMNS: Column[] = [
  { key: 'revenue', value: (f) => f.sales.ttc, kind: 'money' },
  { key: 'change', value: (f) => f.sales.changePct, kind: 'pct' },
  { key: 'count', value: (f) => f.sales.count, kind: 'count' },
  { key: 'cashIn', value: (f) => f.cashIn, kind: 'money' },
  { key: 'cashOut', value: (f) => f.cashOut.total, kind: 'money' },
  { key: 'netCash', value: (f) => f.netCash, kind: 'signed' },
  { key: 'margin', value: (f) => f.margin, kind: 'money' },
  { key: 'charges', value: (f) => f.charges, kind: 'money' },
  { key: 'netResult', value: (f) => f.netResult, kind: 'signed' },
  { key: 'credit', value: (f) => f.credit.total, kind: 'money' },
  { key: 'over90', value: (f) => f.credit.over90Pct, kind: 'pct' },
  { key: 'stockValue', value: (f) => f.stock.value, kind: 'money' },
  { key: 'lowStock', value: (f) => f.stock.lowStock, kind: 'count' },
];

/** Dépôts as rows, sortable by any figure; columns the user may not see are left out. */
function CompareTable({ rows, total }: { rows: OverviewWarehouse[]; total: OverviewFigures }) {
  const t = useTranslations('overview');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'revenue', desc: true });
  const columns = COLUMNS.filter((c) => c.value(total) !== null || c.kind === 'pct');

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    const list = [...rows];
    list.sort((a, b) => {
      let cmp: number;
      if (!col) {
        cmp = a.warehouse.name.localeCompare(b.warehouse.name);
      } else {
        const x = col.value(a);
        const y = col.value(b);
        // An unknown figure (no comparison) goes last whatever the direction.
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
        cmp = money(x).cmp(money(y));
      }
      return sort.desc ? -cmp : cmp;
    });
    return list;
  }, [rows, sort]);

  const header = (key: SortKey, label: string, start = false) => {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
        className={cn(
          'border-b px-2 py-1 font-medium whitespace-nowrap',
          start ? 'sticky start-0 z-10 bg-card text-start' : 'text-end',
        )}
      >
        <button
          type="button"
          className={cn(
            'inline-flex min-h-11 items-center gap-1 rounded-md px-1 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            active ? 'text-foreground' : 'text-muted-foreground',
          )}
          onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }))}
        >
          {label}
          <ArrowDownUp className={cn('size-3.5', !active && 'opacity-40')} aria-hidden />
        </button>
      </th>
    );
  };

  const cell = (c: Column, f: OverviewFigures) => {
    const v = c.value(f);
    if (v === null) return <span className="text-muted-foreground">–</span>;
    if (c.kind === 'count') return <span className="num">{v}</span>;
    if (c.kind === 'pct') {
      return c.key === 'change' ? (
        <Change pct={String(v)} />
      ) : (
        <span dir="ltr" className="num">{`${String(v).replace('.', ',')} %`}</span>
      );
    }
    return c.kind === 'signed' ? (
      <Signed value={String(v)} />
    ) : (
      <Amount value={String(v)} currency={false} />
    );
  };

  return (
    <Card className="gap-0 py-0">
      <div
        className="overflow-x-auto"
        data-scroll-x
        role="region"
        aria-label={t('compareLabel')}
        tabIndex={0}
      >
        <table className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">{t('compareCaption')}</caption>
          <thead>
            <tr>
              {header('name', t('warehouse'), true)}
              {columns.map((c) => header(c.key, t(`col_${c.key}`)))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((w) => (
              <tr key={w.warehouse.id} className="hover:bg-muted/40">
                <th
                  scope="row"
                  dir="auto"
                  className="sticky start-0 max-w-40 truncate border-b bg-card px-3 py-2 text-start font-medium"
                  title={w.warehouse.name}
                >
                  {w.warehouse.name}
                </th>
                {columns.map((c) => (
                  <td key={c.key} className="border-b px-3 py-2 text-end whitespace-nowrap">
                    {cell(c, w)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" className="sticky start-0 bg-card px-3 py-2 text-start">
                {t('total')}
              </th>
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2 text-end whitespace-nowrap">
                  {cell(c, total)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-4 py-3 text-xs text-muted-foreground">{t('compareHint')}</p>
    </Card>
  );
}
