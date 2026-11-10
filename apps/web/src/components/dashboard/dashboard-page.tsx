'use client';

import {
  ChevronRight,
  LayoutGrid,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Fragment, type ReactNode, useState } from 'react';
import { z } from 'zod';
import {
  DASHBOARD_CARD_IDS,
  type DashboardCardId,
  DASHBOARD_PERIODS,
  type DashboardDto,
  type DashboardPeriod,
  type DebtorDto,
  type DueChequesDto,
  Feature,
  formatDA,
  money,
  Role,
} from '@erp/shared';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCanOpen } from '@/components/layout/use-visible-nav';
import { useAuth, useFeature } from '@/lib/auth';
import { drill } from '@/lib/dashboard-links';
import { useDashboardLayout } from '@/lib/dashboard-layout';
import { todoKeys } from '@/lib/todo';
import { todayInAlgiers } from '@/lib/purchases';
import { useCountUp } from '@/lib/use-count-up';
import {
  DEFAULT_PERIOD,
  type DashboardPeriodQuery,
  type FigureFilters,
  useDashboard,
} from '@/lib/reports';
import { useUrlFilters } from '@/lib/url-filters';
import { useBrands, useIsOffice, useSellers } from '@/lib/sales-force';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn, isolateLtr } from '@/lib/utils';
import { AttendanceTodayCard } from '@/components/hr/today-card';
import { MyObjectivesCard } from '@/components/incentives/my-objectives-card';
import { OnboardingCard } from './onboarding-card';
import { PullToRefresh, UpdatedBar } from './live-bar';
import { PeriodSwitcher, usePeriodName } from './period-switcher';
import { GreetingLine, TargetCard } from './target-card';
import { QuickActionButtons, QuickActionFab } from './quick-actions';
import { TopLists } from './top-lists';
import { SalesChart } from './sales-chart';
import { TodoCard } from './todo-card';
import { Amount } from '@/components/shared/amount';

/** A count shown while it counts up (decimal steps rounded for display). */
const integer = (v: string) => money(v).toFixed(0);

/** Loaded on the first tap of "Organiser" (dnd-kit stays out of the first load). */
const Organiser = dynamic(() => import('./organiser').then((m) => m.Organiser), { ssr: false });

/** Cards drawn from the dashboard's figures (the period switcher sits above the first). */
const DATA_CARDS: readonly DashboardCardId[] = [
  'figures',
  'target',
  'stock',
  'chart',
  'top',
  'debtors',
  'cheques',
];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DASHBOARD_URL_FILTERS = {
  period: z.enum(DASHBOARD_PERIODS),
  from: day,
  to: day,
  sellerId: z.uuid(),
  teamOf: z.uuid(),
  brandId: z.uuid(),
};

