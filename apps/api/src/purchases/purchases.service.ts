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
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { WarehousesService } from '../stock/warehouses.service';
import { fromIsoDate, purchaseInclude, toIsoDate, toPurchaseDto } from './purchase.mapper';
import { snapshotLines } from './purchase-lines';

/** Bon de réception drafts and reads. Effects (stock) live in PurchaseWorkflowService. */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
  ) {}

  async create(input: CreatePurchaseInput): Promise<PurchaseDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      await this.checkSupplier(tx, input.supplierId);
      const { lines, totals } = await snapshotLines(tx, input.lines);
      this.checkPaid(input.paidAmount, totals.totalTtc.toString());
      const warehouseId = input.warehouseId
        ? await this.warehouses.resolve(tx, input.warehouseId)
        : null;
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
        after: { supplierId: input.supplierId, warehouseId, lines: input.lines },
      });
      return purchase.id;
    });
    return this.get(id);
  }

  /** Replaces the draft (header and lines). `version` guards against concurrent edits. */
  async update(id: string, input: UpdatePurchaseInput): Promise<PurchaseDto> {
    await this.prisma.db.$transaction(async (tx) => {
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
      await this.checkSupplier(tx, input.supplierId);
      const { lines, totals } = await snapshotLines(tx, input.lines);
      this.checkPaid(input.paidAmount, totals.totalTtc.toString());
      const warehouseId = input.warehouseId
        ? await this.warehouses.resolve(tx, input.warehouseId)
        : input.warehouseId;
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
          totalHt: totals.totalHt.toString(),
          totalTva: totals.totalTva.toString(),
          totalTtc: totals.totalTtc.toString(),
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
    return this.get(id);
  }

  async get(id: string): Promise<PurchaseDto> {
    const p = await this.prisma.db.purchase.findUnique({ where: { id }, include: purchaseInclude });
    if (!p) throw new AppException(ErrorCode.NOT_FOUND, 'Purchase not found');
    return toPurchaseDto(p);
  }

  async list(query: PurchaseListQuery): Promise<PurchasePage> {
    const where: Prisma.PurchaseWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
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
        lineCount: p._count.lines,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private async checkSupplier(tx: Tx, supplierId: string): Promise<void> {
    const s = await tx.supplier.findFirst({ where: { id: supplierId, deletedAt: null } });
    if (!s)
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown supplier', {
        field: 'supplierId',
      });
  }

  private checkPaid(paid: string, totalTtc: string): void {
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
): Promise<{ status: string; version: number }> {
  const rows = await tx.$queryRaw<{ status: string; version: number }[]>`
    SELECT status, version FROM purchases
    WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Purchase not found');
  return row;
}
