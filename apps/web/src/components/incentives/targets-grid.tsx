'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarArrowDown, Loader2, Percent, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Feature,
  type IncentiveMetric,
  metricDecimals,
  type MetricScope,
  money,
  Permission,
  type SalesTargetDto,
  SCOPABLE_METRICS,
  scopeKey,
  TARGET_METRICS,
  isTeamLead,
} from '@erp/shared';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { StickyActions } from '@/components/shared/sticky-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { usePermission } from '@/lib/auth';
import { currentMonth, incentiveKeys, monthShift, useTargets } from '@/lib/incentives';
import { useSellers } from '@/lib/sales-force';
import { useErrorMessage } from '@/lib/use-error-message';
import { ScopePicker } from './scope-picker';

/** `u:<id>` for a seller's own target, `t:<id>` for a supervisor's whole team. */
type RowKey = `u:${string}` | `t:${string}`;

const keyOf = (t: SalesTargetDto): RowKey =>
  t.userId ? `u:${t.userId}` : `t:${t.teamManagerId ?? ''}`;
const clean = (v: string) => v.trim().replace(',', '.').replace(/\s/g, '');

export function TargetsGrid() {
  return (
    <FeatureGate feature={Feature.INCENTIVES}>
      <Grid />
    </FeatureGate>
  );
}

