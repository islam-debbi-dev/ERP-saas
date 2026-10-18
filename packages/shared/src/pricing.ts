import { type MoneyInput, mul, round2, type Money, money } from './money';

/**
 * Price including TVA, rounded to 2 decimals. When the tenant is not subject to
 * TVA (IFU regime), the price charged is the HT price.
 */
export function priceTtc(
  priceHt: MoneyInput,
  tvaRatePercent: MoneyInput,
  assujettiTva: boolean,
): Money {
  if (!assujettiTva) return round2(priceHt);
  return round2(money(priceHt).times(money(tvaRatePercent).div(100).plus(1)));
}

/**
 * Starting suggestion for a packaging price (carton = 24 × pièce price). Only a
 * suggestion: grossistes often give a better price per carton.
 */
export function suggestedPackagingPrice(basePriceHt: MoneyInput, factorToBase: MoneyInput): Money {
  return round2(mul(basePriceHt, factorToBase));
}
