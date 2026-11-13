/**
 * Objectifs & primes (phase 18): the metrics, the rule params a company configures, and
 * the pure engine that turns a seller's figures into a bonus with its explanation.
 * No DB access here: the API computes the figures, this decides the amount.
 *
 * Amounts and percentages are decimal strings, never JS numbers (AGENTS.md rule 4).
 */
import { z } from 'zod';
import { money, type Money, MoneyDecimal, toMoneyString } from './money';

export const IncentiveMetric = {
  /** Validated BL and factures HT (a facture made from BLs counted once), minus avoirs HT. */
  CA_HT: 'CA_HT',
  /** Base-unit quantity sold minus returned. */
  QTY: 'QTY',
  /** Versements collected, minus the ones cancelled or bounced (in the month reversed). */
  ENCAISSEMENT: 'ENCAISSEMENT',
  /** CA HT minus cost at the frozen CUMP (VIEW_COST_AND_MARGIN). */
  MARGE: 'MARGE',
  /** Clients whose first ever validated sale is in the period. */
  NEW_CLIENTS: 'NEW_CLIENTS',
  /** Visits made (phase 16; a corrected visit counts once). */
  VISITS: 'VISITS',
  /** Visits with a sale or an order, over all visits, as a percentage. */
  STRIKE_RATE: 'STRIKE_RATE',
  /** Versements (not paid at sale) over the credit part of the period's sales, %. */
  RECOUVREMENT_PCT: 'RECOUVREMENT_PCT',
  /** Flagged operations reviewed "not justified" (phase 17). */
  GEO_FLAGS: 'GEO_FLAGS',
} as const;
export type IncentiveMetric = (typeof IncentiveMetric)[keyof typeof IncentiveMetric];
export const INCENTIVE_METRICS = Object.values(IncentiveMetric);

/** Metrics in DA. */
export const MONEY_METRICS: readonly IncentiveMetric[] = [
  IncentiveMetric.CA_HT,
  IncentiveMetric.ENCAISSEMENT,
  IncentiveMetric.MARGE,
];
/** Metrics that can be limited to a brand, a category or a product. */
export const SCOPABLE_METRICS: readonly IncentiveMetric[] = [
  IncentiveMetric.CA_HT,
  IncentiveMetric.QTY,
  IncentiveMetric.MARGE,
];
/** Metrics a target can be set on (ratios and flags are gates, they do not add up). */
export const TARGET_METRICS: readonly IncentiveMetric[] = [
  IncentiveMetric.CA_HT,
  IncentiveMetric.QTY,
  IncentiveMetric.ENCAISSEMENT,
  IncentiveMetric.MARGE,
  IncentiveMetric.NEW_CLIENTS,
  IncentiveMetric.VISITS,
];
/** Percentages, not quantities. */
export const PERCENT_METRICS: readonly IncentiveMetric[] = [
  IncentiveMetric.STRIKE_RATE,
  IncentiveMetric.RECOUVREMENT_PCT,
];

/** Decimals a metric is shown and stored with. */
export function metricDecimals(metric: IncentiveMetric): number {
  if (metric === IncentiveMetric.QTY) return 3;
  if (MONEY_METRICS.includes(metric) || PERCENT_METRICS.includes(metric)) return 2;
  return 0;
}

export const IncentiveRuleType = {
  FIXED_ON_TARGET: 'FIXED_ON_TARGET',
  TIERS: 'TIERS',
  COMMISSION: 'COMMISSION',
  PER_UNIT: 'PER_UNIT',
  MANAGER_OVERRIDE: 'MANAGER_OVERRIDE',
} as const;
export type IncentiveRuleType = (typeof IncentiveRuleType)[keyof typeof IncentiveRuleType];
export const INCENTIVE_RULE_TYPES = Object.values(IncentiveRuleType);

export const TierMode = {
  /** The highest tier reached pays alone. */
  HIGHEST_REACHED: 'HIGHEST_REACHED',
  /** Every tier reached pays its part (like tax brackets). */
  PROGRESSIVE: 'PROGRESSIVE',
} as const;
export type TierMode = (typeof TierMode)[keyof typeof TierMode];
export const TIER_MODES = Object.values(TierMode);

// ---------------------------------------------------------------- params schema

