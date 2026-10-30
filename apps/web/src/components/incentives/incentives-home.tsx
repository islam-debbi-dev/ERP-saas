'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calculator, Loader2, Plus, Target, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Feature,
  INCENTIVE_PERIODS,
  type IncentivePeriod,
  type IncentivePlanDto,
  type IncentiveRunDetailDto,
  type IncentiveRunDto,
} from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
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
import { api } from '@/lib/api-client';
import { currentMonth, incentiveKeys, monthShift, usePlans, useRuns } from '@/lib/incentives';
import { useErrorMessage } from '@/lib/use-error-message';

/** Objectifs & primes (phase 18): plans, month-end runs, and the way to the targets grid. */
export function IncentivesHome() {
  return (
    <FeatureGate feature={Feature.INCENTIVES}>
      <Home />
    </FeatureGate>
  );
}

function Home() {
  const t = useTranslations('incentives');
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('newPlan')}
          </Button>
        }
        more={[{ label: t('targetsTitle'), icon: Target, href: '/primes/objectifs' }]}
      />
      <ComputeCard />
      <RunsCard />
      <PlansCard />
      <NewPlanDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export function PlanStatusBadge({ status }: { status: IncentivePlanDto['status'] }) {
  const t = useTranslations('incentives');
  return (
    <Badge variant={status === 'ACTIVE' ? 'default' : status === 'DRAFT' ? 'outline' : 'secondary'}>
      {t(`planStatus.${status}`)}
    </Badge>
  );
}

export function RunStatusBadge({ status }: { status: IncentiveRunDto['status'] }) {
  const t = useTranslations('incentives');
  return (
    <Badge variant={status === 'PREVIEW' ? 'outline' : 'default'}>{t(`runStatus.${status}`)}</Badge>
  );
}

/** "octobre 2026" from `2026-10`. */
export function useMonthLabel(): (month: string) => string {
  const format = useFormatter();
  return (month) =>
    format.dateTime(new Date(`${month}-15T12:00:00Z`), { month: 'long', year: 'numeric' });
}

/** Pick an active plan and a month, compute the preview, open it. */
function ComputeCard() {
  const t = useTranslations('incentives');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const plans = usePlans();
  const active = (plans.data ?? []).filter((p) => p.status === 'ACTIVE');
  const [planId, setPlanId] = useState('');
  // Month end: last month is the one usually computed.
  const [month, setMonth] = useState(() => monthShift(currentMonth(), -1));
  const chosen = planId || active[0]?.id || '';

  const compute = useMutation({
    mutationFn: () =>
      api.request<IncentiveRunDetailDto>('/incentive-runs', {
        method: 'POST',
        body: { planId: chosen, period: month },
      }),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: incentiveKeys.runs });
      router.push(`/primes/calculs/${run.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (plans.isSuccess && active.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('computeTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('computeHelp')}</p>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen) compute.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="run-plan">{t('plan')}</Label>
            <NativeSelect id="run-plan" value={chosen} onChange={(e) => setPlanId(e.target.value)}>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {t('planOption', { name: p.name, version: p.version })}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="run-month">{t('month')}</Label>
            <Input
              id="run-month"
              type="month"
              required
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!chosen || !month || compute.isPending}>
            {compute.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Calculator aria-hidden />
            )}
            {t('compute')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RunsCard() {
  const t = useTranslations('incentives');
  const errorMessage = useErrorMessage();
  const runs = useRuns();
  const monthLabel = useMonthLabel();
  return (
    <Card className="gap-0 p-0">
      <CardHeader className="p-4">
        <CardTitle className="text-base">{t('runsTitle')}</CardTitle>
      </CardHeader>
      {runs.isPending ? (
        <div className="space-y-2 p-4" aria-busy>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : runs.isError ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          {errorMessage(runs.error)}
        </p>
      ) : runs.data.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">{t('runsEmpty')}</p>
      ) : (
        <ul className="divide-y border-t">
          {runs.data.map((r) => (
            <li key={r.id}>
              <Link
                href={`/primes/calculs/${r.id}`}
                className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium capitalize">{monthLabel(r.period)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t('planOption', { name: r.planName, version: r.planVersion })} ·{' '}
                    {t('peopleCount', { count: r.userCount })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Amount value={r.total} className="text-sm font-medium" />
                  <RunStatusBadge status={r.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PlansCard() {
  const t = useTranslations('incentives');
  const monthLabel = useMonthLabel();
  const errorMessage = useErrorMessage();
  const plans = usePlans();
  return (
    <Card className="gap-0 p-0">
      <CardHeader className="p-4">
        <CardTitle className="text-base">{t('plansTitle')}</CardTitle>
      </CardHeader>
      {plans.isPending ? (
        <div className="space-y-2 p-4" aria-busy>
          <Skeleton className="h-14 w-full" />
        </div>
      ) : plans.isError ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          {errorMessage(plans.error)}
        </p>
      ) : plans.data.length === 0 ? (
        <EmptyState icon={Trophy} title={t('plansEmptyTitle')} description={t('plansEmpty')} />
      ) : (
        <ul className="divide-y border-t">
          {plans.data.map((p) => (
            <li key={p.id}>
              <Link
                href={`/primes/plans/${p.id}`}
                className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium" title={p.name}>
                    {t('planOption', { name: p.name, version: p.version })}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.validTo
                      ? t('validRange', {
                          from: monthLabel(p.validFrom.slice(0, 7)),
                          to: monthLabel(p.validTo.slice(0, 7)),
                        })
                      : t('validFrom', { from: monthLabel(p.validFrom.slice(0, 7)) })}{' '}
                    · {t('rulesCount', { count: p.rules.length })}
                  </p>
                </div>
                <PlanStatusBadge status={p.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NewPlanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('incentives');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [period, setPeriod] = useState<IncentivePeriod>('MONTH');
  const [month, setMonth] = useState(currentMonth);

  const create = useMutation({
    mutationFn: () =>
      api.request<IncentivePlanDto>('/incentive-plans', {
        method: 'POST',
        body: { name: name.trim(), period, validFrom: `${month}-01` },
      }),
    onSuccess: (plan) => {
      void queryClient.invalidateQueries({ queryKey: incentiveKeys.plans });
      onClose();
      router.push(`/primes/plans/${plan.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('newPlan')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('newPlanHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="plan-name">{t('planName')}</Label>
            <Input
              id="plan-name"
              required
              maxLength={80}
              value={name}
              placeholder={t('planNamePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="plan-period">{t('periodKind')}</Label>
              <NativeSelect
                id="plan-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value as IncentivePeriod)}
              >
                {INCENTIVE_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {t(`period.${p}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="plan-from">{t('startsIn')}</Label>
              <Input
                id="plan-from"
                type="month"
                required
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('createPlan')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
