import { type ClientDto, type ImportFieldDef, type ImportMapping } from '@erp/shared';
import type { ImportTable } from '../file-reader';
import type { ValidatedRow } from './products';
import { DuplicateTracker, RowReader } from './row-reader';

export interface PackagingOpeningLookups {
  /** By code, archived included. */
  clients: Map<string, ClientDto>;
  /** Live packaging types by lower-cased name. */
  types: Map<string, { id: string; name: string }>;
  /** `clientId:packagingTypeId` pairs that already have an opening count. */
  withOpening: Set<string>;
}

export interface PackagingOpeningPlan {
  clientId: string;
  packagingTypeId: string;
  qty: number;
}

/**
 * Emballages chez les clients (phase 20): one opening count per client and packaging.
 * Refused when that pair already has one, so importing the same file twice never doubles it.
 */
export function validatePackagingOpening(
  table: ImportTable,
  mapping: ImportMapping,
  fields: ImportFieldDef[],
  lookups: PackagingOpeningLookups,
): ValidatedRow<PackagingOpeningPlan>[] {
  const pairs = new DuplicateTracker();
  return table.rows.map(({ rowNumber, cells }) => {
    const row = new RowReader(rowNumber, cells, mapping, fields);
    const code = row.requiredText('clientCode', 30);
    const client = code ? lookups.clients.get(code) : undefined;
    if (code && !client) row.error('clientCode', 'client_not_found');
    else if (client?.archivedAt) row.error('clientCode', 'client_archived');

    const name = row.requiredText('packaging', 80);
    const type = name ? lookups.types.get(name.toLowerCase()) : undefined;
    if (name && !type) row.error('packaging', 'packaging_not_found', { value: name });

    if (client && type) {
      pairs.check(row, 'packaging', `${client.id}:${type.id}`);
      if (lookups.withOpening.has(`${client.id}:${type.id}`)) {
        row.error('packaging', 'opening_already_set');
      }
    }

    const quantity = row.number('quantity', { decimals: 0, positive: true });
    if (quantity === '') row.error('quantity', 'required');

    if (row.errors.length > 0 || !client || !type || !quantity) return { row, plan: null };
    return { row, plan: { clientId: client.id, packagingTypeId: type.id, qty: Number(quantity) } };
  });
}