/** A DA amount as typed: up to 12 digits and 2 decimals, `.` separator. */
export const bonusAmountString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'invalid_amount');
/** A percentage, 0 to 9999.99. */
export const pctString = z
  .string()
  .trim()
  .regex(/^\d{1,4}(\.\d{1,2})?$/, 'invalid_percent');
/** A metric value (a gate bound, a target): up to 3 decimals. */
export const metricValueString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, 'invalid_value');

export const metricScopeSchema = z
  .object({
    brandId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    productId: z.uuid().optional(),
  })
  .strict()
  .refine((s) => !!(s.brandId || s.categoryId || s.productId), { message: 'empty_scope' });
export type MetricScope = z.infer<typeof metricScopeSchema>;

const metric = z.enum(INCENTIVE_METRICS as [IncentiveMetric, ...IncentiveMetric[]]);

export const gateSchema = z
  .object({
    metric,
    scope: metricScopeSchema.optional(),
    min: metricValueString.optional(),
    max: metricValueString.optional(),
  })
  .strict()
  .refine((g) => g.min !== undefined || g.max !== undefined, { message: 'gate_needs_bound' });
export type IncentiveGate = z.infer<typeof gateSchema>;

const common = {
  /** Every gate must pass, or the rule pays nothing. */
  gates: z.array(gateSchema).max(5).default([]),
  /** The most the rule pays. */
  cap: bonusAmountString.optional(),
};

const tierSchema = z
  .object({
    fromPct: pctString,
    amount: bonusAmountString.optional(),
    ratePct: pctString.optional(),
  })
  .strict()
  .refine((t) => (t.amount === undefined) !== (t.ratePct === undefined), {
    message: 'tier_amount_or_rate',
  });
export type IncentiveTier = z.infer<typeof tierSchema>;

const fixedOnTarget = z
  .object({
    type: z.literal(IncentiveRuleType.FIXED_ON_TARGET),
    metric,
    scope: metricScopeSchema.optional(),
    minPct: pctString,
    amount: bonusAmountString,
    ...common,
  })
  .strict();

const tiers = z
  .object({
    type: z.literal(IncentiveRuleType.TIERS),
    metric,
    scope: metricScopeSchema.optional(),
    mode: z.enum(TIER_MODES as [TierMode, ...TierMode[]]),
    tiers: z.array(tierSchema).min(1).max(10),
    ...common,
  })
  .strict();

const commission = z
  .object({
    type: z.literal(IncentiveRuleType.COMMISSION),
    metric,
    scope: metricScopeSchema.optional(),
    ratePct: pctString,
    /** Only the part above this % of the target pays. */
    onlyAbovePct: pctString.optional(),
    ...common,
  })
  .strict();

const perUnit = z
  .object({
    type: z.literal(IncentiveRuleType.PER_UNIT),
    scope: metricScopeSchema,
    amountPerUnit: bonusAmountString,
    /** A unit of the scoped product (carton): counted in whole units of it. */
    unitId: z.uuid().optional(),
    ...common,
  })
  .strict();

const managerOverride = z
  .object({
    type: z.literal(IncentiveRuleType.MANAGER_OVERRIDE),
    metric,
    scope: metricScopeSchema.optional(),
    /** A % of the team's achieved value… */
    ratePct: pctString.optional(),
    /** …or a fixed amount, when the team reaches `minPct` of its target. */
    amount: bonusAmountString.optional(),
    minPct: pctString.optional(),
    ...common,
  })
  .strict();

function checkMetricScope(
  ctx: z.RefinementCtx,
  m: IncentiveMetric,
  scope: MetricScope | undefined,
  path: (string | number)[],
) {
  if (scope && !SCOPABLE_METRICS.includes(m)) {
    ctx.addIssue({ code: 'custom', message: 'scope_not_allowed', path });
  }
}

/**
 * What a rule pays, by type. Checked here and again by the API (same schema): scopes
 * only on CA / quantity / margin, rates only on money, tiers in ascending order.
 */
