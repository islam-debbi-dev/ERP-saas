import {
  type CreateProductInput,
  createProductSchema,
  type ImportFieldDef,
  type ImportMapping,
  isWholeQuantity,
  matchUnit,
  qty,
  type ProductDto,
  type ProductPriceInput,
  type ProductUnitInput,
  type UpdateProductInput,
  updateProductSchema,
} from '@erp/shared';
import type { CatalogLookups } from '../../catalog/catalog.service';
import type { Cell, ImportTable } from '../file-reader';
import { BARCODE_PATTERN, cellText, DuplicateTracker, RowReader } from './row-reader';

export interface ProductLookups {
  catalog: CatalogLookups;
  /** By reference, archived included. */
  existing: Map<string, ProductDto>;
  /** Barcode → product id, for barcodes already used in the catalog. */
  usedBarcodes: Map<string, string>;
}

export type ProductPlan =
  | { kind: 'CREATE'; input: CreateProductInput; categoryName: string | null }
  | { kind: 'UPDATE'; id: string; input: UpdateProductInput | null; categoryName: string | null };

export interface ValidatedRow<P> {
  row: RowReader;
  plan: P | null;
}

const PACKS = [
  { unit: 'pack1Unit', factor: 'pack1Factor', barcode: 'pack1Barcode', price: 'pack1Price' },
  { unit: 'pack2Unit', factor: 'pack2Factor', barcode: 'pack2Barcode', price: 'pack2Price' },
] as const;

/** Every reference, barcode and category name the file mentions (to load lookups in bulk). */
export function productKeys(table: ImportTable, mapping: ImportMapping) {
  const at = (key: string, cells: Cell[]) => {
    const i = mapping[key];
    return i === null || i === undefined ? '' : cellText(cells[i]);
  };
  const references = new Set<string>();
  const barcodes = new Set<string>();
  for (const { cells } of table.rows) {
    const ref = at('reference', cells);
    if (ref) references.add(ref);
    for (const key of ['barcode', 'pack1Barcode', 'pack2Barcode']) {
      const code = at(key, cells);
      if (code) barcodes.add(code);
    }
  }
  return { references: [...references], barcodes: [...barcodes] };
}

/**
 * Checks each product row against the catalog and builds what confirm will write:
 * a new product, or the existing one merged with the non-empty cells (a blank
 * cell keeps the current value). Never touches stock.
 */
