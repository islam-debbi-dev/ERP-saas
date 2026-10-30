import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  Feature,
  packagingGiven,
  PackagingEntryType,
  type PackagingReturnedInput,
  type SalePackagingDto,
  type SaleWarning,
} from '@erp/shared';
import { FeaturesService } from '../billing/features.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { type Tx } from '../prisma/prisma.service';

export interface PackagingEntryInput {
  clientId: string;
  packagingTypeId: string;
  type: PackagingEntryType;
  /** Signed: + given to the client, − brought back. Never 0. */
  qty: number;
  label: string;
  note?: string | null;
  refType?: string | null;
  refId?: string | null;
}

interface BalanceRow {
  balance: number;
  hasOpening: boolean;
}

const keyOf = (clientId: string, packagingTypeId: string) => `${clientId}:${packagingTypeId}`;

/**
 * The only way to change a client's packaging count (AGENTS.md rules 1 and 3, like
 * ClientAccountService for money). Lock order: after the client balances, the packaging
 * balances by (clientId, packagingTypeId).
 */
@Injectable()
export class PackagingLedgerService {
  constructor(private readonly features: FeaturesService) {}

  async enabled(): Promise<boolean> {
    const tenantId = tenantContext.requireTenantId();
    return (await this.features.of(tenantId)).features.includes(Feature.PACKAGING);
  }

  async requireEnabled(): Promise<void> {
    if (!(await this.enabled())) {
      throw new AppException(ErrorCode.FEATURE_NOT_IN_PLAN, 'This module is not in your plan', {
        feature: Feature.PACKAGING,
      });
    }
  }