export const incentiveRuleParamsSchema = z
  .discriminatedUnion('type', [fixedOnTarget, tiers, commission, perUnit, managerOverride])
  .superRefine((p, ctx) => {
    p.gates.forEach((g, i) => checkMetricScope(ctx, g.metric, g.scope, ['gates', i, 'scope']));
    if (p.type === IncentiveRuleType.PER_UNIT) return;
    checkMetricScope(ctx, p.metric, p.scope, ['scope']);
    if (p.type !== IncentiveRuleType.COMMISSION && !TARGET_METRICS.includes(p.metric)) {
      ctx.addIssue({ code: 'custom', message: 'metric_has_no_target', path: ['metric'] });
    }
    const money_ = MONEY_METRICS.includes(p.metric);
    if (p.type === IncentiveRuleType.COMMISSION && !money_) {
      ctx.addIssue({ code: 'custom', message: 'rate_needs_money_metric', path: ['metric'] });
    }
    if (p.type === IncentiveRuleType.TIERS) {
      const rated = p.tiers.filter((t) => t.ratePct !== undefined).length;
      if (rated !== 0 && rated !== p.tiers.length) {
        ctx.addIssue({ code: 'custom', message: 'tiers_mixed', path: ['tiers'] });
      }
      if (rated > 0 && !money_) {
        ctx.addIssue({ code: 'custom', message: 'rate_needs_money_metric', path: ['metric'] });
      }
      for (let i = 1; i < p.tiers.length; i++) {
        if (!money(p.tiers[i]!.fromPct).gt(money(p.tiers[i - 1]!.fromPct))) {
          ctx.addIssue({ code: 'custom', message: 'tiers_not_ascending', path: ['tiers', i] });
        }
      }
    }
    if (p.type === IncentiveRuleType.MANAGER_OVERRIDE) {
      if ((p.ratePct === undefined) === (p.amount === undefined)) {
        ctx.addIssue({ code: 'custom', message: 'override_rate_or_amount', path: ['ratePct'] });
      }
      if (p.amount !== undefined && p.minPct === undefined) {
        ctx.addIssue({ code: 'custom', message: 'override_amount_needs_min', path: ['minPct'] });
      }
      if (p.ratePct !== undefined && !money_) {
        ctx.addIssue({ code: 'custom', message: 'rate_needs_money_metric', path: ['metric'] });
      }
    }
  });
export type IncentiveRuleParams = z.infer<typeof incentiveRuleParamsSchema>;
export type IncentiveRuleParamsInput = z.input<typeof incentiveRuleParamsSchema>;

// ---------------------------------------------------------------- metric keys

/** One figure the engine needs: a metric, maybe scoped, maybe counted in a unit. */
export interface MetricRef {
  metric: IncentiveMetric;
  scope?: MetricScope;
  unitId?: string;
}

/** Stable text of a scope ('' for none), used as a key and stored on targets. */
export function scopeKey(scope: MetricScope | null | undefined): string {
  if (!scope) return '';
  const parts: string[] = [];
  if (scope.brandId) parts.push(`b:${scope.brandId}`);
  if (scope.categoryId) parts.push(`c:${scope.categoryId}`);
  if (scope.productId) parts.push(`p:${scope.productId}`);
  return parts.join('|');
}

export function metricKey(ref: MetricRef): string {
  const s = scopeKey(ref.scope);
  return `${ref.metric}${s ? `@${s}` : ''}${ref.unitId ? `#${ref.unitId}` : ''}`;
}

/** Figures by `metricKey`, as decimal strings. */
export type MetricValues = Readonly<Record<string, string>>;

/** The figure a rule is measured on (its target applies to it), or null for PER_UNIT. */
export function ruleMainMetric(p: IncentiveRuleParams): MetricRef {
  if (p.type === IncentiveRuleType.PER_UNIT) {
    return {
      metric: IncentiveMetric.QTY,
      scope: p.scope,
      ...(p.unitId ? { unitId: p.unitId } : {}),
    };
  }
  return { metric: p.metric, ...(p.scope ? { scope: p.scope } : {}) };
}

/** Every figure `evaluateRule` reads for these params. */
export function requiredMetrics(p: IncentiveRuleParams): MetricRef[] {
  return [
    ruleMainMetric(p),
    ...p.gates.map((g) => ({ metric: g.metric, ...(g.scope ? { scope: g.scope } : {}) })),
  ];
}

