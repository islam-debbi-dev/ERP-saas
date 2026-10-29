'use client';

import { TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { type DashboardDto, type DebtorDto, type DueChequesDto, formatDA, money } from '@erp/shared';
import { PageHeader } from '@/components/shared/page-header';
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
import { useAuth } from '@/lib/auth';
import { useDashboard } from '@/lib/reports';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { OnboardingCard } from './onboarding-card';
import { SalesChart } from './sales-chart';
import { Amount } from '@/components/shared/amount';

export function DashboardPage() {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  const { state } = useAuth();
  const errorMessage = useErrorMessage();
  const dashboard = useDashboard();
  const d = dashboard.data;
  const name = state.status === 'authenticated' ? state.user.fullName : '';

  return (
    <>
      <PageHeader
        title={t('welcome', { name })}
        description={
          d ? format.dateTime(new Date(`${d.date}T12:00:00Z`), { dateStyle: 'full' }) : undefined
        }
      />
      <OnboardingCard />
      {dashboard.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(dashboard.error)}
        </p>
      ) : !d ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <Sections d={d} />
      )}
    </>
  );
}

function Sections({ d }: { d: DashboardDto }) {
  const t = useTranslations('dashboard');
  const ts = useTranslations('sales');
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {d.sales || d.cash || d.credit ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {d.sales ? (
            <>
              <Stat
                label={t('salesToday')}
                value={formatDA(d.sales.today.ttc)}
                hint={t('documents', { count: d.sales.today.count })}
              />
              <Stat
                label={t('salesMonth')}
                value={formatDA(d.sales.month.ttc)}
                hint={
                  <>
                    {t('documents', { count: d.sales.month.count })}
                    <Trend current={d.sales.month.ttc} previous={d.sales.previousMonth.ttc} />
                  </>
                }
              />
              {d.sales.margin !== null ? (
                <Stat label={t('marginMonth')} value={formatDA(d.sales.margin)} />
              ) : null}
            </>
          ) : null}
          {d.cash ? (
            <Stat
              label={t('cashToday')}
              value={formatDA(d.cash.total)}
              hint={
                d.cash.byMode.length === 0 ? (
                  t('cashNone')
                ) : (
                  <span className="flex flex-wrap gap-x-3">
                    {d.cash.byMode.map((m) => (
                      <span key={m.mode}>
                        {ts(`mode${m.mode}`)}{' '}
                        <span dir="ltr" className="num">
                          <Amount value={m.total} />
                        </span>
                      </span>
                    ))}
                  </span>
                )
              }
            />
          ) : null}
          {d.credit ? (
            <Stat
              label={t('creditTotal')}
              value={formatDA(d.credit.total)}
              hint={t('debtors', { count: d.credit.debtorCount })}
              href="/clients"
            />
          ) : null}
          {d.credit ? (
            <Stat
              label={t('overLimit')}
              value={String(d.credit.overLimitCount)}
              tone={d.credit.overLimitCount > 0 ? 'warn' : undefined}
            />
          ) : null}
        </div>
      ) : null}

      {d.stock ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat
            label={t('outOfStock')}
            value={String(d.stock.outOfStock)}
            tone={d.stock.outOfStock > 0 ? 'warn' : undefined}
            href="/stock?filtre=rupture"
          />
          <Stat
            label={t('lowStock')}
            value={String(d.stock.lowStock)}
            tone={d.stock.lowStock > 0 ? 'warn' : undefined}
            href="/stock?filtre=bas"
          />
          {d.stock.value !== null ? (
            <div className="col-span-2 sm:col-span-1">
              <Stat label={t('stockValue')} value={formatDA(d.stock.value)} />
            </div>
          ) : null}
        </div>
      ) : null}

      {d.sales ? (
        <Card className="gap-3 py-4">
          <CardHeader>
            <CardTitle role="heading" aria-level={2} className="text-base">
              {t('chartTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SalesChart days={d.sales.perDay} />
          </CardContent>
        </Card>
      ) : null}

      {d.credit ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <DebtorsCard title={t('topDebtors')} rows={d.credit.topDebtors} />
          <DebtorsCard title={t('overLimitList')} rows={d.credit.overLimit} />
        </div>
      ) : null}

      {d.cheques ? <ChequesCard cheques={d.cheques} /> : null}
    </div>
  );
}

/** Chèques à échéance (phase 21): to cash from clients, to cover for suppliers. */
function ChequesCard({ cheques }: { cheques: DueChequesDto }) {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { weekday: 'short', day: 'numeric', month: 'short' });
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
  href,
  tone,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  href?: string;
  tone?: 'warn';
}) {
  const body = (
    <Card
      className={cn(
        'h-full gap-1 py-4',
        href && 'transition-colors hover:bg-muted/50',
        tone === 'warn' && 'border-amber-500/60',
      )}
    >
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p dir="ltr" className="num text-start text-2xl font-semibold rtl:text-end">
          {value}
        </p>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Month to date against the same days of last month. */
function Trend({ current, previous }: { current: string; previous: string }) {
  const t = useTranslations('dashboard');
  const prev = money(previous);
  if (prev.lte(0)) return null;
  const pct = money(current).minus(prev).div(prev).times(100);
  const up = pct.gte(0);
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
        {`${up ? '+' : ''}${pct.toFixed(1).replace('.', ',')} %`}
      </span>
      <span>{t('vsLastMonth')}</span>
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