export function DashboardPage() {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  const { state } = useAuth();
  const errorMessage = useErrorMessage();
  // Phase 33: the period and the figure filters live in the URL, so a refresh keeps them.
  const [url, setUrl] = useUrlFilters(DASHBOARD_URL_FILTERS);
  const filters: FigureFilters = {
    sellerId: url.sellerId,
    teamOf: url.teamOf,
    brandId: url.brandId,
  };
  const custom = url.period === 'custom' && url.from !== '' && url.to !== '' && url.from <= url.to;
  const period: DashboardPeriodQuery =
    url.period && (url.period !== 'custom' || custom)
      ? {
          period: url.period as DashboardPeriod,
          from: custom ? url.from : '',
          to: custom ? url.to : '',
        }
      : DEFAULT_PERIOD;
  const setFilters = (f: FigureFilters) => setUrl(f);
  const setPeriod = (p: DashboardPeriodQuery) =>
    setUrl({ period: p.period === 'month' ? '' : p.period, from: p.from, to: p.to });
  const dashboard = useDashboard(filters, period);
  const d = dashboard.data;
  const queryClient = useQueryClient();
  const refreshAll = () => {
    void dashboard.refetch();
    void queryClient.invalidateQueries({ queryKey: todoKeys.all });
  };
  const name = state.status === 'authenticated' ? state.user.fullName : '';
  // Phase 33.5: his order and hidden cards; the period and filters sit above the first
  // card that shows figures.
  const layout = useDashboardLayout();
  const [organising, setOrganising] = useState(false);
  const visible = layout.order.filter((id) => !layout.hidden.includes(id));
  const firstData = visible.find((id) => DATA_CARDS.includes(id)) ?? null;

  return (
    <>
      <PageHeader
        title={t('welcome', { name })}
        // Today from the clock, not the API: the header does not move when the figures land.
        description={format.dateTime(new Date(`${d?.date ?? todayInAlgiers()}T12:00:00Z`), {
          dateStyle: 'full',
        })}
        actions={<QuickActionButtons />}
      />
      <GreetingLine fact={d?.greeting ?? null} />
      <UpdatedBar
        updatedAt={dashboard.dataUpdatedAt}
        fetching={dashboard.isFetching}
        onRefresh={refreshAll}
      />
      <PullToRefresh onRefresh={refreshAll} />
      <OnboardingCard />
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="min-h-11"
          aria-pressed={organising}
          onClick={() => setOrganising((o) => !o)}
        >
          <LayoutGrid aria-hidden />
          {t('organise')}
        </Button>
      </div>
      {organising ? (
        <Organiser
          layout={layout}
          available={availableCards(d)}
          onClose={() => setOrganising(false)}
        />
      ) : null}
      {layout.order
        .filter((id) => !layout.hidden.includes(id))
        .map((id) => {
          const controls =
            id === firstData ? (
              <Fragment key="controls">
                {d?.sales !== null ? (
                  <PeriodSwitcher value={period} range={d?.sales?.period} onChange={setPeriod} />
                ) : null}
                <FigureFilterBar value={filters} onChange={setFilters} />
              </Fragment>
            ) : null;
          let card: ReactNode;
          if (id === 'todo') card = <TodoCard />;
          else if (id === 'objectives') card = <MyObjectivesCard />;
          else if (id === 'attendance') card = <AttendanceTodayCard />;
          else if (dashboard.isError)
            card =
              id === firstData ? (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage(dashboard.error)}
                </p>
              ) : null;
          else if (!d)
            card =
              id === firstData ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy>
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} className="h-28 w-full" />
                  ))}
                </div>
              ) : null;
          else card = <Sections d={d} filters={filters} only={id} />;
          return (
            <Fragment key={id}>
              {controls}
              {card}
            </Fragment>
          );
        })}
      {/* Room for the phone's "+" button under the last card. */}
      <div className="h-16 md:hidden" aria-hidden />
      {/* Not while organising: it would cover the rows' buttons. */}
      {organising ? null : <QuickActionFab />}
    </>
  );
}

/**
 * Seller / team / brand filters of the sales figures (phase 14), for office roles. Folded
 * on a phone so the figures stay at the top.
 */
