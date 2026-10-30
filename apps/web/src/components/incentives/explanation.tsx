'use client';

import { ArrowRight, Check, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Fragment, type ReactNode } from 'react';
import {
  formatDA,
  type IncentiveMetric,
  MONEY_METRICS,
  type MetricScope,
  PERCENT_METRICS,
  type RuleExplanation,
  scopeKey,
} from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { cn } from '@/lib/utils';

/** No-break space before `%` (kept as a constant: lint refuses the literal). */
const NBSP = String.fromCharCode(160);

/** A figure as the user reads it: DA, %, or a count / quantity. */
export function useMetricValue(): (metric: IncentiveMetric, value: string) => string {
  const format = useFormatter();
  return (metric, value) => {
    if (MONEY_METRICS.includes(metric)) return formatDA(value);
    // Display only: these are counts and percentages, never stored back.
    const n = Number(value);
    if (PERCENT_METRICS.includes(metric)) {
      return `${format.number(n, { maximumFractionDigits: 2 })}${NBSP}%`;
    }
    return format.number(n, { maximumFractionDigits: 3 });
  };
}

export function usePct(): (pct: string) => string {
  const format = useFormatter();
  return (pct) => `${format.number(Number(pct), { maximumFractionDigits: 2 })}${NBSP}%`;
}

/** "CA HT · Marque Elio". */
export function useMetricLabel(): (
  metric: IncentiveMetric,
  scope?: MetricScope | null,
  labels?: Record<string, string>,
) => string {
  const t = useTranslations('incentives');
  return (metric, scope, labels) => {
    const name = t(`metric.${metric}`);
    const s = scope ? labels?.[scopeKey(scope)] : undefined;
    return s ? `${name} (${s})` : name;
  };
}

/** Numbers stay left-to-right inside Arabic text. */
function Num({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="num whitespace-nowrap">
      {children}
    </bdi>
  );
}

/**
 * Why a rule paid what it paid, as a chain the owner can check by hand:
 * "1 240 000 DA sur 1 000 000 DA = 124 % → palier 120 % → 40 000 DA", then the
 * conditions (gates) and the cap. Rendered from the structured explanation in the
 * user's language; the API stored the data, not the sentence.
 */
export function Explanation({
  e,
  labels,
  className,
}: {
  e: RuleExplanation;
  labels?: Record<string, string>;
  className?: string;
}) {
  const t = useTranslations('incentives');
  const value = useMetricValue();
  const pct = usePct();
  const metricLabel = useMetricLabel();
  const money = (v: string) => formatDA(v);

  const steps: ReactNode[] = [];
  if (e.type === 'PER_UNIT') {
    steps.push(
      t.rich('expUnits', {
        units: e.units ?? '0',
        amount: money(e.amountPerUnit ?? '0'),
        n: (c) => <Num>{c}</Num>,
      }),
    );
  } else if (e.target !== null && e.pct !== null) {
    steps.push(
      t.rich('expVsTarget', {
        achieved: value(e.metric, e.achieved),
        target: value(e.metric, e.target),
        pct: pct(e.pct),
        n: (c) => <Num>{c}</Num>,
      }),
    );
  } else {
    steps.push(<Num key="a">{value(e.metric, e.achieved)}</Num>);
  }

  const n = (c: ReactNode) => <Num>{c}</Num>;
  switch (e.outcome) {
    case 'NO_TARGET':
      steps.push(t('outcomeNO_TARGET'));
      break;
    case 'BELOW_MIN':
      steps.push(
        e.minPct !== undefined
          ? t.rich('outcomeBELOW_MIN', { pct: pct(e.minPct), n })
          : t('outcomeBELOW_TIERS'),
      );
      break;
    case 'NOTHING':
      steps.push(t('outcomeNOTHING'));
      break;
    default:
      if (e.type === 'TIERS' && e.steps) {
        for (const s of e.steps) {
          steps.push(
            s.ratePct !== undefined
              ? t.rich('expStepRate', {
                  pct: pct(s.fromPct),
                  rate: pct(s.ratePct),
                  base: money(s.base ?? '0'),
                  amount: money(s.amount),
                  n,
                })
              : t.rich('expStepAmount', { pct: pct(s.fromPct), amount: money(s.amount), n }),
          );
        }
      } else if (e.type === 'TIERS' && e.tier) {
        steps.push(t.rich('expTier', { pct: pct(e.tier.fromPct), n }));
        if (e.ratePct !== undefined) {
          steps.push(t.rich('expRate', { rate: pct(e.ratePct), base: money(e.base ?? '0'), n }));
        }
      } else if (e.ratePct !== undefined && e.base !== undefined) {
        steps.push(t.rich('expRate', { rate: pct(e.ratePct), base: money(e.base), n }));
      } else if (e.minPct !== undefined && e.type !== 'PER_UNIT') {
        steps.push(t.rich('expReached', { pct: pct(e.minPct), n }));
      }
  }
  steps.push(<Amount key="amount" value={e.gross} className="font-medium" />);

  return (
    <div className={cn('space-y-1.5 text-sm', className)}>
      <p className="text-xs text-muted-foreground">{metricLabel(e.metric, e.scope, labels)}</p>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 leading-relaxed">
        {steps.map((s, i) => (
          <Fragment key={i}>
            {i > 0 ? (
              <ArrowRight
                className="size-3.5 shrink-0 text-muted-foreground rtl-flip"
                aria-hidden
              />
            ) : null}
            <span>{s}</span>
          </Fragment>
        ))}
      </p>
      {e.gates.length > 0 ? (
        <ul className="space-y-1">
          {e.gates.map((g, i) => {
            const bound =
              g.min !== undefined && g.max !== undefined
                ? t('gateBetween', {
                    min: value(g.metric, g.min),
                    max: value(g.metric, g.max),
                  })
                : g.min !== undefined
                  ? t('gateMin', { min: value(g.metric, g.min) })
                  : t('gateMax', { max: value(g.metric, g.max ?? '0') });
            return (
              <li key={i} className="flex items-start gap-1.5">
                {g.passed ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                )}
                <span>
                  {t.rich('gateLine', {
                    metric: metricLabel(g.metric, g.scope, labels),
                    value: value(g.metric, g.value),
                    bound,
                    n,
                  })}{' '}
                  <span className={cn('font-medium', !g.passed && 'text-destructive')}>
                    {g.passed ? t('gatePassed') : t('gateFailed')}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {e.capped && e.cap ? (
        <p className="text-muted-foreground">{t.rich('expCapped', { cap: money(e.cap), n })}</p>
      ) : null}
      {e.outcome === 'GATE_FAILED' ? (
        <p className="font-medium text-destructive">{t('outcomeGATE_FAILED')}</p>
      ) : null}
    </div>
  );
}
