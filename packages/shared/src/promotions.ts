/**
 * Promotions (phase 20, module PROMOTIONS): which promotion a sale line gets and how many
 * free units (UG) it gives. Pure functions: the API loads the promotions and calls them
 * when it prices a sale or an order; the web only shows the API's answer.
 *
 * Rules (docs/domain.md "Promotions & emballages"):
 * - at most one promotion per line; the highest priority wins, a tie goes to the best for
 *   the client (benefit at the client's list price), then to the oldest promotion;
 * - a line is judged alone (two lines of the same product are not added up);
 * - free lines are never the target of a promotion.
 */
import { money, type Money, MoneyDecimal, type MoneyInput } from './money';
import { qty, type Qty, type QtyInput, round3 } from './quantity';

export const PromotionType = {
  /** Buy N of X, get M of X or of Y free ("10+1"). */
  FREE_UNITS: 'FREE_UNITS',
  /** A remise in percent on products, a brand or a category. */
  PERCENT_DISCOUNT: 'PERCENT_DISCOUNT',
} as const;
export type PromotionType = (typeof PromotionType)[keyof typeof PromotionType];
export const PROMOTION_TYPES = Object.values(PromotionType);

export const PromotionClientScope = {
  ALL: 'ALL',
  PRICE_LEVEL: 'PRICE_LEVEL',
  SECTOR: 'SECTOR',
  CLIENTS: 'CLIENTS',
} as const;
export type PromotionClientScope = (typeof PromotionClientScope)[keyof typeof PromotionClientScope];
export const PROMOTION_CLIENT_SCOPES = Object.values(PromotionClientScope);

export const PromotionTarget = {
  PRODUCTS: 'PRODUCTS',
  BRAND: 'BRAND',
  CATEGORY: 'CATEGORY',
} as const;
export type PromotionTarget = (typeof PromotionTarget)[keyof typeof PromotionTarget];
export const PROMOTION_TARGETS = Object.values(PromotionTarget);

/** A promotion as the engine needs it; quantities already in base units where it matters. */
export interface PromotionRule {
  id: string;
  name: string;
  type: PromotionType;
  priority: number;
  /** ISO instant: the oldest wins the last tie. */
  createdAt: string;
  /** Algiers days `YYYY-MM-DD`, both included. */
  validFrom: string;
  validTo: string;
  active: boolean;
  clientScope: PromotionClientScope;
  priceLevelId: string | null;
  sectorId: string | null;
  clientIds: readonly string[];
  // FREE_UNITS
  buyProductId: string | null;
  /** `buyQty` of the promotion converted to the buy product's base unit. */
  buyQtyBase: string | null;
  freeProductId: string | null;
  freeUnitId: string | null;
  /** In `freeUnitId`. */
  freeQty: string | null;
  repeatable: boolean;
  // PERCENT_DISCOUNT
  target: PromotionTarget | null;
  productIds: readonly string[];
  brandId: string | null;
  /** The category and all its sub-categories (the API expands the tree). */
  categoryIds: readonly string[];
  discountPct: string | null;
  minQtyBase: string | null;
}

export interface PromotionLine {
  productId: string;
  brandId: string | null;
  categoryId: string | null;
  qtyBase: QtyInput;
  /** Quantity × unit price, before any remise: what a percent is taken on. */
  grossHt: MoneyInput;
}

export interface PromotionContext {
  /** The Algiers day the lines are priced. */
  day: string;
  clientId: string | null;
  priceLevelId: string | null;
  sectorId: string | null;
  /** List price HT of one free unit at the client's level, by promotion id (benefit of a tie). */
  freeUnitPriceHt?: Readonly<Record<string, string | null>>;
}

export interface AppliedPromotion {
  rule: PromotionRule;
  /** FREE_UNITS: free quantity in `rule.freeUnitId`. */
  freeQty: Qty | null;
  /** PERCENT_DISCOUNT: the remise of the line. */
  discountPct: string | null;
  /** What the client gains, HT, used to break a tie. */
  benefit: Money;
}

export function isPromotionLive(rule: PromotionRule, day: string): boolean {
  return rule.active && rule.validFrom <= day && day <= rule.validTo;
}

export function promotionCoversClient(rule: PromotionRule, ctx: PromotionContext): boolean {
  switch (rule.clientScope) {
    case PromotionClientScope.ALL:
      return true;
    case PromotionClientScope.PRICE_LEVEL:
      return rule.priceLevelId !== null && rule.priceLevelId === ctx.priceLevelId;
    case PromotionClientScope.SECTOR:
      return rule.sectorId !== null && rule.sectorId === ctx.sectorId;
    case PromotionClientScope.CLIENTS:
      return ctx.clientId !== null && rule.clientIds.includes(ctx.clientId);
  }
}