/** Whether the rule's amount depends on a target. */
export function ruleNeedsTarget(p: IncentiveRuleParams): boolean {
  switch (p.type) {
    case IncentiveRuleType.FIXED_ON_TARGET:
    case IncentiveRuleType.TIERS:
      return true;
    case IncentiveRuleType.COMMISSION:
      return p.onlyAbovePct !== undefined;
    case IncentiveRuleType.MANAGER_OVERRIDE:
      return p.minPct !== undefined;
    case IncentiveRuleType.PER_UNIT:
      return false;
  }
}

/** The % of target where the rule starts paying more: shown as "next tier" to sellers. */
export function ruleThresholds(p: IncentiveRuleParams): string[] {
  switch (p.type) {
    case IncentiveRuleType.FIXED_ON_TARGET:
      return [p.minPct];
    case IncentiveRuleType.TIERS:
      return p.tiers.map((t) => t.fromPct);
    case IncentiveRuleType.COMMISSION:
      return p.onlyAbovePct !== undefined ? [p.onlyAbovePct] : [];
    case IncentiveRuleType.MANAGER_OVERRIDE:
      return p.minPct !== undefined ? [p.minPct] : [];
    case IncentiveRuleType.PER_UNIT:
      return [];
  }
}

// ---------------------------------------------------------------- engine

export const RuleOutcome = {
  PAID: 'PAID',
  /** The rule needs a target and there is none (or it is 0). */
  NO_TARGET: 'NO_TARGET',
  /** Below the minimum % (or the first tier). */
  BELOW_MIN: 'BELOW_MIN',
  /** A gate failed: nothing is paid. */
  GATE_FAILED: 'GATE_FAILED',
  /** Nothing to pay (no units, nothing above the threshold, negative figure). */
  NOTHING: 'NOTHING',
} as const;
export type RuleOutcome = (typeof RuleOutcome)[keyof typeof RuleOutcome];

export interface GateResult {
  metric: IncentiveMetric;
  scope?: MetricScope;
  value: string;
  min?: string;
  max?: string;
  passed: boolean;
}

/** One progressive tier's share. */
export interface TierStep {
  fromPct: string;
  /** The value this tier paid on (rate tiers), or null (amount tiers). */
  base: string | null;
  ratePct?: string;
  amount: string;
}

/**
 * Why a rule paid what it paid: plain data the web renders in ar / fr / en, e.g.
 * "1 240 000 DA sur 1 000 000 = 124 % → palier 120 % → 40 000 DA".
 */
export interface RuleExplanation {
  type: IncentiveRuleType;
  metric: IncentiveMetric;
  scope?: MetricScope;
  unitId?: string;
  /** The rule's figure (units counted for PER_UNIT). */
  achieved: string;
  target: string | null;
  /** achieved / target, 2 decimals; null without a target. */
  pct: string | null;
  outcome: RuleOutcome;
  minPct?: string;
  mode?: TierMode;
  /** Index (0-based) and threshold of the tier reached (HIGHEST_REACHED, or the last one). */
  tier?: { index: number; fromPct: string } | null;
  steps?: TierStep[];
  ratePct?: string;
  /** What a rate was applied on (commission above a threshold, override). */
  base?: string;
  units?: string;
  amountPerUnit?: string;
  gates: GateResult[];
  /** Before gates and cap. */
  gross: string;
  cap: string | null;
  capped: boolean;
  amount: string;
}

export interface RuleEvaluation {
  amount: string;
  explanation: RuleExplanation;
}

const HUNDRED = money(100);

function read(metrics: MetricValues, ref: MetricRef): Money {
  const v = metrics[metricKey(ref)];
  if (v === undefined) throw new Error(`missing metric ${metricKey(ref)}`);
  return money(v);
}

function pctOf(achieved: Money, target: Money): Money {
  return achieved.div(target).times(HUNDRED);
}

function ofPct(target: Money, pct: string): Money {
  return target.times(money(pct)).div(HUNDRED);
}

function rate(base: Money, ratePct: string): Money {
  return base.times(money(ratePct)).div(HUNDRED);
}

/**
 * What one rule pays one person (or team), and why. `metrics` must hold every figure of
 * `requiredMetrics(params)`; `target` is the target of the rule's main figure (null when
 * none was set). Rounded half-up to the centime only at the end; never negative.
 */
