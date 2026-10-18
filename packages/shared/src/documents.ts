/**
 * Document totals shared by purchases (BR), sales (BL, facture) and avoirs.
 * Line HT (after the line discount) is rounded to 2 decimals; TVA is computed per rate on the summed HT of
 * that rate (how Algerian factures present it: "TVA 19 % sur ...").
 */
import { type MoneyInput, money, type Money, round2 } from './money';

export interface TotalsLineInput {
  qty: MoneyInput;
  unitPrice: MoneyInput;
  /** Percent, e.g. "19". */
  tvaRate: MoneyInput;
  /** Line discount in percent (remise), applied before rounding the line. */
  discountPct?: MoneyInput;
}

export interface DocumentTotals {
  lines: { lineHt: Money }[];
  /** One row per distinct rate, ascending. Empty when the tenant is not assujetti. */
  tvaByRate: { rate: Money; baseHt: Money; tva: Money }[];
  totalHt: Money;
  totalTva: Money;
  totalTtc: Money;
}

export function computeTotals(lines: TotalsLineInput[], assujettiTva: boolean): DocumentTotals {
  const computed = lines.map((l) => ({
    lineHt: round2(
      money(l.qty)
        .times(money(l.unitPrice))
        .times(money(100).minus(money(l.discountPct ?? 0)))
        .div(100),
    ),
    rate: money(l.tvaRate),
  }));
  const totalHt = computed.reduce<Money>((acc, l) => acc.plus(l.lineHt), money(0));

  const byRate = new Map<string, { rate: Money; baseHt: Money }>();
  for (const l of computed) {
    const key = l.rate.toString();
    const entry = byRate.get(key) ?? { rate: l.rate, baseHt: money(0) };
    entry.baseHt = entry.baseHt.plus(l.lineHt);
    byRate.set(key, entry);
  }
  const tvaByRate = assujettiTva
    ? [...byRate.values()]
        .sort((a, b) => a.rate.comparedTo(b.rate))
        .map((r) => ({
          rate: r.rate,
          baseHt: r.baseHt,
          tva: round2(r.baseHt.times(r.rate).div(100)),
        }))
    : [];
  const totalTva = tvaByRate.reduce<Money>((acc, r) => acc.plus(r.tva), money(0));

  return {
    lines: computed.map((l) => ({ lineHt: l.lineHt })),
    tvaByRate,
    totalHt,
    totalTva,
    totalTtc: totalHt.plus(totalTva),
  };
}
