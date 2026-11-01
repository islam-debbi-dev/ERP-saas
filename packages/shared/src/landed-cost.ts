/**
 * Importateur (phase 22): currencies, dossier d'importation enums and the coût de revient
 * math. Pure functions, no I/O: the API calls them inside its transactions and the web
 * may call them for display (the API recomputes, AGENTS.md §4).
 */
import { money, type Money, type MoneyInput, round2, sum } from './money';
import { qty, type QtyInput } from './quantity';
import { cumpAfterValue, roundCost } from './stock';

export const Currency = {
  DZD: 'DZD',
  USD: 'USD',
  EUR: 'EUR',
  CNY: 'CNY',
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];
/** Extend here: the DB stores a 3-letter code, nothing else needs to change. */
export const CURRENCIES = Object.values(Currency);

export const ImportFileStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type ImportFileStatus = (typeof ImportFileStatus)[keyof typeof ImportFileStatus];

export const ImportCostType = {
  FRET: 'FRET',
  DOUANE: 'DOUANE',
  /** TVA à l'importation: in the cost only for non-assujetti tenants. */
  TVA_IMPORT: 'TVA_IMPORT',
  TRANSITAIRE: 'TRANSITAIRE',
  MAGASINAGE: 'MAGASINAGE',
  TRANSPORT: 'TRANSPORT',
  ASSURANCE: 'ASSURANCE',
  AUTRE: 'AUTRE',
} as const;
export type ImportCostType = (typeof ImportCostType)[keyof typeof ImportCostType];
export const IMPORT_COST_TYPES = Object.values(ImportCostType);

export const AllocationMethod = {
  VALUE: 'VALUE',
  QUANTITY: 'QUANTITY',
  WEIGHT: 'WEIGHT',
  VOLUME: 'VOLUME',
  MANUAL: 'MANUAL',
} as const;
export type AllocationMethod = (typeof AllocationMethod)[keyof typeof AllocationMethod];
export const ALLOCATION_METHODS = Object.values(AllocationMethod);

/** DZD for an amount in another currency at the bank rate (DZD per 1 unit). Not rounded. */
export function toDzd(amountCurrency: MoneyInput, exchangeRate: MoneyInput): Money {
  return money(amountCurrency).times(money(exchangeRate));
}