export function evaluateRule(
  params: IncentiveRuleParams,
  metrics: MetricValues,
  target: string | null,
): RuleEvaluation {
  const main = ruleMainMetric(params);
  const raw = read(metrics, main);
  const t = target === null ? null : money(target);
  const hasTarget = t !== null && t.gt(0);
  const achieved = params.type === IncentiveRuleType.PER_UNIT ? raw.floor() : raw;
  const pct = hasTarget ? pctOf(achieved, t) : null;

  const gates: GateResult[] = params.gates.map((g) => {
    const value = read(metrics, { metric: g.metric, ...(g.scope ? { scope: g.scope } : {}) });
    const passed =
      (g.min === undefined || value.gte(money(g.min))) &&
      (g.max === undefined || value.lte(money(g.max)));
    return {
      metric: g.metric,
      ...(g.scope ? { scope: g.scope } : {}),
      value: value.toFixed(metricDecimals(g.metric)),
      ...(g.min !== undefined ? { min: g.min } : {}),
      ...(g.max !== undefined ? { max: g.max } : {}),
      passed,
    };
  });

  let gross = money(0);
  let outcome: RuleOutcome = RuleOutcome.PAID;
  const extra: Partial<RuleExplanation> = {};
  const needTarget = ruleNeedsTarget(params) && !hasTarget;

  switch (params.type) {
    case IncentiveRuleType.FIXED_ON_TARGET: {
      extra.minPct = params.minPct;
      if (needTarget) outcome = RuleOutcome.NO_TARGET;
      else if (pct!.lt(money(params.minPct))) outcome = RuleOutcome.BELOW_MIN;
      else gross = money(params.amount);
      break;
    }
    case IncentiveRuleType.TIERS: {
      extra.mode = params.mode;
      if (needTarget) {
        outcome = RuleOutcome.NO_TARGET;
        break;
      }
      const reached = params.tiers
        .map((tier, index) => ({ tier, index }))
        .filter(({ tier }) => pct!.gte(money(tier.fromPct)));
      const last = reached.at(-1);
      extra.tier = last ? { index: last.index, fromPct: last.tier.fromPct } : null;
      if (!last) {
        outcome = RuleOutcome.BELOW_MIN;
        break;
      }
      if (params.mode === TierMode.HIGHEST_REACHED) {
        if (last.tier.amount !== undefined) gross = money(last.tier.amount);
        else {
          gross = rate(achieved, last.tier.ratePct!);
          extra.ratePct = last.tier.ratePct!;
          extra.base = achieved.toFixed(2);
        }
        break;
      }
      const steps: TierStep[] = reached.map(({ tier, index }) => {
        if (tier.amount !== undefined) {
          return { fromPct: tier.fromPct, base: null, amount: toMoneyString(tier.amount) };
        }
        const next = params.tiers[index + 1];
        const lower = ofPct(t!, tier.fromPct);
        const upper = next ? MoneyDecimal.min(achieved, ofPct(t!, next.fromPct)) : achieved;
        const base = MoneyDecimal.max(upper.minus(lower), 0);
        return {
          fromPct: tier.fromPct,
          base: toMoneyString(base),
          ratePct: tier.ratePct!,
          amount: toMoneyString(rate(base, tier.ratePct!)),
        };
      });
      extra.steps = steps;
      gross = steps.reduce((s, x) => s.plus(money(x.amount)), money(0));
      break;
    }
    case IncentiveRuleType.COMMISSION: {
      extra.ratePct = params.ratePct;
      if (params.onlyAbovePct !== undefined) extra.minPct = params.onlyAbovePct;
      if (needTarget) {
        outcome = RuleOutcome.NO_TARGET;
        break;
      }
      const base =
        params.onlyAbovePct !== undefined
          ? achieved.minus(ofPct(t!, params.onlyAbovePct))
          : achieved;
      extra.base = toMoneyString(base);
      if (!base.gt(0)) {
        outcome = params.onlyAbovePct !== undefined ? RuleOutcome.BELOW_MIN : RuleOutcome.NOTHING;
        break;
      }
      gross = rate(base, params.ratePct);
      break;
    }
    case IncentiveRuleType.PER_UNIT: {
      extra.units = achieved.toFixed(0);
      extra.amountPerUnit = params.amountPerUnit;
      if (!achieved.gt(0)) outcome = RuleOutcome.NOTHING;
      else gross = achieved.times(money(params.amountPerUnit));
      break;
    }
    case IncentiveRuleType.MANAGER_OVERRIDE: {
      if (params.minPct !== undefined) extra.minPct = params.minPct;
      if (needTarget) {
        outcome = RuleOutcome.NO_TARGET;
        break;
      }
      if (params.minPct !== undefined && pct!.lt(money(params.minPct))) {
        outcome = RuleOutcome.BELOW_MIN;
        break;
      }
      if (params.amount !== undefined) {
        gross = money(params.amount);
      } else {
        extra.ratePct = params.ratePct!;
        extra.base = toMoneyString(achieved);
        if (!achieved.gt(0)) outcome = RuleOutcome.NOTHING;
        else gross = rate(achieved, params.ratePct!);
      }
      break;
    }
  }

  if (outcome === RuleOutcome.PAID && !gross.gt(0)) outcome = RuleOutcome.NOTHING;
  const gatesPass = gates.every((g) => g.passed);
  if (outcome === RuleOutcome.PAID && !gatesPass) outcome = RuleOutcome.GATE_FAILED;

  let amount = outcome === RuleOutcome.PAID ? gross : money(0);
  const cap = params.cap !== undefined ? money(params.cap) : null;
  const capped = cap !== null && amount.gt(cap);
  if (capped) amount = cap;
  const amountStr = toMoneyString(amount);

  return {
    amount: amountStr,
    explanation: {
      type: params.type,
      metric: main.metric,
      ...(main.scope ? { scope: main.scope } : {}),
      ...(main.unitId ? { unitId: main.unitId } : {}),
      achieved: achieved.toFixed(
        params.type === IncentiveRuleType.PER_UNIT ? 0 : metricDecimals(main.metric),
      ),
      target: hasTarget ? t.toFixed(metricDecimals(main.metric)) : null,
      pct: pct ? pct.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).toFixed(2) : null,
      outcome,
      gates,
      gross: toMoneyString(MoneyDecimal.max(gross, 0)),
      cap: cap ? toMoneyString(cap) : null,
      capped,
      amount: amountStr,
      ...extra,
    },
  };
}