/** Free quantity (in the free unit) for `qtyBase` bought: 10+1 repeatable on 25 gives 2. */
export function freeQtyFor(rule: PromotionRule, qtyBase: QtyInput): Qty {
  if (!rule.buyQtyBase || !rule.freeQty) return qty(0);
  const buy = qty(rule.buyQtyBase);
  if (buy.lte(0)) return qty(0);
  const bought = qty(qtyBase);
  if (bought.lt(buy)) return qty(0);
  const times = rule.repeatable ? bought.div(buy).floor() : qty(1);
  return round3(times.times(rule.freeQty));
}

/** What `rule` gives on `line`, or null when it does not apply to it. */
export function evaluatePromotion(
  rule: PromotionRule,
  line: PromotionLine,
  ctx: PromotionContext,
): AppliedPromotion | null {
  if (!isPromotionLive(rule, ctx.day) || !promotionCoversClient(rule, ctx)) return null;
  if (rule.type === PromotionType.FREE_UNITS) {
    if (rule.buyProductId !== line.productId) return null;
    const free = freeQtyFor(rule, line.qtyBase);
    if (free.lte(0)) return null;
    const price = ctx.freeUnitPriceHt?.[rule.id] ?? null;
    return {
      rule,
      freeQty: free,
      discountPct: null,
      benefit: price === null ? money(0) : money(price).times(free),
    };
  }
  if (!rule.discountPct || money(rule.discountPct).lte(0)) return null;
  const targeted =
    (rule.target === PromotionTarget.PRODUCTS && rule.productIds.includes(line.productId)) ||
    (rule.target === PromotionTarget.BRAND &&
      rule.brandId !== null &&
      rule.brandId === line.brandId) ||
    (rule.target === PromotionTarget.CATEGORY &&
      line.categoryId !== null &&
      rule.categoryIds.includes(line.categoryId));
  if (!targeted) return null;
  if (rule.minQtyBase && qty(line.qtyBase).lt(rule.minQtyBase)) return null;
  return {
    rule,
    freeQty: null,
    discountPct: money(rule.discountPct).toString(),
    benefit: money(line.grossHt).times(rule.discountPct).div(100),
  };
}

/** Highest priority, then best for the client, then the oldest promotion, then by id. */
export function comparePromotions(a: AppliedPromotion, b: AppliedPromotion): number {
  if (a.rule.priority !== b.rule.priority) return b.rule.priority - a.rule.priority;
  const benefit = b.benefit.comparedTo(a.benefit);
  if (benefit !== 0) return benefit;
  if (a.rule.createdAt !== b.rule.createdAt) return a.rule.createdAt < b.rule.createdAt ? -1 : 1;
  return a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0;
}

/** The promotion a line gets, or null. */
export function pickPromotion(
  rules: readonly PromotionRule[],
  line: PromotionLine,
  ctx: PromotionContext,
): AppliedPromotion | null {
  const candidates = rules
    .map((r) => evaluatePromotion(r, line, ctx))
    .filter((c): c is AppliedPromotion => c !== null)
    .sort(comparePromotions);
  return candidates[0] ?? null;
}

/** One result per line, same order. */
export function applyPromotions(
  rules: readonly PromotionRule[],
  lines: readonly PromotionLine[],
  ctx: PromotionContext,
): (AppliedPromotion | null)[] {
  return lines.map((l) => pickPromotion(rules, l, ctx));
}

/**
 * The part of `freeTotal` that goes with `paidPart` of `paidTotal`, in proportion, rounded
 * half-up (to whole units when `wholeUnits`, else to 0.001). All of it when `paidPart`
 * reaches `paidTotal`. Used for the free units of a partial delivery or of a return.
 */
export function proportionalFree(
  freeTotal: QtyInput,
  paidTotal: QtyInput,
  paidPart: QtyInput,
  wholeUnits: boolean,
): Qty {
  const total = qty(paidTotal);
  const part = qty(paidPart);
  if (total.lte(0) || part.lte(0)) return qty(0);
  if (part.gte(total)) return qty(freeTotal);
  const exact = qty(freeTotal).times(part).div(total);
  return wholeUnits ? exact.toDecimalPlaces(0, MoneyDecimal.ROUND_HALF_UP) : round3(exact);
}

/**
 * Free units to bring back with a return (avoir). Counted on the cumulative returns so
 * several small returns end where one big return would: after this return the client has
 * given back `proportionalFree(freeSold, paidSold, paidReturnedAfter)` free units in total.
 */
export function freeToReturn(input: {
  freeSold: QtyInput;
  paidSold: QtyInput;
  /** Paid quantity returned so far, this return included (same unit as `paidSold`). */
  paidReturnedAfter: QtyInput;
  /** Free quantity already brought back by earlier returns. */
  freeReturnedBefore: QtyInput;
  wholeUnits: boolean;
}): Qty {
  const due = proportionalFree(
    input.freeSold,
    input.paidSold,
    input.paidReturnedAfter,
    input.wholeUnits,
  );
  const left = qty(input.freeSold).minus(input.freeReturnedBefore);
  const now = due.minus(input.freeReturnedBefore);
  if (now.lte(0)) return qty(0);
  return now.gt(left) ? left : now;
}
