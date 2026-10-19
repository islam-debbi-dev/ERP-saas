import {
  type ImportFieldDef,
  type ImportMapping,
  isWholeQuantity,
  matchUnit,
  type ProductDto,
  qty,
  toBase,
  type UnitDto,
} from '@erp/shared';
import { baseUnitCost } from '../../stock/unit-conversion';
import type { ImportTable } from '../file-reader';
import type { ValidatedRow } from './products';
import { DuplicateTracker, RowReader } from './row-reader';

export interface OpeningStockLookups {
  units: UnitDto[];
  /** By reference, archived included. */
  products: Map<string, ProductDto>;
  /** Stock level per product id (absent = no stock yet). */
  levels: Map<string, { qtyBase: string; hasOpening: boolean }>;
}

export interface OpeningStockPlan {
  productId: string;
  qtyBase: string;
  /** Cost of one base unit. */
  unitCost: string;
}

/**
 * One opening line per product. Refused when the product already has an
 * opening (reported on the row), so importing the same file twice never
 * doubles the stock.
 */
export function validateOpeningStock(
  table: ImportTable,
  mapping: ImportMapping,
  fields: ImportFieldDef[],
  lookups: OpeningStockLookups,
): ValidatedRow<OpeningStockPlan>[] {
  const refs = new DuplicateTracker();
  return table.rows.map(({ rowNumber, cells }) => {
    const row = new RowReader(rowNumber, cells, mapping, fields);
    const reference = row.requiredText('reference', 40);
    let product: ProductDto | undefined;
    if (reference) {
      refs.check(row, 'reference', reference);
      product = lookups.products.get(reference);
      if (!product) row.error('reference', 'product_not_found');
      else if (product.archivedAt) row.error('reference', 'product_archived');
    }
    const level = product ? lookups.levels.get(product.id) : undefined;
    if (level?.hasOpening) row.error('reference', 'opening_already_set');
    else if (level && !qty(level.qtyBase).isZero()) {
      row.warn('reference', 'stock_not_empty', { qty: level.qtyBase });
    }

    const quantity = row.number('quantity', { decimals: 3, positive: true });
    if (quantity === '') row.error('quantity', 'required');
    const cost = row.number('unitCost', { decimals: 4 });
    if (cost === '') row.error('unitCost', 'required');
    else if (cost && qty(cost).isZero()) row.warn('unitCost', 'zero_cost');

    let unit = product?.units.find((u) => u.unitId === product?.baseUnitId);
    const unitText = row.text('unit');
    if (product && unitText !== '') {
      const unitId = matchUnit(unitText, lookups.units);
      unit = product.units.find((u) => u.unitId === unitId);
      if (!unitId) row.error('unit', 'unknown_unit', { value: unitText });
      else if (!unit) row.error('unit', 'unit_not_on_product', { value: unitText });
    }

    if (row.errors.length > 0 || !product || !unit || !quantity || !cost)
      return { row, plan: null };
    const base = lookups.units.find((u) => u.id === product.baseUnitId);
    const qtyBase = toBase(quantity, unit.factorToBase);
    if (base && !base.allowsDecimal && !isWholeQuantity(qtyBase)) {
      row.error('quantity', 'whole_quantity_required');
      return { row, plan: null };
    }
    return {
      row,
      plan: {
        productId: product.id,
        qtyBase: qtyBase.toString(),
        unitCost: baseUnitCost(cost, unit.factorToBase),
      },
    };
  });
}