// ---------------------------------------------------------------- live progress

export interface ObjectiveStep {
  /** % of the target of the next threshold. */
  pct: string;
  /** What is left to reach it, in the metric's unit (never negative). */
  remaining: string;
}

/**
 * Where a seller stands on a target: %, and the next threshold he has not reached yet
 * ("il vous reste 240 000 DA pour le palier 100 %"). Thresholds come from the plan's
 * rules on that figure; 100 % when none.
 */
export function objectiveProgress(
  achieved: string,
  target: string,
  thresholdsPct: readonly string[],
  decimals: number,
): { pct: string | null; next: ObjectiveStep | null } {
  const a = money(achieved);
  const t = money(target);
  if (!t.gt(0)) return { pct: null, next: null };
  const pct = pctOf(a, t);
  const sorted = [...new Set(thresholdsPct.length ? thresholdsPct : ['100'])]
    .map((p) => money(p))
    .sort((x, y) => x.comparedTo(y));
  const next = sorted.find((p) => ofPct(t, p.toString()).gt(a));
  return {
    pct: pct.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).toFixed(2),
    next: next
      ? {
          pct: next.toString(),
          remaining: ofPct(t, next.toString())
            .minus(a)
            .toDecimalPlaces(decimals, MoneyDecimal.ROUND_UP)
            .toFixed(decimals),
        }
      : null,
  };
}

/** Example figures for the plan builder's live preview. */
export function exampleMetrics(params: IncentiveRuleParams, achieved: string): MetricValues {
  const out: Record<string, string> = {};
  for (const ref of requiredMetrics(params)) {
    out[metricKey(ref)] =
      ref.metric === IncentiveMetric.RECOUVREMENT_PCT
        ? '80'
        : ref.metric === IncentiveMetric.STRIKE_RATE
          ? '60'
          : ref.metric === IncentiveMetric.GEO_FLAGS
            ? '1'
            : achieved;
  }
  out[metricKey(ruleMainMetric(params))] = achieved;
  return out;
}
