/**
 * Quantity helpers. Stock is always stored in the product's base unit as
 * Decimal(14,3) (AGENTS.md rule 4). Like money, quantities are never JS floats.
 */
import Decimal from 'decimal.js';
import { MoneyDecimal } from './money';

export type Qty = InstanceType<typeof MoneyDecimal>;
export type QtyInput = Decimal | string | number | bigint;

export const QTY_DECIMALS = 3;

export function qty(value: QtyInput): Qty {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new TypeError(`qty(): pass decimals as strings, got float ${value}`);
  }
  if (typeof value === 'bigint') return new MoneyDecimal(value.toString());
  if (value instanceof Decimal) return new MoneyDecimal(value.toString());
  return new MoneyDecimal(value);
}

export function round3(value: QtyInput): Qty {
  return qty(value).toDecimalPlaces(QTY_DECIMALS, MoneyDecimal.ROUND_HALF_UP);
}

/** Quantity typed in a packaging unit → base unit (e.g. 2 cartons × 24 = 48 pièces). */
export function toBase(quantity: QtyInput, factorToBase: QtyInput): Qty {
  return round3(qty(quantity).times(qty(factorToBase)));
}

/** Base-unit quantity → packaging unit (e.g. 48 pièces / 24 = 2 cartons). */
export function fromBase(quantityBase: QtyInput, factorToBase: QtyInput): Qty {
  const factor = qty(factorToBase);
  if (factor.lte(0)) throw new RangeError('factorToBase must be > 0');
  return round3(qty(quantityBase).div(factor));
}

export function isWholeQuantity(value: QtyInput): boolean {
  return qty(value).isInteger();
}

/** Canonical string for storage / JSON: rounded to 3 decimals, `.` separator. */
export function toQtyString(value: QtyInput): string {
  return round3(value).toFixed(QTY_DECIMALS);
}
