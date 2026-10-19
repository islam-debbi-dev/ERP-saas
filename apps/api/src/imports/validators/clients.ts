import {
  type ClientDto,
  type CreateClientInput,
  createClientSchema,
  type ImportFieldDef,
  type ImportMapping,
  money,
  type UpdateClientInput,
  updateClientSchema,
} from '@erp/shared';
import type { ImportTable } from '../file-reader';
import type { ValidatedRow } from './products';
import { DuplicateTracker, RowReader } from './row-reader';

export type ClientPlan =
  | { kind: 'CREATE'; input: CreateClientInput; opening: string | null }
  | { kind: 'UPDATE'; id: string; input: UpdateClientInput | null; opening: string | null };

/**
 * Clients matched by code: new ones are created, existing ones get the
 * non-empty cells (a blank cell keeps the current value). A solde initial on a
 * client that already has one is refused, so a re-import never doubles it.
 */
export function validateClients(
  table: ImportTable,
  mapping: ImportMapping,
  fields: ImportFieldDef[],
  existing: Map<string, ClientDto>,
): ValidatedRow<ClientPlan>[] {
  const codes = new DuplicateTracker();
  return table.rows.map(({ rowNumber, cells }) => {
    const row = new RowReader(rowNumber, cells, mapping, fields);
    const code = row.requiredText('code', 30);
    if (code) codes.check(row, 'code', code);
    const client = code ? existing.get(code) : undefined;
    if (client?.archivedAt) row.error('code', 'client_archived');

    const name = client ? row.optionalText('name', 160) : row.requiredText('name', 160);
    const phone = row.optionalText('phone', 40);
    const address = row.optionalText('address', 255);
    const creditLimit = row.number('creditLimit', { decimals: 2 });
    const opening = row.number('openingBalance', { decimals: 2, signed: true });
    const hasOpening = !!opening && !money(opening).isZero();
    if (hasOpening && client?.hasOpening) row.error('openingBalance', 'opening_already_set');

    if (row.errors.length > 0 || !code || name === null || phone === null || address === null) {
      return { row, plan: null };
    }
    if (creditLimit === null || opening === null) return { row, plan: null };

    if (!client) {
      const parsed = createClientSchema.safeParse({
        code,
        name,
        phone,
        address,
        creditLimit: creditLimit === '' ? null : creditLimit,
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          row.error(issue.path.join('.') || undefined, 'invalid_client', { rule: issue.message });
        }
        return { row, plan: null };
      }
      return {
        row,
        plan: { kind: 'CREATE', input: parsed.data, opening: hasOpening ? opening : null },
      };
    }

    const parsed = updateClientSchema.safeParse({
      ...client,
      name: name || client.name,
      phone: phone || client.phone,
      address: address || client.address,
      creditLimit: creditLimit === '' ? client.creditLimit : creditLimit,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        row.error(issue.path.join('.') || undefined, 'invalid_client', { rule: issue.message });
      }
      return { row, plan: null };
    }
    const input = parsed.data;
    const changed =
      input.name !== client.name ||
      input.phone !== client.phone ||
      input.address !== client.address ||
      (input.creditLimit === null) !== (client.creditLimit === null) ||
      (input.creditLimit !== null &&
        client.creditLimit !== null &&
        !money(input.creditLimit).eq(client.creditLimit));
    if (!changed && !hasOpening) row.warn(undefined, 'no_changes');
    return {
      row,
      plan: {
        kind: 'UPDATE',
        id: client.id,
        input: changed ? input : null,
        opening: hasOpening ? opening : null,
      },
    };
  });
}
