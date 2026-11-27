import {
  type ClientDto,
  type CreateClientInput,
  createClientSchema,
  type ImportFieldDef,
  type ImportMapping,
  money,
  type UpdateClientInput,
  updateClientSchema,
  wilayaOf,
} from '@erp/shared';
import { resolveLocation } from '@erp/shared/communes';
import type { ImportTable } from '../file-reader';
import type { ValidatedRow } from './products';
import { DuplicateTracker, RowReader } from './row-reader';

export type ClientPlan =
  | {
      kind: 'CREATE';
      input: CreateClientInput;
      opening: string | null;
      /** A segment the file names that does not exist: created at confirm only if asked. */
      segmentName: string | null;
    }
  | {
      kind: 'UPDATE';
      id: string;
      input: UpdateClientInput | null;
      opening: string | null;
      segmentName: string | null;
    };

const sameText = (a: string | null, b: string | null): boolean =>
  (a?.trim() ?? '') === (b?.trim() ?? '');

/**
 * Says in the preview what the confirm will do with a new wilaya / commune text: the
 * client service takes the codes from the same matcher. The text is kept either way, and
 * no commune is ever created.
 */
function warnLocation(row: RowReader, wilaya: string | null, commune: string | null): void {
  const found = resolveLocation({ wilayaText: wilaya, communeText: commune });
  const field = commune ? 'commune' : 'wilaya';
  const params = { wilaya: wilaya ?? '', commune: commune ?? '' };
  if (found.status === 'NO_MATCH') row.warn(field, 'location_not_found', params);
  else if (found.status === 'AMBIGUOUS') row.warn(field, 'location_ambiguous', params);
  else if (found.status === 'UNDER_REVIEW') row.warn(field, 'commune_under_review', params);
  else if (found.status === 'MATCHED_FORMER_WILAYA') {
    const now = wilayaOf(found.wilayaCode)!;
    row.warn(field, 'location_former_wilaya', {
      commune: commune ?? '',
      wilaya: `${String(now.code).padStart(2, '0')} ${now.fr}`,
    });
  }
}

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
  /** Live segments by lower-case code and name (phase 37). */
  segments: Map<string, string> = new Map(),
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
    const wilaya = row.optionalText('wilaya', 60);
    const commune = row.optionalText('commune', 80);
    // "Type": a known segment is set; an unknown one is listed, never created silently.
    const segmentText = row.optionalText('segment', 80) ?? '';
    const segmentId = segmentText === '' ? undefined : segments.get(segmentText.toLowerCase());
    const segmentName = segmentText !== '' && !segmentId ? segmentText : null;
    if (segmentName) row.warn('segment', 'segment_unknown', { name: segmentName });
    const creditLimit = row.number('creditLimit', { decimals: 2 });
    const opening = row.number('openingBalance', { decimals: 2, signed: true });
    const hasOpening = !!opening && !money(opening).isZero();
    if (hasOpening && client?.hasOpening) row.error('openingBalance', 'opening_already_set');

    if (row.errors.length > 0 || !code || name === null || phone === null || address === null) {
      return { row, plan: null };
    }
    if (wilaya === null || commune === null) return { row, plan: null };
    if (creditLimit === null || opening === null) return { row, plan: null };

    if (!client) {
      const parsed = createClientSchema.safeParse({
        code,
        name,
        phone,
        address,
        wilaya,
        commune,
        creditLimit: creditLimit === '' ? null : creditLimit,
        ...(segmentId ? { segmentId } : {}),
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          row.error(issue.path.join('.') || undefined, 'invalid_client', { rule: issue.message });
        }
        return { row, plan: null };
      }
      warnLocation(row, parsed.data.wilaya, parsed.data.commune);
      return {
        row,
        plan: {
          kind: 'CREATE',
          input: parsed.data,
          opening: hasOpening ? opening : null,
          segmentName,
        },
      };
    }

    const parsed = updateClientSchema.safeParse({
      ...client,
      name: name || client.name,
      phone: phone || client.phone,
      address: address || client.address,
      wilaya: wilaya || client.wilaya,
      commune: commune || client.commune,
      creditLimit: creditLimit === '' ? client.creditLimit : creditLimit,
      // Left out, so that the codes follow the text (docs/domain.md).
      wilayaCode: undefined,
      communeCode: undefined,
      sectorId: undefined,
      assignedSellerId: undefined,
      segmentId: segmentId ?? undefined,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        row.error(issue.path.join('.') || undefined, 'invalid_client', { rule: issue.message });
      }
      return { row, plan: null };
    }
    const input = parsed.data;
    const moved =
      !sameText(input.wilaya, client.wilaya) || !sameText(input.commune, client.commune);
    if (moved) warnLocation(row, input.wilaya, input.commune);
    const changed =
      moved ||
      (segmentId !== undefined && segmentId !== (client.segment?.id ?? null)) ||
      input.name !== client.name ||
      input.phone !== client.phone ||
      input.address !== client.address ||
      (input.creditLimit === null) !== (client.creditLimit === null) ||
      (input.creditLimit !== null &&
        client.creditLimit !== null &&
        !money(input.creditLimit).eq(client.creditLimit));
    if (!changed && !hasOpening && !segmentName) row.warn(undefined, 'no_changes');
    return {
      row,
      plan: {
        kind: 'UPDATE',
        id: client.id,
        // An unknown segment may be created at confirm: keep the input to set it then.
        input: changed || segmentName ? input : null,
        opening: hasOpening ? opening : null,
        segmentName,
      },
    };
  });
}
