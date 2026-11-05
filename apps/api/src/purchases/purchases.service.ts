import { Injectable } from '@nestjs/common';
import {
  type CreatePurchaseInput,
  ErrorCode,
  money,
  type PurchaseDto,
  type PurchaseListQuery,
  type PurchasePage,
  PurchaseStatus,
  type UpdatePurchaseInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import type { CurrentUserInfo } from '../auth/auth.types';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { WarehousesService } from '../stock/warehouses.service';
import { fromIsoDate, purchaseInclude, toIsoDate, toPurchaseDto } from './purchase.mapper';
import { ImportCostsGate } from './import-costs-gate';
import { type ForeignPrices, snapshotLines } from './purchase-lines';

/** Bon de réception drafts and reads. Effects (stock) live in PurchaseWorkflowService. */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
    private readonly importCosts: ImportCostsGate,
    private readonly scope: ScopeService,
  ) {}

  async create(input: CreatePurchaseInput, user: CurrentUserInfo): Promise<PurchaseDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      const fx = await this.foreignPrices(tx, input);
      const importFileId = await this.checkImportFile(tx, input.importFileId);
      const { lines, totals, totalCurrency } = await snapshotLines(tx, input.lines, fx);
      this.checkPaid(input.paidAmount, totals.totalTtc.toString(), fx);
      // A user who works in one dépôt receives there (phase 24).
      const warehouseId = input.warehouseId
        ? await this.warehouses.resolve(tx, input.warehouseId)
        : await this.scope.onlyWarehouse(user, tx);
      if (warehouseId) await this.scope.assertWarehouse(tx, user, warehouseId);
      const purchase = await tx.purchase.create({
        data: {
          tenantId,
          warehouseId,
          supplierId: input.supplierId,
          documentDate: fromIsoDate(input.documentDate),
          supplierRef: input.supplierRef,
          note: input.note,
          paidAmount: input.paidAmount,
          totalHt: totals.totalHt.toString(),
          totalTva: totals.totalTva.toString(),
          totalTtc: totals.totalTtc.toString(),
          currency: fx?.currency ?? 'DZD',
          exchangeRate: fx?.rate ?? '1',
          totalCurrency: totalCurrency?.toString() ?? null,
          importFileId: importFileId ?? null,
          createdBy: tenantContext.get()?.userId ?? null,
        },
      });
      if (lines.length > 0) {
        await tx.purchaseLine.createMany({
          data: lines.map((l) => ({ ...l, tenantId, purchaseId: purchase.id })),
        });
      }
      await this.audit.log(tx, {
        action: 'PURCHASE_DRAFT_CREATED',
        entity: 'Purchase',
        entityId: purchase.id,
        after: {
          supplierId: input.supplierId,
          warehouseId,
          ...(fx ? { currency: fx.currency, exchangeRate: fx.rate } : {}),
          ...(importFileId ? { importFileId } : {}),
          lines: input.lines,
        },
      });
      return purchase.id;
    });
    return this.get(id, user);
  }

  /** Replaces the draft (header and lines). `version` guards against concurrent edits. */
  async update(
    id: string,
    input: UpdatePurchaseInput,
    user: CurrentUserInfo,
  ): Promise<PurchaseDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertInScope(tx, user, id);
      const current = await lockPurchase(tx, id);
      if (current.status !== PurchaseStatus.DRAFT) {
        throw new AppException(ErrorCode.PURCHASE_NOT_DRAFT, 'Only a draft can be edited', {
          status: current.status,
        });
      }
      if (current.version !== input.version) {
        throw new AppException(ErrorCode.PURCHASE_MODIFIED, 'Purchase changed since it was read', {
          currentVersion: current.version,
        });
      }
      const fx = await this.foreignPrices(tx, input);
      const importFileId = await this.checkImportFile(tx, input.importFileId);
      const { lines, totals, totalCurrency } = await snapshotLines(tx, input.lines, fx);
      this.checkPaid(input.paidAmount, totals.totalTtc.toString(), fx);
      const warehouseId = input.warehouseId
        ? await this.warehouses.resolve(tx, input.warehouseId)
        : input.warehouseId;
      if (warehouseId) await this.scope.assertWarehouse(tx, user, warehouseId);
      // Draft lines have no effect anywhere, so they are simply replaced.
      await tx.purchaseLine.deleteMany({ where: { purchaseId: id } });
      if (lines.length > 0) {
        const tenantId = tenantContext.requireTenantId();
        await tx.purchaseLine.createMany({
          data: lines.map((l) => ({ ...l, tenantId, purchaseId: id })),
        });
      }
      await tx.purchase.update({
        where: { id },
        data: {
          supplierId: input.supplierId,
          documentDate: fromIsoDate(input.documentDate),
          supplierRef: input.supplierRef,
          note: input.note,
          paidAmount: input.paidAmount,
          ...(warehouseId !== undefined ? { warehouseId } : {}),
          ...(importFileId !== undefined ? { importFileId } : {}),
          totalHt: totals.totalHt.toString(),
          totalTva: totals.totalTva.toString(),
          totalTtc: totals.totalTtc.toString(),
          currency: fx?.currency ?? 'DZD',
          exchangeRate: fx?.rate ?? '1',
          totalCurrency: totalCurrency?.toString() ?? null,
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, {
        action: 'PURCHASE_DRAFT_UPDATED',
        entity: 'Purchase',
        entityId: id,
        after: { supplierId: input.supplierId, lines: input.lines },
      });
    });
    return this.get(id, user);
  }

  /**
   * One BR. With a user, a BR of a dépôt outside his reach answers 404 (phase 24); without
   * one (internal reads after a write already checked) it is not scoped.
   */
  async get(id: string, user?: CurrentUserInfo): Promise<PurchaseDto> {
    const scoped = user ? await this.scopeWhere(user) : {};
    const p = await this.prisma.db.purchase.findFirst({
      where: { id, ...scoped },
      include: purchaseInclude,
    });
    if (!p) throw new AppException(ErrorCode.NOT_FOUND, 'Purchase not found');
    return toPurchaseDto(p);
  }

  /** 404 unless the BR is in a dépôt the user works in (phase 24). Every write calls it. */
  /** A bon de réception by its number, in the user's scope (phase 30). */
  async findByNumber(number: string, user: CurrentUserInfo): Promise<PurchaseDto> {
    const p = await this.prisma.db.purchase.findFirst({ where: { number }, select: { id: true } });
    if (!p) throw new AppException(ErrorCode.NOT_FOUND, 'Purchase not found');
    return this.get(p.id, user);
  }

  async assertInScope(tx: Tx, user: CurrentUserInfo, id: string): Promise<void> {
    const where = await this.scopeWhere(user, tx);
    if (!where.AND) return;
    const p = await tx.purchase.findFirst({ where: { id, ...where }, select: { id: true } });
    if (!p) throw new AppException(ErrorCode.NOT_FOUND, 'Purchase not found');
  }

  /** BRs of the dépôts the user works in; a draft without one counts as the dépôt principal's. */
  private async scopeWhere(user: CurrentUserInfo, db?: Tx): Promise<Prisma.PurchaseWhereInput> {
    const scope = await this.scope.of(user, db);
    const w = this.scope.warehouseWhere(scope, scope.warehouseIds, 'createdBy');
    return w ? { AND: [w] } : {};
  }

  async list(query: PurchaseListQuery, user: CurrentUserInfo): Promise<PurchasePage> {
    const where: Prisma.PurchaseWhereInput = {
      ...(await this.scopeWhere(user)),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.importFileId ? { importFileId: query.importFileId } : {}),
      ...(query.from || query.to
        ? {
            documentDate: {
              ...(query.from ? { gte: fromIsoDate(query.from) } : {}),
              ...(query.to ? { lte: fromIsoDate(query.to) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.db.purchase.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        _count: { select: { lines: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((p) => ({
        id: p.id,
        number: p.number,
        status: p.status,
        supplier: p.supplier,
        documentDate: toIsoDate(p.documentDate),
        totalTtc: p.totalTtc.toFixed(2),
        currency: p.currency,
        totalCurrency: p.totalCurrency?.toFixed(2) ?? null,
        lineCount: p._count.lines,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * The BR takes its supplier's currency (phase 22): null for DZD, else the bank rate,
   * which is then required. Foreign currencies need the IMPORT_COSTS module.
   */
  private async foreignPrices(
    tx: Tx,
    input: { supplierId: string; exchangeRate?: string | undefined },
  ): Promise<ForeignPrices | null> {
    const s = await tx.supplier.findFirst({
      where: { id: input.supplierId, deletedAt: null },
      select: { currency: true },
    });
    if (!s)
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown supplier', {
        field: 'supplierId',
      });
    if (s.currency === 'DZD') return null;
    await this.importCosts.require();
    if (!input.exchangeRate) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Exchange rate required', {
        field: 'exchangeRate',
        currency: s.currency,
      });
    }
    return { currency: s.currency, rate: input.exchangeRate };
  }

  /**
   * A draft can join an OPEN dossier d'importation (phase 22). Undefined = unchanged,
   * null = leaves it. Validation and closing lock the dossier and check again.
   */
  private async checkImportFile(
    tx: Tx,
    importFileId: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (!importFileId) return importFileId;
    await this.importCosts.require();
    const file = await tx.importFile.findUnique({
      where: { id: importFileId },
      select: { status: true },
    });
    if (!file) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown import file', {
        field: 'importFileId',
      });
    }
    if (file.status !== 'OPEN') {
      throw new AppException(ErrorCode.IMPORT_FILE_NOT_OPEN, 'The dossier is not open', {
        status: file.status,
      });
    }
    return importFileId;
  }

  private checkPaid(paid: string, totalTtc: string, fx: ForeignPrices | null): void {
    // A foreign supplier is paid by règlements in its currency, never "at reception".
    if (fx && money(paid).gt(0)) {
      throw new AppException(ErrorCode.CURRENCY_MISMATCH, 'Pay a foreign supplier by règlement', {
        field: 'paidAmount',
      });
    }
    if (money(paid).gt(totalTtc)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Paid amount is more than the total', {
        field: 'paidAmount',
      });
    }
  }
}

/** Locks the purchase row for the rest of the transaction. */
export async function lockPurchase(
  tx: Tx,
  id: string,
): Promise<{ status: string; version: number; importFileId: string | null }> {
  const rows = await tx.$queryRaw<
    { status: string; version: number; importFileId: string | null }[]
  >`
    SELECT status, version, "importFileId" FROM purchases
    WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Purchase not found');
  return row;
}
