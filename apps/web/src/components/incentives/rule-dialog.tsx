'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  evaluateRule,
  exampleMetrics,
  INCENTIVE_APPLIES_TO,
  INCENTIVE_METRICS,
  INCENTIVE_RULE_TYPES,
  type IncentiveAppliesTo,
  type IncentiveMetric,
  type IncentivePlanDto,
  type IncentiveRuleDto,
  type IncentiveRuleType,
  incentiveRuleParamsSchema,
  MONEY_METRICS,
  type MetricScope,
  Role,
  ROLES,
  SCOPABLE_METRICS,
  TARGET_METRICS,
  TIER_MODES,
  type TierMode,
} from '@erp/shared';
import { Button } from '@/components/ui/button';
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
import { api } from '@/lib/api-client';
import { useProduct, useUnitLabel } from '@/lib/catalog';
import { incentiveKeys } from '@/lib/incentives';
import { useSellers } from '@/lib/sales-force';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { Explanation } from './explanation';
import { ScopePicker } from './scope-picker';

interface TierForm {
  fromPct: string;
  value: string;
}
interface GateForm {
  metric: IncentiveMetric;
  min: string;
  max: string;
}

/** Everything the form edits; turned into params and checked by the shared schema. */
interface RuleForm {
  name: string;
  appliesTo: IncentiveAppliesTo;
  subject: string;
  type: IncentiveRuleType;
  metric: IncentiveMetric;
  scope: MetricScope | null;
  minPct: string;
  amount: string;
  mode: TierMode;
  tierKind: 'amount' | 'rate';
  tiers: TierForm[];
  ratePct: string;
  onlyAbovePct: string;
  amountPerUnit: string;
  unitId: string;
  overrideKind: 'rate' | 'amount';
  gates: GateForm[];
  cap: string;
}

const EMPTY: RuleForm = {
  name: '',
  appliesTo: 'ROLE',
  subject: Role.SELLER,
  type: 'TIERS',
  metric: 'CA_HT',
  scope: null,
  minPct: '100',
  amount: '',
  mode: 'HIGHEST_REACHED',
  tierKind: 'amount',
  tiers: [
    { fromPct: '80', value: '' },
    { fromPct: '100', value: '' },
  ],
  ratePct: '',
  onlyAbovePct: '',
  amountPerUnit: '',
  unitId: '',
  overrideKind: 'rate',
  gates: [],
  cap: '',
};

const decimal = (v: string) => v.trim().replace(',', '.').replace(/\s/g, '');
const opt = (v: string) => (decimal(v) === '' ? undefined : decimal(v));

function toParams(f: RuleForm): unknown {
  const common = {
    gates: f.gates.map((g) => ({ metric: g.metric, min: opt(g.min), max: opt(g.max) })),
    cap: opt(f.cap),
  };
  const scope = f.scope ?? undefined;
  switch (f.type) {
    case 'FIXED_ON_TARGET':
      return {
        type: f.type,
        metric: f.metric,
        scope,
        minPct: decimal(f.minPct),
        amount: decimal(f.amount),
        ...common,
      };
    case 'TIERS':
      return {
        type: f.type,
        metric: f.metric,
        scope,
        mode: f.mode,
        tiers: f.tiers.map((t) =>
          f.tierKind === 'amount'
            ? { fromPct: decimal(t.fromPct), amount: decimal(t.value) }
            : { fromPct: decimal(t.fromPct), ratePct: decimal(t.value) },
        ),
        ...common,
      };
    case 'COMMISSION':
      return {
        type: f.type,
        metric: f.metric,
        scope,
        ratePct: decimal(f.ratePct),
        onlyAbovePct: opt(f.onlyAbovePct),
        ...common,
      };
    case 'PER_UNIT':
      return {
        type: f.type,
        scope: f.scope ?? {},
        amountPerUnit: decimal(f.amountPerUnit),
        unitId: f.unitId || undefined,
        ...common,
      };
    case 'MANAGER_OVERRIDE':
      return f.overrideKind === 'rate'
        ? {
            type: f.type,
            metric: f.metric,
            scope,
            ratePct: decimal(f.ratePct),
            minPct: opt(f.minPct),
            ...common,
          }
        : {
            type: f.type,
            metric: f.metric,
            scope,
            amount: decimal(f.amount),
            minPct: decimal(f.minPct),
            ...common,
          };
  }
}

