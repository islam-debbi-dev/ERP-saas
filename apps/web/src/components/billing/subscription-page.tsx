'use client';

import { CircleAlert, MessageCircle, ReceiptText } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { SubscriptionPaymentInfo, SubscriptionSummary } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useSubscription } from '@/lib/billing';
import { whatsappLink } from '@/lib/support';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { SubscriptionStatusBadge } from './subscription-status-badge';

/** Paramètres > Abonnement: plan, renewal date, usage against the limits, payments. */
export function SubscriptionPage() {
  const t = useTranslations('billing');
  const errorMessage = useErrorMessage();
  const sub = useSubscription();

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      {sub.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(sub.error)}
        </p>
      ) : !sub.data ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy>
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : (
        <Content s={sub.data} />
      )}
    </>
  );
}

function Content({ s }: { s: SubscriptionSummary }) {
  const t = useTranslations('billing');
  const format = useFormatter();
  const { state } = useAuth();
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long' });

  const dateLine = s.isFree
    ? t('freeHelp')
    : s.status === 'TRIAL'
      ? t('trialEnds', { date: day(s.currentPeriodEnd) })
      : s.status === 'ACTIVE'
        ? t('periodEnds', { date: day(s.currentPeriodEnd) })
        : s.status === 'PAST_DUE'
          ? t('graceEnds', { date: day(s.graceEndsAt) })
          : t('suspendedSince', { date: day(s.graceEndsAt) });
  const company = state.status === 'authenticated' ? state.user.tenantName : '';
  const whatsapp = whatsappLink(t('payWhatsappMessage', { company }));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle role="heading" aria-level={2} className="text-lg">
                {s.plan.name}
              </CardTitle>
              <SubscriptionStatusBadge status={s.status} isFree={s.isFree} />
            </div>
            {s.isFree ? null : (
              <p className="text-2xl font-semibold">
                <Amount value={s.plan.monthlyPrice} />{' '}
                <span className="text-sm font-normal text-muted-foreground">{t('perMonth')}</span>
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{dateLine}</p>
            {!s.isFree && s.status !== 'SUSPENDED' ? (
              <p className="text-muted-foreground">{t('daysLeft', { count: s.daysLeft })}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              {t('usage')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UsageMeters s={s} />
          </CardContent>
        </Card>
      </div>

      {s.docsOverLimit ? (
        <Alert>
          <CircleAlert aria-hidden />
          <AlertDescription>{t('docsOver')}</AlertDescription>
        </Alert>
      ) : null}

      {s.isFree ? null : (
        <Card>
          <CardHeader className="gap-1.5">
            <CardTitle role="heading" aria-level={2}>
              {t('howToPay')}
            </CardTitle>
            <CardDescription>{t('howToPayHelp')}</CardDescription>
          </CardHeader>
          {whatsapp ? (
            <CardContent>
              <Button asChild className="min-h-11 w-full sm:w-auto">
                <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                  <MessageCircle aria-hidden />
                  {t('payWhatsapp')}
                </a>
              </Button>
            </CardContent>
          ) : null}
        </Card>
      )}

      <section aria-labelledby="payments-title" className="space-y-3">
        <h2 id="payments-title" className="text-base font-semibold">
          {t('payments')}
        </h2>
        <PaymentsList payments={s.payments} />
      </section>
    </div>
  );
}

/** Users, products and documents against the plan's limits. */
export function UsageMeters({ s }: { s: Pick<SubscriptionSummary, 'usage' | 'plan'> }) {
  const t = useTranslations('billing');
  return (
    <div className="space-y-4">
      <Meter label={t('usageUsers')} used={s.usage.users} limit={s.plan.maxUsers} />
      <Meter label={t('usageProducts')} used={s.usage.products} limit={s.plan.maxProducts} />
      <Meter
        label={t('usageDocuments')}
        used={s.usage.documentsThisMonth}
        limit={s.plan.maxDocumentsPerMonth}
      />
    </div>
  );
}

/** Subscription payments, newest first: cards on a phone, a table from `md`. */
export function PaymentsList({ payments }: { payments: SubscriptionPaymentInfo[] }) {
  const t = useTranslations('billing');
  const format = useFormatter();
  return payments.length === 0 ? (
    <div className="rounded-lg border bg-card">
      <EmptyState icon={ReceiptText} title={t('noPayments')} className="py-8" />
    </div>
  ) : (
    <div className="w-full overflow-x-auto rounded-lg border bg-card">
      <Table className="stack-table">
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead>{t('colDate')}</TableHead>
            <TableHead>{t('colPeriod')}</TableHead>
            <TableHead>{t('colMethod')}</TableHead>
            <TableHead className="text-end">{t('colAmount')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p) => (
            <TableRow key={p.id}>
              <TableCell data-cell="main" className="font-medium">
                {format.dateTime(new Date(p.createdAt), { dateStyle: 'medium' })}
              </TableCell>
              <TableCell data-label={t('colPeriod')} className="text-sm">
                {t('periodRange', {
                  from: format.dateTime(new Date(p.periodFrom), { dateStyle: 'medium' }),
                  to: format.dateTime(new Date(p.periodTo), { dateStyle: 'medium' }),
                })}{' '}
                <span className="text-muted-foreground">({t('months', { count: p.months })})</span>
              </TableCell>
              <TableCell data-label={t('colMethod')} className="text-sm">
                {t(`method${p.method}`)}
                {p.reference ? (
                  <span dir="ltr" className="ms-2 text-muted-foreground">
                    {p.reference}
                  </span>
                ) : null}
              </TableCell>
              <TableCell data-cell="end" className="text-end font-medium">
                <Amount value={p.amount} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Used against the plan limit; a bar only when there is a limit. */
function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const t = useTranslations('billing');
  const format = useFormatter();
  const n = (v: number) => format.number(v);
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="num whitespace-nowrap text-muted-foreground">
          {limit === null
            ? t('unlimited', { used: n(used) })
            : t('usageOf', { used: n(used), limit: n(limit) })}
        </span>
      </div>
      {limit === null ? null : (
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className={cn(
              'h-full rounded-full',
              pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-amber-500' : 'bg-primary',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