function Grid() {
  const t = useTranslations('incentives');
  const tRoles = useTranslations('roles');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const seesCost = usePermission(Permission.VIEW_COST_AND_MARGIN);
  const sellers = useSellers();
  const [period, setPeriod] = useState(currentMonth);
  const [metric, setMetric] = useState<IncentiveMetric>('CA_HT');
  const [scope, setScope] = useState<MetricScope | null>(null);
  const [uplift, setUplift] = useState('5');
  const targets = useTargets(period, metric);
  const key = scopeKey(scope);
  const decimals = metricDecimals(metric);

  const saved = useMemo(() => {
    const map = new Map<RowKey, string>();
    for (const x of targets.data ?? []) if (scopeKey(x.scope) === key) map.set(keyOf(x), x.value);
    return map;
  }, [targets.data, key]);
  // What the user typed, on top of the saved values; dropped when the month, figure or
  // scope changes (compared during render, no effect needed).
  const ctx = `${period}|${metric}|${key}`;
  const [edits, setEdits] = useState<{ ctx: string; map: Map<RowKey, string> }>({
    ctx,
    map: new Map(),
  });
  const typed = edits.ctx === ctx ? edits.map : new Map<RowKey, string>();
  const values = new Map([...saved, ...typed]);
  const setValues = (fn: (m: Map<RowKey, string>) => Map<RowKey, string>) =>
    setEdits({ ctx, map: fn(new Map(values)) });

  const people = sellers.data ?? [];
  const rows: { key: RowKey; name: string; detail: string }[] = [
    ...people
      .filter((u) => isTeamLead(u.role))
      .map((u) => ({ key: `t:${u.id}` as RowKey, name: u.fullName, detail: t('teamOf') })),
    ...people.map((u) => ({
      key: `u:${u.id}` as RowKey,
      name: u.fullName,
      detail: tRoles(u.role),
    })),
  ];
  const changed = rows.filter((r) => (values.get(r.key) ?? '') !== (saved.get(r.key) ?? ''));
  const invalid = rows.some((r) => {
    const v = clean(values.get(r.key) ?? '');
    return v !== '' && !/^\d{1,12}(\.\d{1,3})?$/.test(v);
  });

  const setValue = (k: RowKey, v: string) => setValues((m) => new Map(m).set(k, v));

  const copyLast = useMutation({
    mutationFn: () =>
      api.request<SalesTargetDto[]>(
        `/sales-targets?period=${monthShift(period, -1)}&metric=${metric}`,
      ),
    onSuccess: (last) => {
      const found = last.filter((x) => scopeKey(x.scope) === key);
      if (found.length === 0) {
        toast.info(t('copyNothing'));
        return;
      }
      setValues((m) => {
        const next = new Map(m);
        for (const x of found) next.set(keyOf(x), x.value);
        return next;
      });
      toast.success(t('copied', { count: found.length }));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const applyUplift = () => {
    const pct = clean(uplift);
    if (!/^-?\d{1,3}(\.\d{1,2})?$/.test(pct)) return;
    setValues((m) => {
      const next = new Map(m);
      for (const [k, v] of m) {
        const c = clean(v);
        if (!/^\d+(\.\d+)?$/.test(c)) continue;
        const up = money(c)
          .times(money(100).plus(money(pct)))
          .div(100);
        next.set(k, (up.isNegative() ? money(0) : up).toDecimalPlaces(decimals).toString());
      }
      return next;
    });
  };

  const save = useMutation({
    mutationFn: () =>
      api.request<SalesTargetDto[]>('/sales-targets/bulk', {
        method: 'PUT',
        body: {
          period,
          metric,
          scope,
          rows: changed.map((r) => {
            const id = r.key.slice(2);
            const v = clean(values.get(r.key) ?? '');
            return {
              ...(r.key.startsWith('u:') ? { userId: id } : { teamManagerId: id }),
              value: v || null,
            };
          }),
        },
      }),
    onSuccess: (list) => {
      queryClient.setQueryData(incentiveKeys.targets(period, metric), list);
      setEdits({ ctx, map: new Map() });
      void queryClient.invalidateQueries({ queryKey: incentiveKeys.mine });
      toast.success(t('targetsSaved'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const metrics = TARGET_METRICS.filter((m) => m !== 'MARGE' || seesCost);

  return (
    <>
      <PageHeader
        title={t('targetsTitle')}
        description={t('targetsSubtitle')}
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/primes' },
        ]}
      />

      <Card className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="targets-month">{t('month')}</Label>
          <Input
            id="targets-month"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="targets-metric">{t('metricLabel')}</Label>
          <NativeSelect
            id="targets-metric"
            value={metric}
            onChange={(e) => {
              const m = e.target.value as IncentiveMetric;
              setMetric(m);
              if (!SCOPABLE_METRICS.includes(m)) setScope(null);
            }}
          >
            {metrics.map((m) => (
              <option key={m} value={m}>
                {t(`metric.${m}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        {SCOPABLE_METRICS.includes(metric) ? (
          <div className="sm:col-span-2">
            <ScopePicker id="targets-scope" value={scope} onChange={setScope} />
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
          <Button variant="outline" disabled={copyLast.isPending} onClick={() => copyLast.mutate()}>
            {copyLast.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <CalendarArrowDown aria-hidden />
            )}
            {t('copyLastMonth')}
          </Button>
          <div className="flex items-end gap-2">
            <div className="w-24 space-y-1">
              <Label htmlFor="targets-uplift">{t('upliftPct')}</Label>
              <Input
                id="targets-uplift"
                inputMode="decimal"
                dir="ltr"
                value={uplift}
                onChange={(e) => setUplift(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={applyUplift}>
              <Percent aria-hidden />
              {t('applyUplift')}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="gap-0 p-0">
        {sellers.isPending || targets.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : targets.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(targets.error)}
          </p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t('noSellers')}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => {
              const id = `target-${r.key.replace(':', '-')}`;
              return (
                <li key={r.key} className="flex items-center justify-between gap-3 px-4 py-2">
                  <label htmlFor={id} className="min-w-0 flex-1">
                    <span className="block truncate font-medium" title={r.name}>
                      {r.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{r.detail}</span>
                  </label>
                  <Input
                    id={id}
                    inputMode="decimal"
                    dir="ltr"
                    className="w-36 shrink-0 text-end tabular-nums sm:w-44"
                    placeholder="—"
                    value={values.get(r.key) ?? ''}
                    aria-invalid={
                      clean(values.get(r.key) ?? '') !== '' &&
                      !/^\d{1,12}(\.\d{1,3})?$/.test(clean(values.get(r.key) ?? ''))
                    }
                    onChange={(e) => setValue(r.key, e.target.value)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <StickyActions>
        <Button
          disabled={changed.length === 0 || invalid || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {changed.length > 0 ? t('saveTargetsCount', { count: changed.length }) : t('saveTargets')}
        </Button>
      </StickyActions>
    </>
  );
}
