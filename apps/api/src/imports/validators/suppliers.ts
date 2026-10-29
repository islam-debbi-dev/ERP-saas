import {
  type ImportFieldDef,
  type ImportMapping,
  money,
  type SupplierDto,
  type SupplierInput,
  supplierSchema,
  type UpdateSupplierInput,
  updateSupplierSchema,
} from '@erp/shared';
import type { ImportTable } from '../file-reader';
import type { ValidatedRow } from './products';
import { DuplicateTracker, RowReader } from './row-reader';

export type SupplierPlan =
  | { kind: 'CREATE'; input: SupplierInput; opening: string | null }
  | { kind: 'UPDATE'; id: string; input: UpdateSupplierInput | null; opening: string | null };

/**
 * "Fournisseurs et soldes" (phase 21), same rules as the clients import: suppliers
 * matched by code, existing ones get the non-empty cells, and a solde initial on a
 * supplier that already has one is refused, so a re-import never doubles it.
 * Positive solde = we owe the supplier.
 */
export function validateSuppliers(
  table: ImportTable,
  mapping: ImportMapping,
  fields: ImportFieldDef[],
  existing: Map<string, SupplierDto>,
): ValidatedRow<SupplierPlan>[] {
  const codes = new DuplicateTracker();
  return table.rows.map(({ rowNumber, cells }) => {
    const row = new RowReader(rowNumber, cells, mapping, fields);
    const code = row.requiredText('code', 30);
    if (code) codes.check(row, 'code', code);
    const supplier = code ? existing.get(code) : undefined;
    if (supplier?.archivedAt) row.error('code', 'supplier_archived');

    const name = supplier ? row.optionalText('name', 120) : row.requiredText('name', 120);
    const phone = row.optionalText('phone', 40);
    const address = row.optionalText('address', 255);
    const opening = row.number('openingBalance', { decimals: 2, signed: true });
    const hasOpening = !!opening && !money(opening).isZero();
    if (hasOpening && supplier?.hasOpening) row.error('openingBalance', 'opening_already_set');

    if (row.errors.length > 0 || !code || name === null || phone === null || address === null) {
      return { row, plan: null };
    }
    if (opening === null) return { row, plan: null };

    if (!supplier) {
      const parsed = supplierSchema.safeParse({ code, name, phone, address });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          row.error(issue.path.join('.') || undefined, 'invalid_supplier', { rule: issue.message });
        }
        return { row, plan: null };
      }
      return {
        row,
        plan: { kind: 'CREATE', input: parsed.data, opening: hasOpening ? opening : null },
      };
    }

    const parsed = updateSupplierSchema.safeParse({
      name: name || supplier.name,
      phone: phone || supplier.phone,
      address: address || supplier.address,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        row.error(issue.path.join('.') || undefined, 'invalid_supplier', { rule: issue.message });
      }
      return { row, plan: null };
    }
    const input = parsed.data;
    const changed =
      input.name !== supplier.name ||
      input.phone !== supplier.phone ||
      input.address !== supplier.address;
    if (!changed && !hasOpening) row.warn(undefined, 'no_changes');
    return {
      row,
      plan: {
        kind: 'UPDATE',
        id: supplier.id,
        input: changed ? input : null,
        opening: hasOpening ? opening : null,
      },
    };
  });
}