function fromRule(r: IncentiveRuleDto): RuleForm {
  const p = r.params;
  const f: RuleForm = {
    ...EMPTY,
    name: r.name,
    appliesTo: r.appliesTo,
    subject: r.roleOrUserId,
    type: p.type,
    gates: p.gates.map((g) => ({ metric: g.metric, min: g.min ?? '', max: g.max ?? '' })),
    cap: p.cap ?? '',
  };
  switch (p.type) {
    case 'FIXED_ON_TARGET':
      return { ...f, metric: p.metric, scope: p.scope ?? null, minPct: p.minPct, amount: p.amount };
    case 'TIERS':
      return {
        ...f,
        metric: p.metric,
        scope: p.scope ?? null,
        mode: p.mode,
        tierKind: p.tiers[0]?.ratePct !== undefined ? 'rate' : 'amount',
        tiers: p.tiers.map((t) => ({ fromPct: t.fromPct, value: t.amount ?? t.ratePct ?? '' })),
      };
    case 'COMMISSION':
      return {
        ...f,
        metric: p.metric,
        scope: p.scope ?? null,
        ratePct: p.ratePct,
        onlyAbovePct: p.onlyAbovePct ?? '',
      };
    case 'PER_UNIT':
      return {
        ...f,
        metric: 'QTY',
        scope: p.scope,
        amountPerUnit: p.amountPerUnit,
        unitId: p.unitId ?? '',
      };
    case 'MANAGER_OVERRIDE':
      return {
        ...f,
        metric: p.metric,
        scope: p.scope ?? null,
        overrideKind: p.ratePct !== undefined ? 'rate' : 'amount',
        ratePct: p.ratePct ?? '',
        amount: p.amount ?? '',
        minPct: p.minPct ?? '',
      };
  }
}

/**
 * The plan builder's rule form (phase 18): pick a type, fill its params, see a live
 * example with made-up figures. The same zod schema as the API checks it as you type.
 */