  /** Posts the entries and returns the new count per `clientId:packagingTypeId`. */
  async post(tx: Tx, entries: PackagingEntryInput[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (entries.length === 0) return result;
    const tenantId = tenantContext.requireTenantId();
    const userId = tenantContext.get()?.userId ?? null;
    const rows = await this.lock(tx, entries);
    for (const e of entries) {
      if (!Number.isInteger(e.qty) || e.qty === 0) {
        throw new Error('A packaging entry is a non-zero whole count');
      }
      const key = keyOf(e.clientId, e.packagingTypeId);
      const row = rows.get(key);
      if (!row) throw new Error(`packaging balance not locked for ${key}`);
      if (e.type === PackagingEntryType.OPENING) {
        if (row.hasOpening) {
          throw new AppException(
            ErrorCode.PACKAGING_OPENING_ALREADY_SET,
            'Opening count already set',
            { clientId: e.clientId, packagingTypeId: e.packagingTypeId },
          );
        }
        row.hasOpening = true;
      }
      row.balance += e.qty;
      await tx.clientPackagingEntry.create({
        data: {
          tenantId,
          clientId: e.clientId,
          packagingTypeId: e.packagingTypeId,
          type: e.type,
          qty: e.qty,
          label: e.label.slice(0, 160),
          note: e.note ?? null,
          refType: e.refType ?? null,
          refId: e.refId ?? null,
          createdBy: userId,
        },
      });
    }
    for (const [key, row] of rows) {
      const [clientId = '', packagingTypeId = ''] = key.split(':');
      await tx.clientPackagingBalance.update({
        where: { clientId_packagingTypeId: { clientId, packagingTypeId } },
        data: { balance: row.balance, hasOpening: row.hasOpening },
      });
      result.set(key, row.balance);
    }
    return result;
  }

  /**
   * At a sale's validation: DELIVERY for the packaging its lines travel in, RETURN for
   * the empties the client hands back. Returns a warning per count left negative.
   */
  async postForSaleInTx(
    tx: Tx,
    sale: {
      id: string;
      number: string;
      clientId: string | null;
      lines: { productId: string; qtyBase: string }[];
    },
    returned: PackagingReturnedInput,
  ): Promise<SaleWarning[]> {
    const on = await this.enabled();
    if (!on) {
      if (returned.length > 0) await this.requireEnabled();
      return [];
    }
    if (!sale.clientId) {
      if (returned.length > 0) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'A client is required', {
          field: 'packagingReturned',
          rule: 'client_required',
        });
      }
      return [];
    }
    const clientId = sale.clientId;
    await this.checkTypes(
      tx,
      returned.map((r) => r.packagingTypeId),
    );
    const rules = await tx.productPackaging.findMany({
      where: {
        productId: { in: [...new Set(sale.lines.map((l) => l.productId))] },
        packagingType: { deletedAt: null },
      },
      select: { productId: true, packagingTypeId: true, qtyBasePerPackaging: true },
    });
    const given = packagingGiven(
      sale.lines,
      rules.map((r) => ({ ...r, qtyBasePerPackaging: r.qtyBasePerPackaging.toString() })),
    );
    const entries: PackagingEntryInput[] = [
      ...[...given].map(([packagingTypeId, count]) => ({
        clientId,
        packagingTypeId,
        type: PackagingEntryType.DELIVERY,
        qty: count,
        label: sale.number,
        refType: 'Sale',
        refId: sale.id,
      })),
      ...returned.map((r) => ({
        clientId,
        packagingTypeId: r.packagingTypeId,
        type: PackagingEntryType.RETURN,
        qty: -r.qty,
        label: sale.number,
        refType: 'Sale',
        refId: sale.id,
      })),
    ];
    const balances = await this.post(tx, entries);
    return [...balances]
      .filter(([, balance]) => balance < 0)
      .map(([key, balance]) => ({
        kind: 'PACKAGING_NEGATIVE' as const,
        packagingTypeId: key.split(':')[1] ?? '',
        balance,
      }));
  }

  /** Cancel of a sale: gives back exactly what the sale's entries left, per packaging. */
  async reverseForSaleInTx(
    tx: Tx,
    sale: { id: string; number: string | null; clientId: string | null },
    reason: string,
  ): Promise<void> {
    if (!sale.clientId) return;
    const clientId = sale.clientId;
    const nets = await tx.clientPackagingEntry.groupBy({
      by: ['packagingTypeId'],
      where: { refType: 'Sale', refId: sale.id },
      _sum: { qty: true },
    });
    await this.post(
      tx,
      nets
        .filter((n) => (n._sum.qty ?? 0) !== 0)
        .map((n) => ({
          clientId,
          packagingTypeId: n.packagingTypeId,
          type: PackagingEntryType.REVERSAL,
          qty: -(n._sum.qty ?? 0),
          label: sale.number ?? '',
          note: reason,
          refType: 'Sale',
          refId: sale.id,
        })),
    );
  }

  /** Given and returned per packaging for one sale (sale view, printed BL). */
  async ofSale(db: Tx, saleId: string): Promise<SalePackagingDto[]> {
    const rows = await db.clientPackagingEntry.findMany({
      where: {
        refType: 'Sale',
        refId: saleId,
        type: { in: [PackagingEntryType.DELIVERY, PackagingEntryType.RETURN] },
      },
      include: { packagingType: { select: { name: true } } },
      orderBy: { seq: 'asc' },
    });
    const out = new Map<string, SalePackagingDto>();
    for (const r of rows) {
      const row = out.get(r.packagingTypeId) ?? {
        packagingTypeId: r.packagingTypeId,
        name: r.packagingType.name,
        given: 0,
        returned: 0,
      };
      if (r.type === PackagingEntryType.DELIVERY) row.given += r.qty;
      else row.returned -= r.qty;
      out.set(r.packagingTypeId, row);
    }
    return [...out.values()];
  }

  async checkTypes(tx: Tx, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const found = await tx.packagingType.count({ where: { id: { in: unique }, deletedAt: null } });
    if (found !== unique.length) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown packaging type', {
        field: 'packagingTypeId',
      });
    }
  }

  /** Creates missing balance rows, then locks them in (clientId, packagingTypeId) order. */
  private async lock(tx: Tx, entries: PackagingEntryInput[]): Promise<Map<string, BalanceRow>> {
    const tenantId = tenantContext.requireTenantId();
    const pairs = [
      ...new Map(entries.map((e) => [keyOf(e.clientId, e.packagingTypeId), e] as const)).values(),
    ].sort((a, b) =>
      a.clientId === b.clientId
        ? a.packagingTypeId.localeCompare(b.packagingTypeId)
        : a.clientId.localeCompare(b.clientId),
    );
    for (const p of pairs) {
      await tx.$executeRaw`
        INSERT INTO client_packaging_balances
          ("id", "tenantId", "clientId", "packagingTypeId", "updatedAt")
        VALUES (gen_random_uuid(), ${tenantId}::uuid, ${p.clientId}::uuid,
                ${p.packagingTypeId}::uuid, CURRENT_TIMESTAMP)
        ON CONFLICT ("clientId", "packagingTypeId") DO NOTHING`;
    }
    const rows = await tx.$queryRaw<
      { clientId: string; packagingTypeId: string; balance: number; hasOpening: boolean }[]
    >`
      SELECT "clientId"::text AS "clientId", "packagingTypeId"::text AS "packagingTypeId",
             balance, "hasOpening"
      FROM client_packaging_balances
      WHERE "tenantId" = ${tenantId}::uuid
        AND ("clientId", "packagingTypeId") IN (${Prisma.join(
          pairs.map((p) => Prisma.sql`(${p.clientId}::uuid, ${p.packagingTypeId}::uuid)`),
        )})
      ORDER BY "clientId", "packagingTypeId"
      FOR UPDATE`;
    return new Map(
      rows.map((r) => [
        keyOf(r.clientId, r.packagingTypeId),
        { balance: r.balance, hasOpening: r.hasOpening },
      ]),
    );
  }
}
