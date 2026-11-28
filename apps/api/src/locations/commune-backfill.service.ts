import { Injectable } from '@nestjs/common';
import { type LocationStatus, type ResolvedLocation, resolveLocation } from '@erp/shared/communes';
import { AuditService } from '../audit/audit.service';
import { tenantContext } from '../common/tenant-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { type ClientPlace, placeFromText } from './location-codes';

/** A client somebody should look at: not matched, or matched through a former wilaya. */
export interface BackfillListing {
  tenantId: string;
  tenantName: string;
  clientCode: string;
  clientName: string;
  archived: boolean;
  wilaya: string | null;
  commune: string | null;
  status: LocationStatus;
  setWilayaCode: number | null;
  setCommuneCode: number | null;
  /** What the commune text could be, as `code name (wilaya, match)`. */
  candidates: string;
}

export interface CommuneBackfillResult {
  tenants: number;
  /** Clients that were given codes. */
  changed: number;
  /** Clients with a location text and no code that were left as they are. */
  unmatched: number;
  listed: number;
}

const BATCH = 500;
const MAX_CANDIDATES = 10;
const NOT_MATCHED: readonly LocationStatus[] = ['NO_MATCH', 'AMBIGUOUS', 'UNDER_REVIEW'];

interface Row {
  id: string;
  code: string;
  name: string;
  wilaya: string | null;
  commune: string | null;
  archived: boolean;
}

const candidatesText = (found: ResolvedLocation): string =>
  found.candidates
    .slice(0, MAX_CANDIDATES)
    .map(({ commune, match }) => `${commune.code} ${commune.fr} (${commune.wilayaCode}, ${match})`)
    .join(' | ');

/**
 * One-off after the phase 40a deploy (docs/runbook.md, "Commune backfill"): gives codes to
 * the clients that only have the old wilaya and commune text, by the one matcher
 * (`resolveLocation`). Only a client with BOTH codes empty is written, so a code is never
 * replaced and a second run changes nothing. Archived clients are included: they stay in
 * the past figures, which are now grouped by code. Sectors are not touched.
 */
@Injectable()
export class CommuneBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** `report` receives the listed clients once their batch is committed. */
  async run(
    options: {
      tenantIds?: string[];
      report?: (rows: BackfillListing[]) => void | Promise<void>;
    } = {},
  ): Promise<CommuneBackfillResult> {
    const tenants = await tenantContext.runAsSystem(() =>
      this.prisma.db.tenant.findMany({
        where: options.tenantIds ? { id: { in: options.tenantIds } } : {},
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
      }),
    );
    const result: CommuneBackfillResult = {
      tenants: tenants.length,
      changed: 0,
      unmatched: 0,
      listed: 0,
    };
    for (const tenant of tenants) {
      await tenantContext.run({ tenantId: tenant.id }, async () => {
        let after: string | null = null;
        do {
          const batch: Awaited<ReturnType<CommuneBackfillService['batch']>> =
            await this.prisma.db.$transaction((tx) => this.batch(tx, tenant, after), {
              timeout: 120_000,
            });
          after = batch.next;
          result.changed += batch.changed;
          result.unmatched += batch.unmatched;
          result.listed += batch.listed.length;
          if (batch.listed.length > 0) await options.report?.(batch.listed);
        } while (after !== null);
      });
    }
    return result;
  }

  private async batch(tx: Tx, tenant: { id: string; name: string }, after: string | null) {
    // Locked in id order, like a bulk assign: the text cannot change before the write.
    const rows = await tx.$queryRaw<Row[]>`
      SELECT id, code, name, wilaya, commune, ("deletedAt" IS NOT NULL) AS archived
      FROM clients
      WHERE "tenantId" = ${tenant.id}::uuid AND "wilayaCode" IS NULL AND "communeCode" IS NULL
        AND (btrim(COALESCE(wilaya, '')) <> '' OR btrim(COALESCE(commune, '')) <> '')
        AND (${after}::uuid IS NULL OR id > ${after}::uuid)
      ORDER BY id
      LIMIT ${BATCH}
      FOR UPDATE`;

    const listed: BackfillListing[] = [];
    /** Clients that get the same values are written together. */
    const writes = new Map<string, { place: ClientPlace; ids: string[] }>();
    const audits: Parameters<AuditService['logMany']>[1] = [];
    let unmatched = 0;
    for (const row of rows) {
      const found = resolveLocation({ wilayaText: row.wilaya, communeText: row.commune });
      if (found.wilayaCode !== null) {
        const place = placeFromText(row, found);
        const key = JSON.stringify(place);
        const write = writes.get(key) ?? { place, ids: [] };
        write.ids.push(row.id);
        writes.set(key, write);
        audits.push({
          action: 'CLIENT_LOCATION_BACKFILLED',
          entity: 'Client',
          entityId: row.id,
          before: {
            wilaya: row.wilaya,
            commune: row.commune,
            wilayaCode: null,
            communeCode: null,
          },
          after: { ...place, locationResolution: found.status },
        });
      }
      const notMatched = NOT_MATCHED.includes(found.status);
      if (notMatched) unmatched++;
      if (notMatched || found.status === 'MATCHED_FORMER_WILAYA') {
        listed.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          clientCode: row.code,
          clientName: row.name,
          archived: row.archived,
          wilaya: row.wilaya,
          commune: row.commune,
          status: found.status,
          setWilayaCode: found.wilayaCode,
          setCommuneCode: found.communeCode,
          candidates: candidatesText(found),
        });
      }
    }

    let changed = 0;
    for (const { place, ids } of writes.values()) {
      const { count } = await tx.client.updateMany({
        // The codes are checked again here: a code is never overwritten.
        where: { id: { in: ids }, wilayaCode: null, communeCode: null },
        data: { ...place, version: { increment: 1 } },
      });
      changed += count;
    }
    // The rows are locked, so anything else would make the audit lie: roll the batch back.
    if (changed !== audits.length) throw new Error('Commune backfill: rows changed under lock');
    await this.audit.logMany(tx, audits);
    return {
      changed,
      unmatched,
      listed,
      next: rows.length === BATCH ? rows[rows.length - 1]!.id : null,
    };
  }
}