export function RuleDialog({
  plan,
  rule,
  open,
  onClose,
}: {
  plan: IncentivePlanDto;
  /** null: a new rule. */
  rule: IncentiveRuleDto | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-2xl">
        {open ? (
          <RuleFormBody key={rule?.id ?? 'new'} plan={plan} rule={rule} onClose={onClose} />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function RuleFormBody({
  plan,
  rule,
  onClose,
}: {
  plan: IncentivePlanDto;
  rule: IncentiveRuleDto | null;
  onClose: () => void;
}) {
  const t = useTranslations('incentives');
  const tRoles = useTranslations('roles');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const sellers = useSellers();
  const [f, setF] = useState<RuleForm>(() => (rule ? fromRule(rule) : EMPTY));
  const [exampleTarget, setExampleTarget] = useState('1000000');
  const [exampleAchieved, setExampleAchieved] = useState('1100000');
  const set = (patch: Partial<RuleForm>) => setF((x) => ({ ...x, ...patch }));

  const parsed = useMemo(() => incentiveRuleParamsSchema.safeParse(toParams(f)), [f]);
  const example = useMemo(() => {
    if (!parsed.success) return null;
    const achieved = decimal(exampleAchieved) || '0';
    const target = decimal(exampleTarget);
    if (!/^-?\d+(\.\d+)?$/.test(achieved) || (target && !/^\d+(\.\d+)?$/.test(target))) return null;
    return evaluateRule(parsed.data, exampleMetrics(parsed.data, achieved), target || null);
  }, [parsed, exampleAchieved, exampleTarget]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        appliesTo: f.appliesTo,
        roleOrUserId: f.subject,
        params: parsed.success ? parsed.data : toParams(f),
      };
      return api.request<IncentivePlanDto>(
        rule ? `/incentive-plans/${plan.id}/rules/${rule.id}` : `/incentive-plans/${plan.id}/rules`,
        { method: rule ? 'PUT' : 'POST', body },
      );
    },
    onSuccess: (p) => {
      queryClient.setQueryData(incentiveKeys.plan(plan.id), p);
      void queryClient.invalidateQueries({ queryKey: incentiveKeys.plans });
      toast.success(t('ruleSaved'));
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const issue = parsed.success ? null : parsed.error.issues[0];
  const hasMetric = f.type !== 'PER_UNIT';
  const metrics = f.type === 'COMMISSION' ? MONEY_METRICS : TARGET_METRICS;
  const managers = (sellers.data ?? []).filter(
    (u) => f.appliesTo !== 'TEAM_MANAGER' || u.role !== Role.SELLER,
  );

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.success && f.name.trim()) save.mutate();
      }}
    >
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{rule ? t('editRule') : t('addRule')}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>{t(`typeHelp.${f.type}`)}</ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      <div role="radiogroup" aria-label={t('ruleType')} className="flex flex-wrap gap-2">
        {INCENTIVE_RULE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={f.type === type}
            onClick={() =>
              set({
                type,
                metric:
                  type === 'COMMISSION' && !MONEY_METRICS.includes(f.metric) ? 'CA_HT' : f.metric,
              })
            }
            className={cn(
              'min-h-11 rounded-full border px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              f.type === type
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background hover:bg-muted',
            )}
          >
            {t(`type.${type}`)}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <Label htmlFor="rule-name">{t('ruleName')}</Label>
        <Input
          id="rule-name"
          required
          maxLength={80}
          value={f.name}
          placeholder={t(`type.${f.type}`)}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rule-applies">{t('appliesTo')}</Label>
          <NativeSelect
            id="rule-applies"
            value={f.appliesTo}
            onChange={(e) => {
              const appliesTo = e.target.value as IncentiveAppliesTo;
              set({ appliesTo, subject: appliesTo === 'ROLE' ? Role.SELLER : '' });
            }}
          >
            {INCENTIVE_APPLIES_TO.map((a) => (
              <option key={a} value={a}>
                {t(`appliesToOption.${a}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rule-subject">
            {t(f.appliesTo === 'ROLE' ? 'subjectRole' : 'subjectUser')}
          </Label>
          <NativeSelect
            id="rule-subject"
            required
            value={f.subject}
            onChange={(e) => set({ subject: e.target.value })}
          >
            {f.appliesTo === 'ROLE' ? (
              ROLES.map((r) => (
                <option key={r} value={r}>
                  {tRoles(r)}
                </option>
              ))
            ) : (
              <>
                <option value="">{t('pickUser')}</option>
                {managers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </>
            )}
          </NativeSelect>
        </div>
      </div>

      {hasMetric ? (
        <div className="space-y-1">
          <Label htmlFor="rule-metric">{t('metricLabel')}</Label>
          <NativeSelect
            id="rule-metric"
            value={f.metric}
            onChange={(e) => {
              const metric = e.target.value as IncentiveMetric;
              set({ metric, scope: SCOPABLE_METRICS.includes(metric) ? f.scope : null });
            }}
          >
            {metrics.map((m) => (
              <option key={m} value={m}>
                {t(`metric.${m}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      {f.type === 'PER_UNIT' || SCOPABLE_METRICS.includes(f.metric) ? (
        <ScopePicker
          id="rule-scope"
          value={f.scope}
          requireOne={f.type === 'PER_UNIT'}
          onChange={(scope) => set({ scope, unitId: '' })}
        />
      ) : null}

      <TypeFields f={f} set={set} />

      <Gates f={f} set={set} />

      <Field
        id="rule-cap"
        label={t('cap')}
        hint={t('capHint')}
        value={f.cap}
        onChange={(cap) => set({ cap })}
      />

      <section
        aria-labelledby="rule-example"
        className="space-y-3 rounded-lg border bg-muted/40 p-3"
      >
        <h3 id="rule-example" className="text-sm font-semibold">
          {t('example')}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {f.type !== 'PER_UNIT' ? (
            <Field
              id="ex-target"
              label={t('exampleTarget')}
              value={exampleTarget}
              onChange={setExampleTarget}
            />
          ) : null}
          <Field
            id="ex-achieved"
            label={t(f.type === 'PER_UNIT' ? 'exampleUnits' : 'exampleAchieved')}
            value={exampleAchieved}
            onChange={setExampleAchieved}
          />
        </div>
        {example ? (
          <Explanation e={example.explanation} />
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            {issue
              ? t('exampleInvalid', { field: issue.path.join('.') || '—' })
              : t('exampleNeedsNumbers')}
          </p>
        )}
      </section>

      <ResponsiveDialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          disabled={!parsed.success || !f.name.trim() || !f.subject || save.isPending}
        >
          {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t('saveRule')}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        dir="ltr"
        className="text-start"
        value={value}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function TypeFields({ f, set }: { f: RuleForm; set: (p: Partial<RuleForm>) => void }) {
  const t = useTranslations('incentives');
  const product = useProduct(f.scope?.productId ?? '');
  const unitLabel = useUnitLabel();
  const money = MONEY_METRICS.includes(f.metric);

  switch (f.type) {
    case 'FIXED_ON_TARGET':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="r-min"
            label={t('minPct')}
            value={f.minPct}
            onChange={(minPct) => set({ minPct })}
          />
          <Field
            id="r-amount"
            label={t('amountDa')}
            value={f.amount}
            onChange={(amount) => set({ amount })}
          />
        </div>
      );
    case 'TIERS':
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="r-mode">{t('tierMode')}</Label>
              <NativeSelect
                id="r-mode"
                value={f.mode}
                onChange={(e) => set({ mode: e.target.value as TierMode })}
              >
                {TIER_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`mode.${m}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {money ? (
              <div className="space-y-1">
                <Label htmlFor="r-kind">{t('tierKind')}</Label>
                <NativeSelect
                  id="r-kind"
                  value={f.tierKind}
                  onChange={(e) => set({ tierKind: e.target.value as 'amount' | 'rate' })}
                >
                  <option value="amount">{t('tierKindAmount')}</option>
                  <option value="rate">{t('tierKindRate')}</option>
                </NativeSelect>
              </div>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t(`modeHelp.${f.mode}`)}</p>
          <ul className="space-y-2">
            {f.tiers.map((tier, i) => (
              <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field
                  id={`tier-${i}-pct`}
                  label={t('tierFrom')}
                  value={tier.fromPct}
                  onChange={(fromPct) =>
                    set({ tiers: f.tiers.map((x, j) => (j === i ? { ...x, fromPct } : x)) })
                  }
                />
                <Field
                  id={`tier-${i}-value`}
                  label={f.tierKind === 'amount' || !money ? t('amountDa') : t('ratePct')}
                  value={tier.value}
                  onChange={(value) =>
                    set({ tiers: f.tiers.map((x, j) => (j === i ? { ...x, value } : x)) })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={t('removeTier')}
                  disabled={f.tiers.length === 1}
                  onClick={() => set({ tiers: f.tiers.filter((_, j) => j !== i) })}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            disabled={f.tiers.length >= 10}
            onClick={() => set({ tiers: [...f.tiers, { fromPct: '', value: '' }] })}
          >
            <Plus aria-hidden />
            {t('addTier')}
          </Button>
        </div>
      );
    case 'COMMISSION':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="r-rate"
            label={t('ratePct')}
            value={f.ratePct}
            onChange={(ratePct) => set({ ratePct })}
          />
          <Field
            id="r-above"
            label={t('onlyAbovePct')}
            hint={t('onlyAboveHint')}
            value={f.onlyAbovePct}
            onChange={(onlyAbovePct) => set({ onlyAbovePct })}
          />
        </div>
      );
    case 'PER_UNIT':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="r-per-unit"
            label={t('amountPerUnit')}
            value={f.amountPerUnit}
            onChange={(amountPerUnit) => set({ amountPerUnit })}
          />
          <div className="space-y-1">
            <Label htmlFor="r-unit">{t('countUnit')}</Label>
            <NativeSelect
              id="r-unit"
              value={f.unitId}
              disabled={!f.scope?.productId}
              onChange={(e) => set({ unitId: e.target.value })}
            >
              <option value="">{t('baseUnit')}</option>
              {(f.scope?.productId ? (product.data?.units ?? []) : []).map((u) => (
                <option key={u.unitId} value={u.unitId}>
                  {unitLabel({ code: u.unitCode, name: u.unitName })}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      );
    case 'MANAGER_OVERRIDE':
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="r-override">{t('overrideKind')}</Label>
            <NativeSelect
              id="r-override"
              value={f.overrideKind}
              onChange={(e) => set({ overrideKind: e.target.value as 'rate' | 'amount' })}
            >
              {money ? <option value="rate">{t('overrideRate')}</option> : null}
              <option value="amount">{t('overrideAmount')}</option>
            </NativeSelect>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {f.overrideKind === 'rate' && money ? (
              <Field
                id="r-o-rate"
                label={t('ratePct')}
                value={f.ratePct}
                onChange={(ratePct) => set({ ratePct })}
              />
            ) : (
              <Field
                id="r-o-amount"
                label={t('amountDa')}
                value={f.amount}
                onChange={(amount) => set({ amount })}
              />
            )}
            <Field
              id="r-o-min"
              label={t('minPct')}
              value={f.minPct}
              onChange={(minPct) => set({ minPct })}
            />
          </div>
        </div>
      );
  }
}

function Gates({ f, set }: { f: RuleForm; set: (p: Partial<RuleForm>) => void }) {
  const t = useTranslations('incentives');
  const update = (i: number, patch: Partial<GateForm>) =>
    set({ gates: f.gates.map((g, j) => (j === i ? { ...g, ...patch } : g)) });
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('gates')}</legend>
      <p className="text-xs text-muted-foreground">{t('gatesHelp')}</p>
      <ul className="space-y-2">
        {f.gates.map((g, i) => (
          <li key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <div className="col-span-2 space-y-1 sm:col-span-1">
              <Label htmlFor={`gate-${i}-metric`}>{t('metricLabel')}</Label>
              <NativeSelect
                id={`gate-${i}-metric`}
                value={g.metric}
                onChange={(e) => update(i, { metric: e.target.value as IncentiveMetric })}
              >
                {INCENTIVE_METRICS.map((m) => (
                  <option key={m} value={m}>
                    {t(`metric.${m}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Field
              id={`gate-${i}-min`}
              label={t('gateMinLabel')}
              value={g.min}
              onChange={(min) => update(i, { min })}
            />
            <Field
              id={`gate-${i}-max`}
              label={t('gateMaxLabel')}
              value={g.max}
              onChange={(max) => update(i, { max })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={t('removeGate')}
              onClick={() => set({ gates: f.gates.filter((_, j) => j !== i) })}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        disabled={f.gates.length >= 5}
        onClick={() =>
          set({ gates: [...f.gates, { metric: 'RECOUVREMENT_PCT', min: '70', max: '' }] })
        }
      >
        <Plus aria-hidden />
        {t('addGate')}
      </Button>
    </fieldset>
  );
}
