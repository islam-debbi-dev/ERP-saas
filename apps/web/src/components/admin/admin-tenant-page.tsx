'use client';

import { ArrowLeft, Eye, Loader2, Wallet } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import {
  type AdminTenantDetail,
  money,
  parseDA,
  SUBSCRIPTION_PAYMENT_METHODS,
  type SubscriptionPaymentMethod,
  toMoneyString,
} from '@erp/shared';
import { PaymentsList, UsageMeters } from '@/components/billing/subscription-page';
import { SubscriptionStatusBadge } from '@/components/billing/subscription-status-badge';
import { Amount } from '@/components/shared/amount';
import { PageHeader } from '@/components/shared/page-header';
import { StickyActions } from '@/components/shared/sticky-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  useAdminAuth,
  useAdminTenant,
  useImpersonate,
  useRecordPayment,
  useUpdateSubscription,
} from '@/lib/admin';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';

const MONTH_CHOICES = [1, 3, 6, 12];

/** One company: subscription, usage, payments; record a payment, change the plan, view as. */
export function AdminTenantPage({ id }: { id: string }) {
  const t = useTranslations('admin');
  const errorMessage = useErrorMessage();
  const { state } = useAdminAuth();
  const tenant = useAdminTenant(id, state.status === 'authenticated');
  const [paying, setPaying] = useState(false);
  const impersonate = useImpersonate(id);

  const viewAs = () => {
    // Opened now, in the click, so no popup blocker stops it; filled once the token is back.
    const tab = window.open('about:blank', '_blank');
    impersonate.mutate(undefined, {
      onSuccess: (res) => {
        const url = `/support#token=${encodeURIComponent(res.accessToken)}`;
        if (tab) {
          tab.opener = null;
          tab.location.href = url;
        } else {
          // Popup blocked: open the view here (a full load, the support tab starts clean).
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = url;
        }
      },
      onError: (err) => {
        tab?.close();
        toast.error(errorMessage(err));
      },
    });
  };

  const d = tenant.data;
  return (
    <>
      <PageHeader
        title={d?.name ?? t('tenants')}
        description={d?.raisonSociale}
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/admin' },
        ]}
        actions={
          d ? (
            <Button variant="outline" onClick={viewAs} disabled={impersonate.isPending}>
              {impersonate.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Eye aria-hidden />
              )}
              {t('viewAs')}
            </Button>
          ) : null
        }
      />
      {tenant.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(tenant.error)}
        </p>
      ) : !d ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy>
          <Skeleton className="h-52 w-full" />
          <Skeleton className="h-52 w-full" />
        </div>
      ) : (
        <>
          <Detail d={d} />
          <StickyActions>
            <Button onClick={() => setPaying(true)} className="min-h-11">
              <Wallet aria-hidden />
              {t('recordPayment')}
            </Button>
          </StickyActions>
          <PaymentDialog d={d} open={paying} onOpenChange={setPaying} />
        </>
      )}
    </>
  );
}

