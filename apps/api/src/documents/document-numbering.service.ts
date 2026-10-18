import { Injectable } from '@nestjs/common';
import { type DocType } from '@erp/shared';
import { tenantContext } from '../common/tenant-context';
import { type Tx } from '../prisma/prisma.service';

/** Document numbers use the year in Algeria, not UTC (a sale at 00:30 on Jan 1st is next year). */
const yearFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Algiers',
  year: 'numeric',
});

export function documentYear(date: Date): number {
  return Number(yearFormatter.format(date));
}

export function formatDocumentNumber(docType: DocType, year: number, n: number): string {
  return `${docType}-${year}-${String(n).padStart(6, '0')}`;
}

@Injectable()
export class DocumentNumberingService {
  /**
   * Next number for (tenant, docType, year), e.g. `BL-2026-000001`.
   *
   * Must be called inside the business transaction: the sequence row stays locked
   * (SELECT ... FOR UPDATE) until that transaction ends, so concurrent documents get
   * consecutive numbers, and a rolled-back transaction gives its number back (no gaps).
   */
  async next(tx: Tx, tenantId: string, docType: DocType, date: Date = new Date()): Promise<string> {
    const ctxTenant = tenantContext.get();
    if (!ctxTenant?.system && ctxTenant?.tenantId !== tenantId) {
      // Raw SQL bypasses the tenant extension, so check the argument against the token.
      throw new Error('DocumentNumberingService.next: tenantId does not match the request tenant');
    }
    const year = documentYear(date);

    // Create the row for a new year/type if needed. ON CONFLICT DO NOTHING waits for a
    // concurrent insert to commit instead of failing.
    await tx.$executeRaw`
      INSERT INTO document_sequences ("tenantId", "docType", "year", "lastNumber")
      VALUES (${tenantId}::uuid, ${docType}::"DocType", ${year}, 0)
      ON CONFLICT DO NOTHING`;

    const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
      SELECT "lastNumber" FROM document_sequences
      WHERE "tenantId" = ${tenantId}::uuid AND "docType" = ${docType}::"DocType" AND "year" = ${year}
      FOR UPDATE`;
    const current = rows[0];
    if (!current) throw new Error('Document sequence row missing after insert');

    const next = current.lastNumber + 1;
    await tx.$executeRaw`
      UPDATE document_sequences SET "lastNumber" = ${next}
      WHERE "tenantId" = ${tenantId}::uuid AND "docType" = ${docType}::"DocType" AND "year" = ${year}`;

    return formatDocumentNumber(docType, year, next);
  }
}
