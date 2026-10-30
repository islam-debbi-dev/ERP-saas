import {
  computeTotals,
  type DocumentTotals,
  ErrorCode,
  money,
  type SaleLineInput,
  toMoneyString,
} from '@erp/shared';
import { AppException } from '../common/app-exception';
import { type Tx } from '../prisma/prisma.service';
import { toBaseLines } from '../stock/unit-conversion';

export interface SaleSnapshotLine {
  position: number;
  productId: string;
  unitId: string;
  designation: string;
  unitCode: string;
  unitName: string | null;
  factorToBase: string;
  qty: string;
  qtyBase: string;
  listPriceHt: string | null;
  unitPriceHt: string;
  discountPct: string;
  tvaRate: string;
  lineHt: string;
  /** Phase 20: a free line (UG) of a promotion, priced 0, after its paid line. */
  isFree: boolean;
  promotionId: string | null;
  promotionName: string | null;
  freeOfPosition: number | null;
}

/** The promotion fields of a stored line, carried when lines are snapshotted again. */
export type PromotionFields = Pick<
  SaleSnapshotLine,
  'isFree' | 'promotionId' | 'promotionName' | 'freeOfPosition'
>;

export const NO_PROMOTION: PromotionFields = {
  isFree: false,
  promotionId: null,
  promotionName: null,
  freeOfPosition: null,
};

/** A line whose price differs from the client's level (or carries a remise). */
export interface PriceOverride {
  position: number;
  productId: string;
  listPriceHt: string | null;
  unitPriceHt: string;
  discountPct: string;
  /** The unit price itself differs from the list price (PRICE_OVERRIDE). */
  priceChanged: boolean;
}

/** The client's price level, or the first level of the tenant (gros). */
export async function resolvePriceLevel(tx: Tx, clientId: string | null): Promise<string | null> {
  if (clientId) {
    const client = await tx.client.findUnique({
      where: { id: clientId },
      select: { priceLevelId: true },
    });
    if (client?.priceLevelId) return client.priceLevelId;
  }
  const first = await tx.priceLevel.findFirst({
    orderBy: { position: 'asc' },
    select: { id: true },
  });
  return first?.id ?? null;
}

/**
 * Copies the product as it is now (designation, unit, factor, TVA) onto the lines
 * and resolves the price of `priceLevelId`. An omitted price means the list price;
 * no list price and no typed price is PRICE_MISSING. Returns the overrides so the
 * caller can check the permission and audit them.
 */
export async function snapshotSaleLines(
  tx: Tx,
  lines: SaleLineInput[],
  priceLevelId: string | null,
  assujettiTva: boolean,
): Promise<{ lines: SaleSnapshotLine[]; totals: DocumentTotals; overrides: PriceOverride[] }> {
  const converted = await toBaseLines(tx, lines);
  const products = await tx.product.findMany({
    where: { id: { in: lines.map((l) => l.productId) } },
    include: {
      units: {
        where: { deletedAt: null },
        include: {
          unit: true,
          prices: priceLevelId ? { where: { priceLevelId } } : { take: 0 },
        },
      },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const overrides: PriceOverride[] = [];

  const snap = lines.map((l, i): SaleSnapshotLine => {
    const product = byId.get(l.productId);
    if (!product) throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
    if (product.deletedAt) {
      throw new AppException(ErrorCode.PRODUCT_ARCHIVED, 'Archived product', {
        productId: product.id,
      });
    }
    const unit = product.units.find((u) => u.unitId === l.unitId);
    if (!unit) {
      throw new AppException(ErrorCode.INVALID_PRODUCT_UNITS, 'Unit not defined for this product', {
        rule: 'unit_not_on_product',
        productId: l.productId,
      });
    }
    const listPrice = unit.prices[0]?.priceHt.toString() ?? null;
    const price = l.unitPriceHt ?? listPrice;
    if (price === null) {
      throw new AppException(ErrorCode.PRICE_MISSING, 'No price for this unit at this level', {
        productId: l.productId,
        unitId: l.unitId,
        priceLevelId,
      });
    }
    const discount = money(l.discountPct);
    const priceChanged = listPrice === null || !money(price).eq(listPrice);
    if (priceChanged || !discount.isZero()) {
      overrides.push({
        position: i + 1,
        productId: l.productId,
        listPriceHt: listPrice === null ? null : toMoneyString(listPrice),
        unitPriceHt: toMoneyString(price),
        discountPct: discount.toString(),
        priceChanged,
      });
    }
    return {
      position: i + 1,
      productId: l.productId,
      unitId: l.unitId,
      designation: product.designation,
      unitCode: unit.unit.code,
      unitName: unit.unit.name,
      factorToBase: unit.factorToBase.toString(),
      qty: l.qty,
      qtyBase: converted[i]?.qtyBase ?? '0',
      listPriceHt: listPrice,
      unitPriceHt: money(price).toString(),
      discountPct: discount.toString(),
      tvaRate: product.tvaRate.toString(),
      lineHt: '0',
      ...NO_PROMOTION,
    };
  });
  const totals = totalLines(snap, assujettiTva);
  return { lines: snap, totals, overrides };
}

/** Recomputes each line's HT and the document totals (after a remise changed). */
export function totalLines(lines: SaleSnapshotLine[], assujettiTva: boolean): DocumentTotals {
  const totals = computeTotals(
    lines.map((s) => ({
      qty: s.qty,
      unitPrice: s.unitPriceHt,
      tvaRate: s.tvaRate,
      discountPct: s.discountPct,
    })),
    assujettiTva,
  );
  lines.forEach((s, i) => {
    s.lineHt = totals.lines[i]?.lineHt.toString() ?? '0';
  });
  return totals;
}

/**
 * Copies stored promotion fields onto re-snapshotted lines (same order, same positions),
 * so validating a draft or delivering an order keeps what was decided when it was priced.
 */
export function carryPromotions(
  lines: SaleSnapshotLine[],
  stored: readonly PromotionFields[],
): SaleSnapshotLine[] {
  return lines.map((l, i) => {
    const p = stored[i] ?? NO_PROMOTION;
    return {
      ...l,
      isFree: p.isFree,
      promotionId: p.promotionId,
      promotionName: p.promotionName,
      freeOfPosition: p.freeOfPosition,
    };
  });
}