export function validateProducts(
  table: ImportTable,
  mapping: ImportMapping,
  fields: ImportFieldDef[],
  lookups: ProductLookups,
): ValidatedRow<ProductPlan>[] {
  const refs = new DuplicateTracker();
  const barcodesInFile = new Map<string, { rowNumber: number; reference: string }>();
  const categories = new Map(lookups.catalog.categories.map((c) => [c.name.toLowerCase(), c.id]));
  const unitById = new Map(lookups.catalog.units.map((u) => [u.id, u]));
  const levels = lookups.catalog.priceLevels;

  return table.rows.map(({ rowNumber, cells }) => {
    const row = new RowReader(rowNumber, cells, mapping, fields);
    const reference = row.requiredText('reference', 40);
    if (reference) refs.check(row, 'reference', reference);
    const existing = reference ? lookups.existing.get(reference) : undefined;
    if (existing?.archivedAt) row.error('reference', 'product_archived');

    const designation = existing
      ? row.optionalText('designation', 160)
      : row.requiredText('designation', 160);

    // Units -----------------------------------------------------------------
    const unitOf = (key: string, required: boolean): string | null | undefined => {
      const text = row.text(key);
      if (text === '') {
        if (required) row.error(key, 'required');
        return undefined;
      }
      const id = matchUnit(text, lookups.catalog.units);
      if (!id) row.error(key, 'unknown_unit', { value: text });
      return id;
    };
    const baseUnitId = unitOf('baseUnit', !existing);
    if (existing && baseUnitId && baseUnitId !== existing.baseUnitId) {
      row.error('baseUnit', 'base_unit_immutable');
    }
    const effectiveBaseId = existing?.baseUnitId ?? baseUnitId ?? null;
    const counted = effectiveBaseId ? !unitById.get(effectiveBaseId)?.allowsDecimal : false;

    const barcode = (key: string): string | null => {
      const code = row.text(key);
      if (code === '') return null;
      if (code.length > 64 || !BARCODE_PATTERN.test(code)) {
        row.error(key, 'invalid_barcode');
        return null;
      }
      const usedBy = lookups.usedBarcodes.get(code);
      if (usedBy && usedBy !== existing?.id) row.error(key, 'barcode_used');
      const first = barcodesInFile.get(code);
      if (first && first.reference !== reference) {
        row.error(key, 'duplicate_in_file', { row: String(first.rowNumber) });
      } else if (!first) barcodesInFile.set(code, { rowNumber, reference: reference ?? '' });
      return code;
    };
    const baseBarcode = barcode('barcode');

    const packs = PACKS.map((p, index) => {
      const unitText = row.text(p.unit);
      const factor = row.number(p.factor, { decimals: 3, positive: true });
      const code = barcode(p.barcode);
      const unitId = unitOf(p.unit, false);
      const current = unitId ? existing?.units.find((u) => u.unitId === unitId) : undefined;
      if (unitText === '' && (factor || code)) row.error(p.unit, 'required');
      if (unitId && factor === '' && !current) row.error(p.factor, 'required');
      if (unitId && unitId === effectiveBaseId) row.error(p.unit, 'pack_is_base_unit');
      if (counted && factor && !isWholeQuantity(factor))
        row.error(p.factor, 'whole_factor_required');
      return { index, unitId: unitId ?? null, factor, barcode: code, price: p.price };
    });
    if (packs[0]?.unitId && packs[0].unitId === packs[1]?.unitId) {
      row.error('pack2Unit', 'duplicate_unit');
    }

    // Numbers ---------------------------------------------------------------
    const tvaRate = row.number('tvaRate', { decimals: 2, max: '100' });
    const minStock = row.number('minStock', { decimals: 3 });
    if (counted && minStock && !isWholeQuantity(minStock)) {
      row.error('minStock', 'whole_quantity_required');
    }

    const prices: { slot: number; priceLevelId: string; priceHt: string }[] = [];
    for (const level of levels) {
      const base = row.number(`price.${level.position}`, { decimals: 2 });
      if (base) prices.push({ slot: -1, priceLevelId: level.id, priceHt: base });
      for (const pack of packs) {
        const key = `${pack.price}.${level.position}`;
        const value = row.number(key, { decimals: 2 });
        if (!value) continue;
        if (!pack.unitId) row.error(key, 'price_without_pack');
        else prices.push({ slot: pack.index, priceLevelId: level.id, priceHt: value });
      }
    }

    const categoryText = row.optionalText('category', 80) ?? '';
    let categoryName: string | null = null;
    let categoryId: string | null | undefined;
    if (categoryText !== '') {
      categoryId = categories.get(categoryText.toLowerCase());
      if (!categoryId) {
        categoryName = categoryText;
        row.warn('category', 'category_created', { name: categoryText });
      }
    }

    if (row.errors.length > 0 || !reference) return { row, plan: null };

    // Build the input -------------------------------------------------------
    const unitIdOfSlot = (slot: number) =>
      slot === -1 ? (effectiveBaseId ?? '') : (packs[slot]?.unitId ?? '');
    const priceInputs: ProductPriceInput[] = prices.map((p) => ({
      unitId: unitIdOfSlot(p.slot),
      priceLevelId: p.priceLevelId,
      priceHt: p.priceHt,
    }));

    if (!existing) {
      if (tvaRate === '') row.warn('tvaRate', 'tva_defaulted');
      const units: ProductUnitInput[] = [
        {
          unitId: baseUnitId ?? '',
          factorToBase: '1',
          barcode: baseBarcode,
          isDefaultSale: true,
          isDefaultPurchase: true,
        },
        ...packs.flatMap((p) =>
          p.unitId
            ? [
                {
                  unitId: p.unitId,
                  factorToBase: p.factor ?? '',
                  barcode: p.barcode,
                  isDefaultSale: false,
                  isDefaultPurchase: false,
                },
              ]
            : [],
        ),
      ];
      const parsed = createProductSchema.safeParse({
        reference,
        designation: designation ?? '',
        categoryId: categoryId ?? null,
        baseUnitId: baseUnitId ?? '',
        tvaRate: tvaRate || '0',
        minStock: minStock || '0',
        active: true,
        units,
        prices: priceInputs,
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          row.error(undefined, 'invalid_product', { rule: issue.message });
        return { row, plan: null };
      }
      return { row, plan: { kind: 'CREATE', input: parsed.data, categoryName } };
    }

    // Merge into the existing product.
    const units: ProductUnitInput[] = existing.units.map((u) => ({
      unitId: u.unitId,
      factorToBase: u.factorToBase,
      barcode: u.barcode,
      isDefaultSale: u.isDefaultSale,
      isDefaultPurchase: u.isDefaultPurchase,
    }));
    const baseUnit = units.find((u) => u.unitId === existing.baseUnitId);
    if (baseUnit && baseBarcode) baseUnit.barcode = baseBarcode;
    for (const p of packs) {
      if (!p.unitId) continue;
      const current = units.find((u) => u.unitId === p.unitId);
      if (current) {
        if (p.factor) current.factorToBase = p.factor;
        if (p.barcode) current.barcode = p.barcode;
      } else {
        units.push({
          unitId: p.unitId,
          factorToBase: p.factor ?? '',
          barcode: p.barcode,
          isDefaultSale: false,
          isDefaultPurchase: false,
        });
      }
    }
    const mergedPrices = new Map(
      existing.prices.map((p) => [`${p.unitId}:${p.priceLevelId}`, { ...p }]),
    );
    for (const p of priceInputs) mergedPrices.set(`${p.unitId}:${p.priceLevelId}`, p);

    const candidate = {
      reference,
      designation: designation || existing.designation,
      categoryId: categoryId ?? existing.categoryId,
      baseUnitId: existing.baseUnitId,
      tvaRate: tvaRate || existing.tvaRate,
      minStock: minStock || existing.minStock,
      active: existing.active,
      units,
      prices: [...mergedPrices.values()],
      version: existing.version,
    };
    const parsed = updateProductSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        row.error(undefined, 'invalid_product', { rule: issue.message });
      return { row, plan: null };
    }
    const changed = categoryName !== null || productChanged(existing, parsed.data);
    if (!changed) row.warn(undefined, 'no_changes');
    return {
      row,
      plan: { kind: 'UPDATE', id: existing.id, input: changed ? parsed.data : null, categoryName },
    };
  });
}

/** Compares what the import would save with what is stored (normalized decimals). */
function productChanged(p: ProductDto, input: UpdateProductInput): boolean {
  const dec = (v: string) => qty(v).toString();
  const unitKey = (u: { unitId: string; factorToBase: string; barcode: string | null }) =>
    `${u.unitId}|${dec(u.factorToBase)}|${u.barcode ?? ''}`;
  const priceKey = (x: { unitId: string; priceLevelId: string; priceHt: string }) =>
    `${x.unitId}|${x.priceLevelId}|${dec(x.priceHt)}`;
  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  return (
    p.designation !== input.designation ||
    p.categoryId !== input.categoryId ||
    dec(p.tvaRate) !== dec(input.tvaRate) ||
    dec(p.minStock) !== dec(input.minStock) ||
    !sameSet(p.units.map(unitKey), input.units.map(unitKey)) ||
    !sameSet(p.prices.map(priceKey), input.prices.map(priceKey))
  );
}
