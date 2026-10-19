/**
 * Timbre fiscal on factures paid in cash. The rates and limits are set by the
 * loi de finances and change: they live in the tenant settings, never here.
 *
 * Rule (docs/domain.md, phase 8 decisions):
 * - only a facture whose payment mode is cash (espèces);
 * - nothing when the TTC is below `threshold`;
 * - the whole TTC is taxed at the rate of the tranche it falls in
 *   (first tranche whose `upTo` is null or >= TTC);
 * - rounded half-up to the centime, then raised to `min` / capped at `max`.
 */
import { PaymentMode, SaleType } from './enums';
import { money, type Money, type MoneyInput, round2, ZERO } from './money';

export interface TimbreTranche {
  /** Upper bound of the tranche (inclusive), null = no upper bound. */
  upTo: string | null;
  /** Rate in percent, e.g. "1" for 1 %. */
  rate: string;
}

export interface TimbreRule {
  enabled: boolean;
  threshold: string | null;
  tranches: readonly TimbreTranche[];
  min: string | null;
  max: string | null;
}

export interface TimbreInput {
  ttc: MoneyInput;
  saleType: string;
  paymentMode: string | null;
  rule: TimbreRule;
}

export function computeTimbre({ ttc, saleType, paymentMode, rule }: TimbreInput): Money {
  const base = money(ttc);
  if (!rule.enabled || saleType !== SaleType.FACTURE || paymentMode !== PaymentMode.ESPECES) {
    return ZERO;
  }
  if (base.lte(0) || rule.tranches.length === 0) return ZERO;
  if (rule.threshold !== null && base.lt(rule.threshold)) return ZERO;

  const tranche =
    rule.tranches.find((t) => t.upTo === null || base.lte(t.upTo)) ??
    rule.tranches[rule.tranches.length - 1];
  if (!tranche) return ZERO;

  let timbre = round2(base.times(tranche.rate).dividedBy(100));
  if (rule.min !== null && timbre.lt(rule.min)) timbre = money(rule.min);
  if (rule.max !== null && timbre.gt(rule.max)) timbre = money(rule.max);
  return timbre;
}
