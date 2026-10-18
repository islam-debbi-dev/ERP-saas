import { computeTotals, type DocumentTotals, ErrorCode, type PurchaseLineInput } from '@erp/shared';
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
}

/**
 * Copies what the product is now (designation, unit, factor, TVA rate) onto the
 * lines and computes their HT. Called on every draft save and again at validation,
 * so the validated document freezes the product as it was that day.
 */
export async function snapshotLines(
  tx: Tx,
  lines: PurchaseLineInput[],
  assujettiTva: boolean,
): Promise<{ lines: SnapshotLine[]; totals: DocumentTotals }> {
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
      tvaRate: product.tvaRate.toString(),
      qty: l.qty,
      qtyBase: converted[i]?.qtyBase ?? '0',
      unitCost: l.unitCost,
      lineHt: '0',
    };
  });
  const totals = computeTotals(
    snap.map((s) => ({ qty: s.qty, unitPrice: s.unitCost, tvaRate: s.tvaRate })),
    assujettiTva,
  );
  snap.forEach((s, i) => {
    s.lineHt = totals.lines[i]?.lineHt.toString() ?? '0';
  });
  return { lines: snap, totals };
}
