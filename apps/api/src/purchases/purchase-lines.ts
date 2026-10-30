import {
  computeTotals,
  type DocumentTotals,
  ErrorCode,
  type Money,
  type PurchaseLineInput,
  roundCost,
  toDzd,
} from '@erp/shared';
import { AppException } from '../common/app-exception';
import { type Tx } from '../prisma/prisma.service';
import { toBaseLines } from '../stock/unit-conversion';

export interface SnapshotLine {
  position: number;
  productId: string;
  unitId: string;
  designation: string;
  unitCode: string;
  unitName: string | null;
  factorToBase: string;
  tvaRate: string;
  qty: string;
  qtyBase: string;
  unitCost: string;
  lineHt: string;
  unitCostCurrency: string | null;
}

/** A foreign BR (phase 22): prices typed in `currency`, converted at `rate`. */
export interface ForeignPrices {
  currency: string;
  rate: string;
}

/**
 * Copies what the product is now (designation, unit, factor, TVA rate) onto the
 * lines and computes their HT. Called on every draft save and again at validation,
 * so the validated document freezes the product as it was that day.
 *
 * Totals always include TVA: the supplier charges it whatever our regime. Whether
 * we can recover it (assujetti) only changes the cost that enters the CUMP.
 */
export async function snapshotLines(
  tx: Tx,
  lines: PurchaseLineInput[],
  fx: ForeignPrices | null = null,
): Promise<{ lines: SnapshotLine[]; totals: DocumentTotals; totalCurrency: Money | null }> {
  const converted = await toBaseLines(tx, lines);
  const products = await tx.product.findMany({
    where: { id: { in: lines.map((l) => l.productId) } },
    include: { units: { where: { deletedAt: null }, include: { unit: true } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const snap = lines.map((l, i) => {
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
    return {
      position: i + 1,
      productId: l.productId,
      unitId: l.unitId,
      designation: product.designation,
      unitCode: unit.unit.code,
      unitName: unit.unit.name,
      factorToBase: unit.factorToBase.toString(),
      // A foreign supplier charges no Algerian TVA: import VAT is a cost of the dossier.
      tvaRate: fx ? '0' : product.tvaRate.toString(),
      qty: l.qty,
      qtyBase: converted[i]?.qtyBase ?? '0',
      // DZD per unit at the BR rate, 4 decimals like every cost; the typed price is kept.
      unitCost: fx ? roundCost(toDzd(l.unitCost, fx.rate)).toString() : l.unitCost,
      lineHt: '0',
      unitCostCurrency: fx ? l.unitCost : null,
    };
  });
  const totals = computeTotals(
    snap.map((s) => ({ qty: s.qty, unitPrice: s.unitCost, tvaRate: s.tvaRate })),
    true,
  );
  snap.forEach((s, i) => {
    s.lineHt = totals.lines[i]?.lineHt.toString() ?? '0';
  });
  const totalCurrency = fx
    ? computeTotals(
        snap.map((s) => ({ qty: s.qty, unitPrice: s.unitCostCurrency ?? '0', tvaRate: '0' })),
        true,
      ).totalTtc
    : null;
  return { lines: snap, totals, totalCurrency };
}
