import { closeSync, openSync, writeSync } from 'node:fs';
import {
  type CommuneBackfillResult,
  type CommuneBackfillService,
} from './commune-backfill.service';
import { CSV_BOM, csvLine } from './csv';

const HEADER = [
  'tenant',
  'tenant id',
  'client code',
  'client name',
  'archived',
  'old wilaya',
  'old commune',
  'status',
  'set wilaya code',
  'set commune code',
  'candidates',
];

/**
 * Runs the backfill and writes the clients to check into a new CSV at `out`. `wx`: an
 * existing report is never overwritten, and a report that cannot be created stops the run
 * before it changes a client. Rows are written batch by batch, as they are committed.
 */
export async function backfillToCsv(
  backfill: CommuneBackfillService,
  out: string,
  options: { tenantIds?: string[] } = {},
): Promise<CommuneBackfillResult> {
  const file = openSync(out, 'wx');
  try {
    writeSync(file, CSV_BOM + csvLine(HEADER));
    return await backfill.run({
      ...options,
      report: (rows) => {
        for (const row of rows) {
          writeSync(
            file,
            csvLine([
              row.tenantName,
              row.tenantId,
              row.clientCode,
              row.clientName,
              row.archived ? 'yes' : 'no',
              row.wilaya,
              row.commune,
              row.status,
              row.setWilayaCode,
              row.setCommuneCode,
              row.candidates,
            ]),
          );
        }
      },
    });
  } finally {
    closeSync(file);
  }
}
