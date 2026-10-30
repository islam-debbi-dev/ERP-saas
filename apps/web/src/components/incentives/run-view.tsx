'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, ChevronDown, Download, Loader2, RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Feature, type IncentiveRunDetailDto, Permission } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { StickyActions } from '@/components/shared/sticky-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { usePermission } from '@/lib/auth';
import { downloadRun, incentiveKeys, useRun } from '@/lib/incentives';
import { useErrorMessage } from '@/lib/use-error-message';
import { Explanation } from './explanation';
import { RunStatusBadge, useMonthLabel } from './incentives-home';

export function RunView({ id }: { id: string }) {
  return (
    <FeatureGate feature={Feature.INCENTIVES}>
      <View id={id} />
    </FeatureGate>
  );
}

function View({ id }: { id: string }) {
  const t = useTranslations('incentives');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const monthLabel = useMonthLabel();
  const canApprove = usePermission(Permission.INCENTIVE_APPROVE);
  const run = useRun(id);
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState(false);

  const done = (r: IncentiveRunDetailDto) => {
    queryClient.setQueryData(incentiveKeys.run(id), r);
    void queryClient.invalidateQueries({ queryKey: incentiveKeys.runs });
  };
  const recompute = useMutation({
    mutationFn: (r: IncentiveRunDetailDto) =>
      api.request<IncentiveRunDetailDto>('/incentive-runs', {
        method: 'POST',
        body: { planId: r.planId, period: r.period },
      }),
    onSuccess: (r) => {
      done(r);
      toast.success(t('recomputedToast'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const approve = useMutation({
    mutationFn: () =>
      api.request<IncentiveRunDetailDto>(`/incentive-runs/${id}/approve`, { method: 'POST' }),
    onSuccess: (r) => {
      done(r);
      setConfirming(false);
      toast.success(t('approvedToast'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (run.isPending) {
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (run.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(run.error)}
      </p>
    );
  }
  const r = run.data;
  const preview = r.status === 'PREVIEW';
  const when = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Africa/Algiers',
    });

  const exportFile = async () => {
    setExporting(true);
    try {
      await downloadRun(r);
      void queryClient.invalidateQueries({ queryKey: incentiveKeys.run(id) });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('runTitle', { month: monthLabel(r.period) })}
        description={t('planOption', { name: r.planName, version: r.planVersion })}
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/primes' },
        ]}
      />

      <Card className="flex flex-row flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('runTotal')} <RunStatusBadge status={r.status} />
          </p>
          <Amount value={r.total} className="text-2xl font-semibold" />
        </div>
        <div className="text-sm text-muted-foreground sm:text-end">
          <p>{t('peopleCount', { count: r.users.length })}</p>
          <p>
            {r.approvedAt
              ? t('approvedBy', { name: r.approvedBy?.fullName ?? '—', when: when(r.approvedAt) })
              : t('computedAt', { when: when(r.computedAt) })}
          </p>
        </div>
      </Card>
      {preview ? <p className="text-sm text-muted-foreground">{t('previewHelp')}</p> : null}

      <ul className="space-y-3">
        {r.users.map((u) => (
          <li key={u.user.id}>
            <UserCard run={r} entry={u} />
          </li>
        ))}
      </ul>

      <StickyActions>
        {preview ? (
          <>
            <Button
              variant="outline"
              disabled={recompute.isPending}
              onClick={() => recompute.mutate(r)}
            >
              {recompute.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <RefreshCw aria-hidden />
              )}
              {t('recompute')}
            </Button>
            {canApprove ? (
              <Button onClick={() => setConfirming(true)}>
                <BadgeCheck aria-hidden />
                {t('approve')}
              </Button>
            ) : null}
          </>
        ) : (
          <Button disabled={exporting} onClick={() => void exportFile()}>
            {exporting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            {t('export')}
          </Button>
        )}
      </StickyActions>
      {preview && !canApprove ? (
        <p className="text-sm text-muted-foreground">{t('approveOwnerOnly')}</p>
      ) : null}

      <ResponsiveDialog open={confirming} onOpenChange={setConfirming}>
        <ResponsiveDialogContent className="md:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('approveTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('approveHelp', { month: monthLabel(r.period) })}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <p className="text-sm">
            {t('runTotal')} : <Amount value={r.total} className="font-semibold" />
          </p>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t('cancel')}
            </Button>
            <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
              {approve.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('approveConfirm')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}

function UserCard({
  run,
  entry,
}: {
  run: IncentiveRunDetailDto;
  entry: IncentiveRunDetailDto['users'][number];
}) {
  const t = useTranslations('incentives');
  const tRoles = useTranslations('roles');
  const [open, setOpen] = useState(false);
  const panel = `run-user-${entry.user.id}`;
  return (
    <Card className="gap-0 p-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-start focus-visible:bg-muted/50 focus-visible:outline-none"
      >
        <div className="min-w-0">
          <p className="truncate font-medium" title={entry.user.fullName}>
            {entry.user.fullName}
          </p>
          <p className="text-xs text-muted-foreground">
            {tRoles(entry.user.role)} · {t('rulesCount', { count: entry.lines.length })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Amount value={entry.total} className="font-semibold" />
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </div>
      </button>
      {open ? (
        <ul id={panel} className="divide-y border-t">
          {entry.lines.map((l) => (
            <li key={l.ruleId} className="space-y-2 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 font-medium break-words">{l.ruleName}</p>
                <Amount value={l.amount} className="shrink-0" />
              </div>
              <Explanation e={l.explanation} labels={run.scopeLabels} />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
