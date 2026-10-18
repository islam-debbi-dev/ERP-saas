import { ErrorCode, isWholeQuantity, qty, roundCost, toBase } from '@erp/shared';
import { AppException } from '../common/app-exception';
import { type Tx } from '../prisma/prisma.service';

export interface ConvertedLine {
  productId: string;
  qtyBase: string;
  /** Factor of the unit the user typed in (cost conversion). */
  factorToBase: string;
}

/**
 * Converts `{ productId, unitId, qty }` lines to base-unit quantities using the
 * product's live units. Counted products (pièce) refuse fractional results.
 */
export async function toBaseLines(
  tx: Tx,
  lines: { productId: string; unitId: string; qty: string }[],
): Promise<ConvertedLine[]> {
  const units = await tx.productUnit.findMany({
    where: {
      productId: { in: lines.map((l) => l.productId) },
      deletedAt: null,
    },
    select: {
      productId: true,
      unitId: true,
      factorToBase: true,
      product: { select: { baseUnit: { select: { allowsDecimal: true } } } },
    },
  });
  const byKey = new Map(units.map((u) => [`${u.productId}:${u.unitId}`, u]));
  return lines.map((l) => {
    const unit = byKey.get(`${l.productId}:${l.unitId}`);
    if (!unit) {
      throw new AppException(ErrorCode.INVALID_PRODUCT_UNITS, 'Unit not defined for this product', {
        rule: 'unit_not_on_product',
        productId: l.productId,
      });
    }
    const qtyBase = toBase(l.qty, unit.factorToBase.toString());
    if (!unit.product.baseUnit.allowsDecimal && !isWholeQuantity(qtyBase)) {
      throw new AppException(
        ErrorCode.INVALID_PRODUCT_UNITS,
        'This product is counted in whole units',
        {
          rule: 'whole_quantity_required',
          productId: l.productId,
        },
      );
    }
    return {
      productId: l.productId,
      qtyBase: qtyBase.toString(),
      factorToBase: unit.factorToBase.toString(),
    };
  });
}

/** Cost of one base unit from the cost of one typed unit (carton 1 100 / 24 = 45.8333). */
export function baseUnitCost(unitCost: string, factorToBase: string): string {
  return roundCost(qty(unitCost).div(qty(factorToBase))).toString();
}
