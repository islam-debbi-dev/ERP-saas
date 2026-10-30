import { describe, expect, it } from 'vitest';
import {
  evaluateRule,
  type IncentiveRuleParams,
  incentiveRuleParamsSchema,
  type IncentiveRuleParamsInput,
  metricKey,
  objectiveProgress,
  requiredMetrics,
  RuleOutcome,
  ruleThresholds,
  scopeKey,
} from './incentives';

const BRAND = '11111111-1111-4111-8111-111111111111';
const PRODUCT = '22222222-2222-4222-8222-222222222222';
const CARTON = '33333333-3333-4333-8333-333333333333';

function parse(p: IncentiveRuleParamsInput): IncentiveRuleParams {
  return incentiveRuleParamsSchema.parse(p);
}

const CA = metricKey({ metric: 'CA_HT' });
const REC = metricKey({ metric: 'RECOUVREMENT_PCT' });
const GEO = metricKey({ metric: 'GEO_FLAGS' });

describe('incentiveRuleParamsSchema', () => {
  it('accepts each rule type', () => {
    expect(() =>
      parse({ type: 'FIXED_ON_TARGET', metric: 'CA_HT', minPct: '100', amount: '10000' }),
    ).not.toThrow();
    expect(() =>
      parse({
        type: 'TIERS',
        metric: 'QTY',
        scope: { brandId: BRAND },
        mode: 'HIGHEST_REACHED',
        tiers: [
          { fromPct: '80', amount: '5000' },
          { fromPct: '100', amount: '10000' },
        ],
      }),
    ).not.toThrow();
    expect(() => parse({ type: 'COMMISSION', metric: 'ENCAISSEMENT', ratePct: '1.5' })).not.toThrow();
    expect(() =>
      parse({ type: 'PER_UNIT', scope: { productId: PRODUCT }, amountPerUnit: '20', unitId: CARTON }),
    ).not.toThrow();
    expect(() =>
      parse({ type: 'MANAGER_OVERRIDE', metric: 'CA_HT', amount: '20000', minPct: '100' }),
    ).not.toThrow();
  });

  it('refuses a scope on a money-only metric', () => {
    const r = incentiveRuleParamsSchema.safeParse({
      type: 'COMMISSION',
      metric: 'ENCAISSEMENT',
      scope: { brandId: BRAND },
      ratePct: '1',
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('scope_not_allowed');
  });

  it('refuses a scope on a gate metric that has none', () => {
    const r = incentiveRuleParamsSchema.safeParse({
      type: 'FIXED_ON_TARGET',
      metric: 'CA_HT',
      minPct: '100',
      amount: '1',
      gates: [{ metric: 'RECOUVREMENT_PCT', scope: { brandId: BRAND }, min: '70' }],
    });
    expect(r.success).toBe(false);
  });

  it('refuses numbers, floats as numbers and bad amounts', () => {
    for (const amount of [10000, '10,5', '1.234', '-5', '']) {
      const r = incentiveRuleParamsSchema.safeParse({
        type: 'FIXED_ON_TARGET',
        metric: 'CA_HT',
        minPct: '100',
        amount,
      });
      expect(r.success).toBe(false);
    }
  });

  it('refuses tiers out of order, mixed tiers and rate tiers on a count', () => {
    const base = { type: 'TIERS', metric: 'CA_HT', mode: 'PROGRESSIVE' } as const;
    expect(
      incentiveRuleParamsSchema.safeParse({
        ...base,
        tiers: [
          { fromPct: '100', amount: '1' },
          { fromPct: '80', amount: '2' },
        ],
      }).success,
    ).toBe(false);
    expect(
      incentiveRuleParamsSchema.safeParse({
        ...base,
        tiers: [
          { fromPct: '80', amount: '1' },
          { fromPct: '100', ratePct: '2' },
        ],
      }).success,
    ).toBe(false);
    expect(
      incentiveRuleParamsSchema.safeParse({
        ...base,
        metric: 'VISITS',
        tiers: [{ fromPct: '80', ratePct: '1' }],
      }).success,
    ).toBe(false);
  });

  it('refuses a commission on a count and an override with both rate and amount', () => {
    expect(
      incentiveRuleParamsSchema.safeParse({ type: 'COMMISSION', metric: 'VISITS', ratePct: '1' })
        .success,
    ).toBe(false);
    expect(
      incentiveRuleParamsSchema.safeParse({
        type: 'MANAGER_OVERRIDE',
        metric: 'CA_HT',
        ratePct: '1',
        amount: '1',
        minPct: '100',
      }).success,
    ).toBe(false);
    expect(
      incentiveRuleParamsSchema.safeParse({ type: 'MANAGER_OVERRIDE', metric: 'CA_HT', amount: '1' })
        .success,
    ).toBe(false);
  });

  it('requires a scope on PER_UNIT', () => {
    expect(
      incentiveRuleParamsSchema.safeParse({ type: 'PER_UNIT', amountPerUnit: '20' }).success,
    ).toBe(false);
  });
});

describe('evaluateRule: FIXED_ON_TARGET', () => {
  const p = parse({ type: 'FIXED_ON_TARGET', metric: 'CA_HT', minPct: '100', amount: '15000' });

  it('pays the amount from the minimum %', () => {
    const r = evaluateRule(p, { [CA]: '1000000' }, '1000000');
    expect(r.amount).toBe('15000.00');
    expect(r.explanation).toMatchObject({
      achieved: '1000000.00',
      target: '1000000.00',
      pct: '100.00',
      outcome: RuleOutcome.PAID,
      minPct: '100',
    });
  });

  it('pays nothing just below', () => {
    const r = evaluateRule(p, { [CA]: '999999.99' }, '1000000');
    expect(r.amount).toBe('0.00');
    expect(r.explanation.outcome).toBe(RuleOutcome.BELOW_MIN);
    expect(r.explanation.pct).toBe('100.00'); // rounded for display only
  });

  it('pays nothing without a target, or with a zero target', () => {
    expect(evaluateRule(p, { [CA]: '5' }, null).explanation.outcome).toBe(RuleOutcome.NO_TARGET);
    const zero = evaluateRule(p, { [CA]: '5' }, '0');
    expect(zero.amount).toBe('0.00');
    expect(zero.explanation).toMatchObject({ outcome: RuleOutcome.NO_TARGET, pct: null, target: null });
  });

  it('throws when a figure is missing (a bug, never a silent 0)', () => {
    expect(() => evaluateRule(p, {}, '1')).toThrow(/missing metric/);
  });
});

describe('evaluateRule: TIERS', () => {
  const tiers = [
    { fromPct: '80', amount: '10000' },
    { fromPct: '100', amount: '25000' },
    { fromPct: '120', amount: '40000' },
  ];

  it('HIGHEST_REACHED pays the highest tier only', () => {
    const p = parse({ type: 'TIERS', metric: 'CA_HT', mode: 'HIGHEST_REACHED', tiers });
    const r = evaluateRule(p, { [CA]: '1240000' }, '1000000');
    expect(r.amount).toBe('40000.00');
    expect(r.explanation).toMatchObject({ pct: '124.00', tier: { index: 2, fromPct: '120' } });
    expect(evaluateRule(p, { [CA]: '790000' }, '1000000').explanation).toMatchObject({
      outcome: RuleOutcome.BELOW_MIN,
      tier: null,
    });
    expect(evaluateRule(p, { [CA]: '850000' }, '1000000').amount).toBe('10000.00');
  });

  it('PROGRESSIVE with amounts adds every tier reached', () => {
    const p = parse({ type: 'TIERS', metric: 'CA_HT', mode: 'PROGRESSIVE', tiers });
    const r = evaluateRule(p, { [CA]: '1100000' }, '1000000');
    expect(r.amount).toBe('35000.00');
    expect(r.explanation.steps).toHaveLength(2);
  });

  it('HIGHEST_REACHED with rates applies the tier rate to the whole figure', () => {
    const p = parse({
      type: 'TIERS',
      metric: 'CA_HT',
      mode: 'HIGHEST_REACHED',
      tiers: [
        { fromPct: '0', ratePct: '1' },
        { fromPct: '100', ratePct: '2' },
      ],
    });
    expect(evaluateRule(p, { [CA]: '1500000' }, '1000000').amount).toBe('30000.00');
    expect(evaluateRule(p, { [CA]: '900000' }, '1000000').amount).toBe('9000.00');
  });

  it('PROGRESSIVE with rates pays each slice at its own rate', () => {
    const p = parse({
      type: 'TIERS',
      metric: 'CA_HT',
      mode: 'PROGRESSIVE',
      tiers: [
        { fromPct: '0', ratePct: '1' },
        { fromPct: '100', ratePct: '2' },
        { fromPct: '150', ratePct: '3' },
      ],
    });
    // 0–1 000 000 at 1 % = 10 000; 1 000 000–1 200 000 at 2 % = 4 000.
    const r = evaluateRule(p, { [CA]: '1200000' }, '1000000');
    expect(r.amount).toBe('14000.00');
    expect(r.explanation.steps).toEqual([
      { fromPct: '0', base: '1000000.00', ratePct: '1', amount: '10000.00' },
      { fromPct: '100', base: '200000.00', ratePct: '2', amount: '4000.00' },
    ]);
  });
});

describe('evaluateRule: COMMISSION', () => {
  it('pays a rate on the whole figure', () => {
    const p = parse({ type: 'COMMISSION', metric: 'CA_HT', ratePct: '1.5' });
    expect(evaluateRule(p, { [CA]: '333333.33' }, null).amount).toBe('5000.00');
  });

  it('pays only above a % of the target', () => {
    const p = parse({ type: 'COMMISSION', metric: 'CA_HT', ratePct: '5', onlyAbovePct: '100' });
    const r = evaluateRule(p, { [CA]: '1200000' }, '1000000');
    expect(r.amount).toBe('10000.00');
    expect(r.explanation).toMatchObject({ base: '200000.00', ratePct: '5' });
    expect(evaluateRule(p, { [CA]: '900000' }, '1000000').explanation.outcome).toBe(
      RuleOutcome.BELOW_MIN,
    );
    expect(evaluateRule(p, { [CA]: '1200000' }, null).explanation.outcome).toBe(
      RuleOutcome.NO_TARGET,
    );
  });

  it('never pays a negative amount (more returns than sales)', () => {
    const p = parse({ type: 'COMMISSION', metric: 'CA_HT', ratePct: '2' });
    const r = evaluateRule(p, { [CA]: '-50000' }, null);
    expect(r.amount).toBe('0.00');
    expect(r.explanation.outcome).toBe(RuleOutcome.NOTHING);
  });

  it('keeps decimal precision (no float drift)', () => {
    const p = parse({ type: 'COMMISSION', metric: 'CA_HT', ratePct: '0.1' });
    // 0.1 % of 0.3 is 0.0003; ×3 lines would drift with floats. Rounded half-up at the end.
    expect(evaluateRule(p, { [CA]: '5.00' }, null).amount).toBe('0.01'); // 0.005 → 0.01
    expect(evaluateRule(p, { [CA]: '4.99' }, null).amount).toBe('0.00');
    expect(evaluateRule(p, { [CA]: '123456789012.34' }, null).amount).toBe('123456789.01');
  });
});

describe('evaluateRule: PER_UNIT', () => {
  const p = parse({
    type: 'PER_UNIT',
    scope: { productId: PRODUCT },
    unitId: CARTON,
    amountPerUnit: '25.50',
  });
  const key = metricKey({ metric: 'QTY', scope: { productId: PRODUCT }, unitId: CARTON });

  it('pays whole units only', () => {
    const r = evaluateRule(p, { [key]: '10.75' }, null);
    expect(r.amount).toBe('255.00');
    expect(r.explanation).toMatchObject({ units: '10', amountPerUnit: '25.50', achieved: '10' });
  });

  it('pays nothing for no or negative units', () => {
    expect(evaluateRule(p, { [key]: '-3' }, null).amount).toBe('0.00');
    expect(evaluateRule(p, { [key]: '0' }, null).explanation.outcome).toBe(RuleOutcome.NOTHING);
  });

  it('reads the scoped figure, not the unscoped one', () => {
    expect(requiredMetrics(p).map(metricKey)).toEqual([key]);
    expect(key).toBe(`QTY@p:${PRODUCT}#${CARTON}`);
  });
});

describe('evaluateRule: MANAGER_OVERRIDE', () => {
  it('pays a rate of the team figure', () => {
    const p = parse({ type: 'MANAGER_OVERRIDE', metric: 'CA_HT', ratePct: '0.5' });
    expect(evaluateRule(p, { [CA]: '8000000' }, null).amount).toBe('40000.00');
  });

  it('pays an amount when the team reaches the minimum', () => {
    const p = parse({ type: 'MANAGER_OVERRIDE', metric: 'CA_HT', amount: '30000', minPct: '100' });
    expect(evaluateRule(p, { [CA]: '5000000' }, '5000000').amount).toBe('30000.00');
    expect(evaluateRule(p, { [CA]: '4999999' }, '5000000').amount).toBe('0.00');
  });
});

describe('gates and cap', () => {
  const p = parse({
    type: 'FIXED_ON_TARGET',
    metric: 'CA_HT',
    minPct: '100',
    amount: '50000',
    gates: [
      { metric: 'RECOUVREMENT_PCT', min: '70' },
      { metric: 'GEO_FLAGS', max: '3' },
    ],
    cap: '30000',
  });

  it('pays (capped) when every gate passes', () => {
    const r = evaluateRule(p, { [CA]: '1000000', [REC]: '70', [GEO]: '3' }, '1000000');
    expect(r.amount).toBe('30000.00');
    expect(r.explanation).toMatchObject({ gross: '50000.00', capped: true, cap: '30000.00' });
    expect(r.explanation.gates.every((g) => g.passed)).toBe(true);
  });

  it('pays nothing when one gate fails, and says which', () => {
    const r = evaluateRule(p, { [CA]: '1000000', [REC]: '69.99', [GEO]: '0' }, '1000000');
    expect(r.amount).toBe('0.00');
    expect(r.explanation.outcome).toBe(RuleOutcome.GATE_FAILED);
    expect(r.explanation.gates).toEqual([
      { metric: 'RECOUVREMENT_PCT', value: '69.99', min: '70', passed: false },
      { metric: 'GEO_FLAGS', value: '0', max: '3', passed: true },
    ]);
    expect(evaluateRule(p, { [CA]: '1000000', [REC]: '90', [GEO]: '4' }, '1000000').amount).toBe(
      '0.00',
    );
  });

  it('does not cap below the cap', () => {
    const q = parse({ type: 'COMMISSION', metric: 'CA_HT', ratePct: '1', cap: '30000' });
    expect(evaluateRule(q, { [CA]: '1000000' }, null).explanation.capped).toBe(false);
  });
});

describe('scopes and keys', () => {
  it('builds stable keys', () => {
    expect(scopeKey(undefined)).toBe('');
    expect(scopeKey({ productId: PRODUCT, brandId: BRAND })).toBe(`b:${BRAND}|p:${PRODUCT}`);
    expect(metricKey({ metric: 'CA_HT', scope: { brandId: BRAND } })).toBe(`CA_HT@b:${BRAND}`);
  });

  it('a scoped rule reads its scoped figure', () => {
    const p = parse({
      type: 'FIXED_ON_TARGET',
      metric: 'CA_HT',
      scope: { brandId: BRAND },
      minPct: '100',
      amount: '1000',
    });
    const scoped = metricKey({ metric: 'CA_HT', scope: { brandId: BRAND } });
    expect(evaluateRule(p, { [CA]: '9999999', [scoped]: '10' }, '100').amount).toBe('0.00');
    expect(evaluateRule(p, { [CA]: '0', [scoped]: '100' }, '100').amount).toBe('1000.00');
  });

  it('lists thresholds for the live progress', () => {
    expect(
      ruleThresholds(
        parse({
          type: 'TIERS',
          metric: 'CA_HT',
          mode: 'HIGHEST_REACHED',
          tiers: [
            { fromPct: '80', amount: '1' },
            { fromPct: '100', amount: '2' },
          ],
        }),
      ),
    ).toEqual(['80', '100']);
  });
});

describe('objectiveProgress', () => {
  it('says what is left for the next threshold', () => {
    expect(objectiveProgress('760000', '1000000', ['80', '100', '120'], 2)).toEqual({
      pct: '76.00',
      next: { pct: '80', remaining: '40000.00' },
    });
    expect(objectiveProgress('860000', '1000000', ['80', '100', '120'], 2).next).toEqual({
      pct: '100',
      remaining: '140000.00',
    });
  });

  it('defaults to 100 % and stops once everything is reached', () => {
    expect(objectiveProgress('50', '200', [], 0).next).toEqual({ pct: '100', remaining: '150' });
    expect(objectiveProgress('250', '200', [], 0)).toEqual({ pct: '125.00', next: null });
  });

  it('rounds what is left up, never down', () => {
    expect(objectiveProgress('0', '3', ['100'], 0).next?.remaining).toBe('3');
    expect(objectiveProgress('0.5', '3.333', ['100'], 2).next?.remaining).toBe('2.84');
  });

  it('has no % without a target', () => {
    expect(objectiveProgress('10', '0', [], 2)).toEqual({ pct: null, next: null });
  });
});
