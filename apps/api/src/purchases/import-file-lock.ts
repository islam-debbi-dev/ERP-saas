import { ErrorCode, ImportFileStatus } from '@erp/shared';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Tx } from '../prisma/prisma.service';

/**
 * Locks a dossier d'importation row (phase 22). Lock order everywhere: the dossier, then
 * its BRs, then stock rows by productId, then supplier balances by supplierId.
 */
export async function lockImportFile(
  tx: Tx,
  id: string,
): Promise<{ status: ImportFileStatus; version: number; number: string }> {
  const rows = await tx.$queryRaw<{ status: ImportFileStatus; version: number; number: string }[]>`
    SELECT status, version, number FROM import_files
    WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Import file not found');
  return row;
}

/** `lockImportFile` that also requires the dossier to be OPEN. */
export async function lockImportFileOpen(
  tx: Tx,
  id: string,
): Promise<{ status: ImportFileStatus; version: number; number: string }> {
  const row = await lockImportFile(tx, id);
  if (row.status !== ImportFileStatus.OPEN) {
    throw new AppException(ErrorCode.IMPORT_FILE_NOT_OPEN, 'The dossier is not open', {
      status: row.status,
    });
  }
  return row;
}
