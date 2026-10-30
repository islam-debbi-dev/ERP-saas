'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, CopyPlus, Loader2, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Feature, type IncentivePlanDto, type IncentiveRuleDto } from '@erp/shared';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { StickyActions } from '@/components/shared/sticky-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { currentMonth, incentiveKeys, monthShift, usePlan } from '@/lib/incentives';
import { useErrorMessage } from '@/lib/use-error-message';
import { useMetricLabel, usePct } from './explanation';
import { PlanStatusBadge, useMonthLabel } from './incentives-home';
import { RuleDialog } from './rule-dialog';

export function PlanEditor({ id }: { id: string }) {
  return (
    <FeatureGate feature={Feature.INCENTIVES}>
      <Editor id={id} />
    </FeatureGate>
  );
}

function Editor({ id }: { id: string }) {
  const t = useTranslations('incentives');
  const tRoles = useTranslations('roles');
  const monthLabel = useMonthLabel();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const plan = usePlan(id);
  const [editing, setEditing] = useState<IncentiveRuleDto | 'new' | null>(null);
  const [versioning, setVersioning] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const act = useMutation({
    mutationFn: (action: 'activate' | 'archive') =>
      api.request<IncentivePlanDto>(`/incentive-plans/${id}/${action}`, { method: 'POST' }),
    onSuccess: (p, action) => {
      queryClient.setQueryData(incentiveKeys.plan(id), p);
      void queryClient.invalidateQueries({ queryKey: incentiveKeys.plans });
      toast.success(t(action === 'activate' ? 'activatedToast' : 'archivedToast'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (ruleId: string) =>
      api.request<IncentivePlanDto>(`/incentive-plans/${id}/rules/${ruleId}`, { method: 'DELETE' }),
    onSuccess: (p) => queryClient.setQueryData(incentiveKeys.plan(id), p),
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (plan.isPending) {
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (plan.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(plan.error)}
      </p>
    );
  }
  const p = plan.data;
  const draft = p.status === 'DRAFT';

  return (
    <>
      <PageHeader
        title={t('planOption', { name: p.name, version: p.version })}
        description={
          p.validTo
            ? t('validRange', {
                from: monthLabel(p.validFrom.slice(0, 7)),
                to: monthLabel(p.validTo.slice(0, 7)),
              })
            : t('validFrom', { from: monthLabel(p.validFrom.slice(0, 7)) })
        }
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/primes' },
          p.status === 'ACTIVE' && {
            label: t('newVersion'),
            icon: CopyPlus,
            onSelect: () => setVersioning(true),
          },
          p.status !== 'ARCHIVED' && {
            label: t('archive'),
            icon: Archive,
            tone: 'destructive',
            onSelect: () => setArchiving(true),
          },
        ]}
      />

      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <PlanStatusBadge status={p.status} />
        {draft ? t('draftHelp') : p.status === 'ACTIVE' ? t('activeHelp') : t('archivedHelp')}
      </p>

      <Card className="gap-0 p-0">
        {p.rules.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t('noRules')}</p>
        ) : (
          <ul className="divide-y">
            {p.rules.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-medium" title={r.name}>
                    {r.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(`type.${r.params.type}`)} ·{' '}
                    {r.appliesTo === 'ROLE'
                      ? t('forRole', { role: tRoles(r.roleOrUserId as never) })
                      : t(r.appliesTo === 'USER' ? 'forUser' : 'forTeam', {
                          name: r.subjectName ?? '—',
                        })}
                  </p>
                  <RuleSummary rule={r} />
                </div>
                {draft ? (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={t('editRuleNamed', { name: r.name })}
                      onClick={() => setEditing(r)}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={t('removeRuleNamed', { name: r.name })}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(r.id)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {draft ? (
        <StickyActions>
          <Button variant="outline" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t('addRule')}
          </Button>
          <Button
            disabled={p.rules.length === 0 || act.isPending}
            onClick={() => act.mutate('activate')}
          >
            {act.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Play aria-hidden />
            )}
            {t('activate')}
          </Button>
        </StickyActions>
      ) : null}

      <RuleDialog
        plan={p}
        rule={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <ResponsiveDialog open={archiving} onOpenChange={setArchiving}>
        <ResponsiveDialogContent className="md:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('archiveTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('archiveHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setArchiving(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={act.isPending}
              onClick={() => act.mutate('archive', { onSuccess: () => setArchiving(false) })}
            >
              {t('archive')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <NewVersionDialog
        plan={p}
        open={versioning}
        onClose={() => setVersioning(false)}
        onCreated={(v) => router.push(`/primes/plans/${v.id}`)}
      />
    </>
  );
}

/** One line in plain words: "≥ 100 % → 15 000 DA", "3 paliers", "1,5 %"… */
function RuleSummary({ rule }: { rule: IncentiveRuleDto }) {
  const t = useTranslations('incentives');
  const pct = usePct();
  const metricLabel = useMetricLabel();
  const p = rule.params;
  const metric = p.type === 'PER_UNIT' ? metricLabel('QTY') : metricLabel(p.metric);
  const detail =
    p.type === 'TIERS'
      ? t('summaryTiers', { count: p.tiers.length, mode: t(`mode.${p.mode}`) })
      : p.type === 'FIXED_ON_TARGET'
        ? t('summaryFixed', { pct: pct(p.minPct) })
        : p.type === 'COMMISSION'
          ? t('summaryRate', { rate: pct(p.ratePct) })
          : p.type === 'PER_UNIT'
            ? t('summaryPerUnit')
            : p.ratePct !== undefined
              ? t('summaryRate', { rate: pct(p.ratePct) })
              : t('summaryFixed', { pct: pct(p.minPct ?? '100') });
  return (
    <p className="text-sm">
      {metric} · {detail}
      {p.gates.length > 0 ? ` · ${t('gatesCount', { count: p.gates.length })}` : ''}
    </p>
  );
}

function NewVersionDialog({
  plan,
  open,
  onClose,
  onCreated,
}: {
  plan: IncentivePlanDto;
  open: boolean;
  onClose: () => void;
  onCreated: (p: IncentivePlanDto) => void;
}) {
  const t = useTranslations('incentives');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => monthShift(currentMonth(), 1));
  const create = useMutation({
    mutationFn: () =>
      api.request<IncentivePlanDto>(`/incentive-plans/${plan.id}/new-version`, {
        method: 'POST',
        body: { validFrom: `${month}-01` },
      }),
    onSuccess: (v) => {
      void queryClient.invalidateQueries({ queryKey: incentiveKeys.plans });
      onClose();
      onCreated(v);
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
            <ResponsiveDialogTitle>{t('newVersion')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('newVersionHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="version-from">{t('startsIn')}</Label>
            <Input
              id="version-from"
              type="month"
              required
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!month || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('createVersion')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