function FigureFilterBar({
  value,
  onChange,
}: {
  value: FigureFilters;
  onChange: (f: FigureFilters) => void;
}) {
  const t = useTranslations('dashboard');
  const office = useIsOffice();
  const salesForce = useFeature(Feature.SALES_FORCE);
  const sellers = useSellers();
  const brands = useBrands();
  if (!office) return null;
  const supervisors = (sellers.data ?? []).filter((u) => u.role === Role.SUPERVISOR);
  const active = [value.sellerId, value.teamOf, value.brandId].filter(Boolean).length;
  const set = (patch: Partial<FigureFilters>) => onChange({ ...value, ...patch });
  return (
    <details className="group rounded-lg border bg-card md:open:bg-card" open={active > 0}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium">
        <SlidersHorizontal className="size-4" aria-hidden />
        {t('filters')}
        {active > 0 ? (
          <span className="text-muted-foreground">({t('filtersActive', { count: active })})</span>
        ) : null}
      </summary>
      <div className="grid gap-3 px-4 pb-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="dash-seller">{t('filterSeller')}</Label>
          <NativeSelect
            id="dash-seller"
            value={value.sellerId}
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
        {salesForce && supervisors.length > 0 ? (
          <div className="space-y-1">
            <Label htmlFor="dash-team">{t('filterTeam')}</Label>
            <NativeSelect
              id="dash-team"
              value={value.teamOf}
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
        <div className="space-y-1">
          <Label htmlFor="dash-brand">{t('filterBrand')}</Label>
          <NativeSelect
            id="dash-brand"
            value={value.brandId}
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
        <p className="text-xs text-muted-foreground sm:col-span-3">{t('filtersHint')}</p>
      </div>
    </details>
  );
}

/** One card of the dashboard's data (phase 33.5: drawn in the user's order). */
function Sections({
  d,
  filters,
  only,
}: {
  d: DashboardDto;
  filters: FigureFilters;
  only: DashboardCardId;
}) {
  const t = useTranslations('dashboard');
  const ts = useTranslations('sales');
  const canOpen = useCanOpen();
  /** The href when the user may open that page, else no link (the card stays a figure). */
  const door = (href: string) => (canOpen(href) ? href : undefined);
  const periodName = usePeriodName();
  const range = d.sales?.period;
  return (
    <>
      {only === 'figures' && (d.sales || d.cash || d.credit) ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {d.sales ? (
            <>
              <Stat
                label={t('salesToday')}
                value={formatDA(d.sales.today.ttc)}
                raw={d.sales.today.ttc}
                render={formatDA}
                hint={t('documents', { count: d.sales.today.count })}
                href={door(drill.sales(d.date, d.date, filters))}
              />
              <Stat
                label={t('salesPeriod', { period: periodName(d.sales.period) })}
                value={formatDA(d.sales.current.ttc)}
                raw={d.sales.current.ttc}
                render={formatDA}
                href={door(drill.sales(d.sales.period.from, d.sales.period.to, filters))}
                hint={
                  <>
                    {t('documents', { count: d.sales.current.count })}
                    <Trend pct={d.sales.changePct} />
                  </>
                }
              />
              {d.sales.margin !== null ? (
                <Stat
                  label={t('marginPeriod', { period: periodName(d.sales.period) })}
                  value={formatDA(d.sales.margin)}
                  raw={d.sales.margin}
                  render={formatDA}
                  href={door(drill.overview(d.sales.period.from, d.sales.period.to))}
                />
              ) : null}
              {d.net ? (
                <Stat
                  label={t('netPeriod', { period: periodName(d.sales.period) })}
                  value={formatDA(d.net.result)}
                  raw={d.net.result}
                  render={formatDA}
                  negative={money(d.net.result).isNegative()}
                  href={door(drill.overview(d.sales.period.from, d.sales.period.to))}
                  hint={t('netHint', {
                    margin: isolateLtr(formatDA(d.net.margin)),
                    charges: isolateLtr(formatDA(d.net.charges)),
                  })}
                />
              ) : null}
            </>
          ) : null}
          {d.treasury ? (
            <Stat
              label={t('inTill')}
              value={formatDA(d.treasury.caisses)}
              raw={d.treasury.caisses}
              render={formatDA}
              href={door(drill.treasury())}
              hint={t('inBank', { amount: isolateLtr(formatDA(d.treasury.banques)) })}
            />
          ) : null}
          {d.cash ? (
            <Stat
              label={t('cashToday')}
              value={formatDA(d.cash.total)}
              raw={d.cash.total}
              render={formatDA}
              href={door(drill.versements(d.date))}
              hint={d.cash.byMode.length === 0 ? t('cashNone') : undefined}
              footer={
                d.cash.byMode.length === 0 ? undefined : (
                  // One door per mode, above the card's own link.
                  <span className="flex flex-wrap gap-x-1">
                    {d.cash.byMode.map((m) => {
                      const to = door(drill.versements(d.date, m.mode));
                      const body = (
                        <>
                          {to ? <span className="sr-only">{t('drillPrefix')} </span> : null}
                          {ts(`mode${m.mode}`)}{' '}
                          <span dir="ltr" className="num">
                            <Amount value={m.total} />
                          </span>
                        </>
                      );
                      return to ? (
                        <Link
                          key={m.mode}
                          href={to}
                          className="relative z-10 inline-flex min-h-11 items-center rounded-md px-1.5 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {body}
                        </Link>
                      ) : (
                        <span key={m.mode} className="inline-flex min-h-11 items-center px-1.5">
                          {body}
                        </span>
                      );
                    })}
                  </span>
                )
              }
            />
          ) : null}
          {d.credit ? (
            <Stat
              label={t('creditTotal')}
              value={formatDA(d.credit.total)}
              raw={d.credit.total}
              render={formatDA}
              hint={t('debtors', { count: d.credit.debtorCount })}
              href={door(drill.credit())}
            />
          ) : null}
          {d.credit ? (
            <Stat
              label={t('overLimit')}
              value={String(d.credit.overLimitCount)}
              raw={String(d.credit.overLimitCount)}
              render={integer}
              tone={d.credit.overLimitCount > 0 ? 'warn' : undefined}
              href={door(drill.overLimit())}
            />
          ) : null}
        </div>
      ) : null}

      {only === 'target' && d.target ? <TargetCard target={d.target} /> : null}

      {only === 'stock' && d.stock ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat
            label={t('outOfStock')}
            value={String(d.stock.outOfStock)}
            raw={String(d.stock.outOfStock)}
            render={integer}
            tone={d.stock.outOfStock > 0 ? 'warn' : undefined}
            href={door(drill.stock('out'))}
          />
          <Stat
            label={t('lowStock')}
            value={String(d.stock.lowStock)}
            raw={String(d.stock.lowStock)}
            render={integer}
            tone={d.stock.lowStock > 0 ? 'warn' : undefined}
            href={door(drill.stock('low'))}
          />
          {d.stock.value !== null ? (
            <div className="col-span-2 sm:col-span-1">
              <Stat
                label={t('stockValue')}
                value={formatDA(d.stock.value)}
                raw={d.stock.value}
                render={formatDA}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {only === 'chart' && d.sales ? (
        <Card className="gap-3 py-4">
          <CardHeader>
            <CardTitle role="heading" aria-level={2} className="text-base">
              {t('chartTitlePeriod')}{' '}
              <span className="font-normal text-muted-foreground">
                {range ? periodName(range) : null}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SalesChart
              points={d.sales.series}
              bucket={d.sales.period.bucket}
              salesHref={canOpen('/ventes') ? (from, to) => drill.sales(from, to, filters) : null}
            />
          </CardContent>
        </Card>
      ) : null}

      {only === 'top' && d.top ? <TopLists top={d.top} /> : null}

      {only === 'debtors' && d.credit ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <DebtorsCard title={t('topDebtors')} rows={d.credit.topDebtors} />
          <DebtorsCard title={t('overLimitList')} rows={d.credit.overLimit} />
        </div>
      ) : null}

      {only === 'cheques' && d.cheques ? <ChequesCard cheques={d.cheques} /> : null}
    </>
  );
}

/** The cards this user can have with these figures (the organiser lists only these). */
function availableCards(d: DashboardDto | undefined): DashboardCardId[] {
  const has: Record<DashboardCardId, boolean> = {
    todo: true,
    objectives: true,
    attendance: true,
    figures: !d || Boolean(d.sales || d.cash || d.credit),
    target: Boolean(d?.target),
    stock: Boolean(d?.stock),
    chart: Boolean(d?.sales),
    top: Boolean(d?.top),
    debtors: Boolean(d?.credit),
    cheques: Boolean(d?.cheques),
  };
  return DASHBOARD_CARD_IDS.filter((id) => has[id]);
}

/** Chèques à échéance (phase 21): to cash from clients, to cover for suppliers. */
function ChequesCard({ cheques }: { cheques: DueChequesDto }) {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  const side = (
    title: string,
    group: DueChequesDto['client'],
    href: (partyId: string) => string,
  ) => (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {t('chequesCount', { count: group.count })} · <Amount value={group.total} />
        </span>
      </div>
      {group.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noneToShow')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {group.items.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                {c.party ? (
                  <Link
                    href={href(c.party.id)}
                    dir="auto"
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {c.party.name}
                  </Link>
                ) : null}
                <p className="truncate text-xs text-muted-foreground">
                  {day(c.dueDate)}
                  {c.reference ? (
                    <>
                      {' · '}
                      <bdi dir="ltr">{c.reference}</bdi>
                    </>
                  ) : null}
                  {c.bank ? ` · ${c.bank}` : ''}
                </p>
              </div>
              <Amount value={c.amount} className="shrink-0 text-sm font-medium" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <Card className="gap-3 py-4">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-base">
          {t('chequesTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        {side(t('chequesClients'), cheques.client, (id) => `/clients/${id}`)}
        {side(t('chequesSuppliers'), cheques.supplier, (id) => `/achats/fournisseurs/${id}`)}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  footer,
  href,
  tone,
  negative,
  raw,
  render,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  /** Below the hint, above the card's link: may hold its own links (z-10). */
  footer?: ReactNode;
  /** Phase 33: the list behind the figure; the whole card opens it. */
  href?: string;
  tone?: 'warn';
  /** A loss: red, with its minus sign (never colour alone). */
  negative?: boolean;
  /** Phase 33: the raw figure, so a change after a refetch counts up to it. */
  raw?: string;
  render?: (raw: string) => string;
}) {
  const t = useTranslations('dashboard');
  const counted = useCountUp(raw ?? null);
  const text =
    raw !== undefined && render && counted.value !== null ? render(counted.value) : value;
  return (
    <Card
      className={cn(
        'relative h-full gap-1 py-4 motion-safe:transition-colors motion-safe:duration-300',
        counted.flash && 'border-primary',
        href &&
          'transition-colors hover:bg-muted/50 has-[a[data-door]:active]:bg-muted has-[a[data-door]:focus-visible]:ring-[3px] has-[a[data-door]:focus-visible]:ring-ring/50',
        tone === 'warn' && 'border-amber-500/60',
      )}
    >
      <CardContent className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          {href ? (
            // The link covers the whole card (after:inset-0); the footer's links sit above it.
            <Link
              href={href}
              data-door
              aria-label={t('drillLabel', { label })}
              className="text-sm text-muted-foreground outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
            >
              {label}
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">{label}</p>
          )}
          {href ? (
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
              aria-hidden
            />
          ) : null}
        </div>
        <p
          dir="ltr"
          className={cn(
            'num text-start text-2xl font-semibold rtl:text-end',
            negative && 'text-destructive',
          )}
        >
          {text}
        </p>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
        {footer ? <div className="-mx-1.5 text-xs text-muted-foreground">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}

/** The period against the one of the same length just before (computed by the API). */
function Trend({ pct }: { pct: string | null }) {
  const t = useTranslations('dashboard');
  if (pct === null) return null;
  const up = !money(pct).isNegative();
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'ms-2 inline-flex items-center gap-1',
        up ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span dir="ltr" className="num">
        {`${up ? '+' : ''}${pct.replace('.', ',')} %`}
      </span>
      <span>{t('vsPrevious')}</span>
    </span>
  );
}

function DebtorsCard({ title, rows }: { title: string; rows: DebtorDto[] }) {
  const t = useTranslations('dashboard');
  return (
    <Card className="gap-3 py-4">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-base">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noneToShow')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colClient')}</TableHead>
                <TableHead className="text-end">{t('colBalance')}</TableHead>
                <TableHead className="text-end">{t('colLimit')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  {/* max-w-0 + w-full: the name takes the room left and truncates, the amounts never move. */}
                  <TableCell className="w-full max-w-0">
                    <Link
                      href={`/clients/${r.id}`}
                      dir="auto"
                      title={r.name}
                      className="block truncate font-medium underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                      {r.code}
                    </span>
                  </TableCell>
                  <TableCell className="text-end">
                    <span dir="ltr" className="num font-medium">
                      <Amount value={r.balance} />
                    </span>
                  </TableCell>
                  <TableCell className="text-end text-muted-foreground">
                    <span dir="ltr" className="num">
                      {r.creditLimit ? <Amount value={r.creditLimit} /> : '—'}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