function Detail({ d }: { d: AdminTenantDetail }) {
  const t = useTranslations('admin');
  const tb = useTranslations('billing');
  const format = useFormatter();
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long' });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle role="heading" aria-level={2} className="text-lg">
                {d.plan.name}
              </CardTitle>
              <SubscriptionStatusBadge status={d.status} isFree={d.isFree} />
            </div>
            <p className="text-sm">
              <Amount value={d.plan.monthlyPrice} />{' '}
              <span className="text-muted-foreground">{tb('perMonth')}</span>
            </p>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>
              {d.storedStatus === 'TRIAL'
                ? tb('trialEnds', { date: day(d.currentPeriodEnd) })
                : tb('periodEnds', { date: day(d.currentPeriodEnd) })}
              {d.status === 'PAST_DUE' || d.status === 'SUSPENDED' ? (
                <span className="block text-muted-foreground">
                  {tb(d.status === 'PAST_DUE' ? 'graceEnds' : 'suspendedSince', {
                    date: day(d.graceEndsAt),
                  })}
                </span>
              ) : null}
            </p>
            <UsageMeters s={d} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              {t('owner')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {d.owner ? (
              <>
                <p className="font-medium">{d.owner.fullName}</p>
                {d.owner.email ? (
                  <p dir="ltr" className="text-start break-all">
                    <a
                      href={`mailto:${d.owner.email}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {d.owner.email}
                    </a>
                  </p>
                ) : null}
                {d.owner.phone ? (
                  <p dir="ltr" className="num text-start">
                    <a href={`tel:${d.owner.phone}`} className="underline-offset-4 hover:underline">
                      {d.owner.phone}
                    </a>
                  </p>
                ) : null}
              </>
            ) : null}
            <p className="pt-2 text-muted-foreground">
              {t('registered', { date: day(d.createdAt) })}
            </p>
            <p className="text-muted-foreground">
              {t('lastActivity', {
                when: d.lastActivityAt
                  ? format.relativeTime(new Date(d.lastActivityAt), new Date())
                  : t('never'),
              })}
            </p>
          </CardContent>
        </Card>
      </div>

      <ManageCard d={d} />

      <section aria-labelledby="admin-payments" className="space-y-3">
        <h2 id="admin-payments" className="text-base font-semibold">
          {tb('payments')}
        </h2>
        <PaymentsList payments={d.payments} />
      </section>
    </div>
  );
}

/** Plan, free (pilot) and extra trial days: each saved on its own, each audited. */
function ManageCard({ d }: { d: AdminTenantDetail }) {
  const t = useTranslations('admin');
  const errorMessage = useErrorMessage();
  const update = useUpdateSubscription(d.id);
  const [planId, setPlanId] = useState(d.plan.id);
  const [days, setDays] = useState('7');
  const save = (body: Parameters<typeof update.mutate>[0], after?: () => void) =>
    update.mutate(body, {
      onSuccess: () => {
        toast.success(t('saved'));
        after?.();
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  const extraDays = Number.parseInt(days, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {t('subscription')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-3">
        <form
          className="grid content-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (planId !== d.plan.id) save({ planId });
          }}
        >
          <Label htmlFor="admin-plan">{t('plan')}</Label>
          <NativeSelect id="admin-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {d.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            type="submit"
            variant="outline"
            className="min-h-11"
            disabled={planId === d.plan.id || update.isPending}
          >
            {t('changePlan')}
          </Button>
        </form>

        <div className="grid content-start gap-2">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor="admin-free">{t('setFree')}</Label>
            <Switch
              id="admin-free"
              checked={d.isFree}
              disabled={update.isPending}
              onCheckedChange={(isFree) => save({ isFree })}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('setFreeHelp')}</p>
        </div>

        {d.storedStatus === 'TRIAL' ? (
          <form
            className="grid content-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (extraDays >= 1 && extraDays <= 90) save({ extendTrialDays: extraDays });
            }}
          >
            <Label htmlFor="admin-trial-days">{t('extendDays')}</Label>
            <Input
              id="admin-trial-days"
              inputMode="numeric"
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              className="min-h-11"
              disabled={!(extraDays >= 1 && extraDays <= 90) || update.isPending}
            >
              {t('extendTrial')}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PaymentDialog({
  d,
  open,
  onOpenChange,
}: {
  d: AdminTenantDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('admin');
  const tb = useTranslations('billing');
  const errorMessage = useErrorMessage();
  const key = useIdempotencyKey(open);
  const record = useRecordPayment(d.id);
  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SubscriptionPaymentMethod>('BARIDIMOB');
  const [reference, setReference] = useState('');
  // Until the admin types an amount, it is the plan price times the months.
  const suggested = toMoneyString(money(d.plan.monthlyPrice).mul(months));
  const value = amount.trim() === '' ? suggested : amount;
  const parsed = parseDA(value);
  const valid = parsed !== null && parsed.gt(0) && parsed.decimalPlaces() <= 2;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || record.isPending) return;
    record.mutate(
      { key, body: { amount: value, method, months, reference: reference.trim() || null } },
      {
        onSuccess: () => {
          toast.success(t('paymentRecorded'));
          setAmount('');
          setReference('');
          onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <form className="grid gap-4" onSubmit={submit}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('recordPayment')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {d.name}. {t('recordPaymentHelp')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pay-months">{t('months')}</Label>
              <NativeSelect
                id="pay-months"
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
              >
                {MONTH_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {tb('months', { count: m })}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-amount">{t('amount')}</Label>
              <Input
                id="pay-amount"
                inputMode="decimal"
                dir="ltr"
                className="num"
                placeholder={suggested}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={valid ? undefined : true}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-method">{t('method')}</Label>
              <NativeSelect
                id="pay-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as SubscriptionPaymentMethod)}
              >
                {SUBSCRIPTION_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {tb(`method${m}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-reference">{t('reference')}</Label>
              <Input
                id="pay-reference"
                maxLength={80}
                dir="ltr"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!valid || record.isPending}>
              {record.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('recordPayment')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
