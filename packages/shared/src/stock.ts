/**
 * Stock valuation helpers (CUMP = coût unitaire moyen pondéré, weighted average cost).
 * Costs carry 4 decimals: a pièce cost from "carton 1 100 DA / 24" is 45.8333 DA,
 * and rounding the average to 2 decimals on every entry would drift over time.
 */
import { type MoneyInput, money, type Money, MoneyDecimal, round2 } from './money';
import { qty, type Qty, type QtyInput } from './quantity';

export const COST_DECIMALS = 4;

export function roundCost(value: MoneyInput): Money {
  return money(value).toDecimalPlaces(COST_DECIMALS, MoneyDecimal.ROUND_HALF_UP);
}

/**
 * New average cost after an entry.
 * If the stock before the entry is zero or negative, the entry cost becomes the
 * average: the missing pieces were sold before they were bought, so mixing in the
 * old average would be meaningless. Exits never change the average.
 */
export function cump(
  oldQty: QtyInput,
  oldAvg: MoneyInput,
  inQty: QtyInput,
  inCost: MoneyInput,
): Money {
  const before = qty(oldQty);
  const entering = qty(inQty);
  if (entering.lte(0)) throw new RangeError('cump(): the entry quantity must be > 0');
  if (before.lte(0)) return roundCost(inCost);
  const total = before.times(money(oldAvg)).plus(entering.times(money(inCost)));
  return roundCost(total.div(before.plus(entering)));
}

/** Stock value at CUMP, 2 decimals. Negative stock is valued at 0. */
export function stockValue(qtyBase: QtyInput, avgCost: MoneyInput): Money {
  const q = qty(qtyBase);
  if (q.lte(0)) return money(0);
  return round2(q.times(money(avgCost)));
}

/**
 * "12 cartons + 5 pièces": whole packs and the remainder in the base unit.
 * The sign of the quantity is kept on both parts.
 */
export function splitPackaging(
  qtyBase: QtyInput,
  factorToBase: QtyInput,
): { packs: Qty; rest: Qty } {
  const factor = qty(factorToBase);
  if (factor.lte(0)) throw new RangeError('factorToBase must be > 0');
  const q = qty(qtyBase);
  const packs = q.abs().div(factor).floor();
  const rest = q.abs().minus(packs.times(factor));
  const sign = q.isNegative() ? -1 : 1;
  return { packs: packs.times(sign), rest: rest.times(sign) };
}