/** Why an allocation is impossible; the API turns it into an AppException with this code. */
export class AllocationError extends Error {
  constructor(
    readonly code: 'ALLOCATION_BASIS_MISSING' | 'MANUAL_SPLIT_INVALID',
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/**
 * Splits `amount` over entries in proportion to their basis. Each share is rounded to
 * 2 decimals; the rounding remainder goes to the entry with the largest basis (the first
 * one on a tie), so the shares always sum to `amount` exactly.
 */
export function prorate(
  amount: MoneyInput,
  entries: readonly { key: string; basis: MoneyInput }[],
): Map<string, Money> {
  const total = sum(entries.map((e) => e.basis));
  if (entries.length === 0 || total.lte(0)) {
    throw new AllocationError('ALLOCATION_BASIS_MISSING', { reason: 'zero_basis' });
  }
  const value = money(amount);
  const out = new Map<string, Money>();
  let largest = entries[0]!;
  for (const e of entries) {
    if (money(e.basis).gt(money(largest.basis))) largest = e;
    out.set(e.key, round2(value.times(money(e.basis)).div(total)));
  }
  const remainder = value.minus(sum([...out.values()]));
  out.set(largest.key, (out.get(largest.key) ?? money(0)).plus(remainder));
  return out;
}

export interface AllocationLine {
  /** Purchase line id. */
  key: string;
  productId: string;
  /** The line's value in DZD (FOB × rate), the VALUE basis. */
  value: MoneyInput;
  qtyBase: QtyInput;
  /** Per base unit, from the product; null when not filled in. */
  weightKg?: string | null;
  volumeM3?: string | null;
}

function basisOf(line: AllocationLine, method: AllocationMethod): Money | null {
  switch (method) {
    case AllocationMethod.VALUE:
      return money(line.value);
    case AllocationMethod.QUANTITY:
      return qty(line.qtyBase);
    case AllocationMethod.WEIGHT:
      return line.weightKg ? qty(line.qtyBase).times(qty(line.weightKg)) : null;
    case AllocationMethod.VOLUME:
      return line.volumeM3 ? qty(line.qtyBase).times(qty(line.volumeM3)) : null;
    default:
      return null;
  }
}

/**
 * The share of one cost on each line, by its method. WEIGHT / VOLUME need the field on
 * every product (`ALLOCATION_BASIS_MISSING` names those without). MANUAL takes the split
 * typed by the user ({ lineKey: amount }), which must cover known lines and sum exactly.
 */
export function allocate(
  lines: readonly AllocationLine[],
  amount: MoneyInput,
  method: AllocationMethod,
  manualSplit?: Readonly<Record<string, string>> | null,
): Map<string, Money> {
  if (method === AllocationMethod.MANUAL) {
    const split = manualSplit ?? {};
    const known = new Set(lines.map((l) => l.key));
    const unknown = Object.keys(split).filter((k) => !known.has(k));
    const total = sum(Object.values(split));
    if (unknown.length > 0 || !total.eq(money(amount))) {
      throw new AllocationError('MANUAL_SPLIT_INVALID', {
        unknown,
        expected: round2(amount).toFixed(2),
        got: round2(total).toFixed(2),
      });
    }
    return new Map(lines.map((l) => [l.key, money(split[l.key] ?? '0')]));
  }
  const missing = new Set<string>();
  const entries = lines.map((l) => {
    const basis = basisOf(l, method);
    if (basis === null) missing.add(l.productId);
    return { key: l.key, basis: basis ?? money(0) };
  });
  if (missing.size > 0) {
    throw new AllocationError('ALLOCATION_BASIS_MISSING', { method, productIds: [...missing] });
  }
  return prorate(amount, entries);
}

/**
 * The part of a cost line that enters the coût de revient. TVA (import VAT, TVA on a
 * transitaire invoice) is recoverable for an assujetti tenant, so it stays out of the cost;
 * under IFU it cannot be recovered and is part of the cost.
 */
export function allocatedAmount(
  amount: MoneyInput,
  tvaAmount: MoneyInput,
  assujettiTva: boolean,
): Money {
  return assujettiTva ? money(amount).minus(money(tvaAmount)) : money(amount);
}

/** Coût de revient of one base unit: (line value + its cost shares) / quantity, rounded once. */
export function landedUnitCost(
  lineValue: MoneyInput,
  allocated: readonly MoneyInput[],
  qtyBase: QtyInput,
): Money {
  const q = qty(qtyBase);
  if (q.lte(0)) throw new RangeError('landedUnitCost(): quantity must be > 0');
  return roundCost(money(lineValue).plus(sum(allocated)).div(q));
}

export interface LateCostSpread {
  /** Added to the stock value (COST_ADJUST valueDelta). */
  stockValue: Money;
  /** The part for units already sold: écart de coût, past sales stay as they are. */
  ecart: Money;
  /** CUMP after the adjustment. */
  newAvg: Money;
}

/**
 * A late cost `value` for a product the dossier brought `received` units of, while the
 * company holds `onHand` now at CUMP `avg`. The units still on hand (at most what was
 * received) take their share into the CUMP; the rest is the écart. No stock: all écart.
 */
export function spreadLateCost(
  value: MoneyInput,
  onHand: QtyInput,
  received: QtyInput,
  avg: MoneyInput,
): LateCostSpread {
  const v = money(value);
  const q = qty(onHand);
  const r = qty(received);
  if (q.lte(0) || r.lte(0)) return { stockValue: money(0), ecart: v, newAvg: roundCost(avg) };
  const covered = q.lt(r) ? q : r;
  const stockValue = round2(v.times(covered).div(r));
  const newAvg = cumpAfterValue(q, avg, stockValue);
  return { stockValue, ecart: v.minus(stockValue), newAvg };
}
