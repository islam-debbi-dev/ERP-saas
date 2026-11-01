import { Injectable } from '@nestjs/common';
import {
  Permission,
  type CreateInventoryInput,
  DocType,
  ErrorCode,
  type InventoryDto,
  type InventoryLinesInput,
  InventoryStatus,
  type InventorySummaryDto,
  qty,
  StockMovementType,
  toQtyString,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { requirePermission } from '../auth/permissions';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { StockService } from './stock.service';
import { toBaseLines } from './unit-conversion';
import { WarehousesService } from './warehouses.service';

/**
 * Inventaire: count what is on the shelves of one dépôt, then validate. Validation
 * compares the counts with that dépôt's stock at that moment and writes INVENTORY
 * movements for the differences only. A validated or cancelled count is read-only.
 * Counts opened before phase 15 have no dépôt: they count the default one.
 */
@Injectable()
export class InventoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly numbering: DocumentNumberingService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
    private readonly scope: ScopeService,
  ) {}

  async create(input: CreateInventoryInput, user: CurrentUserInfo): Promise<InventoryDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      const warehouseId = await this.warehouses.resolve(tx, input.warehouseId, () =>
        this.scope.onlyWarehouse(user, tx),
      );
      await this.scope.assertWarehouse(tx, user, warehouseId);
      const number = await this.numbering.next(tx, tenantId, DocType.INV);
      const inv = await tx.inventory.create({
        data: {
          tenantId,
          number,
          warehouseId,
          note: input.note ?? null,
          createdBy: tenantContext.get()?.userId ?? null,
        },
      });
      await this.audit.log(tx, {
        action: 'INVENTORY_OPENED',
        entity: 'Inventory',
        entityId: inv.id,
        after: { number, warehouseId },
      });
      return inv.id;
    });
    return this.get(id);
  }

  async list(user: CurrentUserInfo): Promise<InventorySummaryDto[]> {
    const rows = await this.prisma.db.inventory.findMany({
      where: await this.scopeWhere(user),
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { _count: { select: { lines: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      warehouseId: r.warehouseId,
      lineCount: r._count.lines,
      createdAt: r.createdAt.toISOString(),
      validatedAt: r.validatedAt?.toISOString() ?? null,
    }));
  }

  /** While open, "expected" is the live stock; once validated it is the frozen value. */
  async get(id: string, user?: CurrentUserInfo): Promise<InventoryDto> {
    const inv = await this.prisma.db.inventory.findFirst({
      where: { id, ...(user ? await this.scopeWhere(user) : {}) },
      include: {
        lines: {
          include: {
            product: { select: { reference: true, designation: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!inv) throw new AppException(ErrorCode.NOT_FOUND, 'Inventory not found');
    const live =
      inv.status === InventoryStatus.OPEN
        ? await this.stock.warehouseQuantities(
            this.prisma.db,
            inv.warehouseId ?? (await this.warehouses.defaultId()),
            inv.lines.map((l) => l.productId),
          )
        : new Map<string, ReturnType<typeof qty>>();
    return {
      id: inv.id,
      number: inv.number,
      status: inv.status,
      warehouseId: inv.warehouseId,
      note: inv.note,
      createdAt: inv.createdAt.toISOString(),
      validatedAt: inv.validatedAt?.toISOString() ?? null,
      cancelledAt: inv.cancelledAt?.toISOString() ?? null,
      lines: inv.lines.map((l) => {
        const counted = qty(l.countedQtyBase.toString());
        const expected = l.expectedQtyBase
          ? qty(l.expectedQtyBase.toString())
          : (live.get(l.productId) ?? qty(0));
        return {
          productId: l.productId,
          reference: l.product.reference,
          designation: l.product.designation,
          countedQtyBase: toQtyString(counted),
          expectedQtyBase: toQtyString(expected),
          diffQtyBase: toQtyString(
            l.diffQtyBase ? l.diffQtyBase.toString() : counted.minus(expected),
          ),
        };
      }),
    };
  }

  /** Upserts counted quantities; a null quantity removes the line (draft data only). */
  async setLines(
    id: string,
    input: InventoryLinesInput,
    user: CurrentUserInfo,
  ): Promise<InventoryDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertInScope(tx, user, id);
      await this.lockOpen(tx, id);
      const toSet = input.lines.flatMap((l) =>
        l.qty !== null && l.unitId
          ? [{ productId: l.productId, unitId: l.unitId, qty: l.qty }]
          : [],
      );
      const toRemove = input.lines.filter((l) => l.qty === null).map((l) => l.productId);
      const converted = await toBaseLines(tx, toSet);
      const tenantId = tenantContext.requireTenantId();
      for (const c of converted) {
        await tx.inventoryLine.upsert({
          where: { inventoryId_productId: { inventoryId: id, productId: c.productId } },
          update: { countedQtyBase: c.qtyBase },
          create: { tenantId, inventoryId: id, productId: c.productId, countedQtyBase: c.qtyBase },
        });
      }
      if (toRemove.length > 0) {
        await tx.inventoryLine.deleteMany({
          where: { inventoryId: id, productId: { in: toRemove } },
        });
      }
    });
    return this.get(id);
  }

  async validate(id: string, user: CurrentUserInfo): Promise<InventoryDto> {
    requirePermission(user, Permission.STOCK_ADJUST, {
      message: 'You may not validate an inventory',
    });
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertInScope(tx, user, id);
      await this.lockOpen(tx, id);
      const inv = await tx.inventory.findUniqueOrThrow({
        where: { id },
        select: { warehouseId: true },
      });
      const warehouseId = inv.warehouseId ?? (await this.warehouses.defaultId(tx));
      const lines = await tx.inventoryLine.findMany({ where: { inventoryId: id } });
      // Lock the levels first so "expected" is exactly the dépôt stock the movements apply to.
      const levels = await this.stock.lockedLevels(
        tx,
        lines.map((l) => l.productId),
        warehouseId,
      );
      const diffs = lines.map((l) => {
        const expected = levels.get(l.productId)?.qty ?? qty(0);
        return { line: l, expected, diff: qty(l.countedQtyBase.toString()).minus(expected) };
      });
      await this.stock.applyMovements(
        tx,
        diffs
          .filter((d) => !d.diff.isZero())
          .map((d) => ({
            productId: d.line.productId,
            warehouseId,
            type: StockMovementType.INVENTORY,
            qtyBase: d.diff.toString(),
            refType: 'Inventory',
            refId: id,
          })),
      );
      for (const d of diffs) {
        await tx.inventoryLine.update({
          where: { id: d.line.id },
          data: { expectedQtyBase: d.expected.toString(), diffQtyBase: d.diff.toString() },
        });
      }
      await tx.inventory.update({
        where: { id },
        data: {
          status: InventoryStatus.VALIDATED,
          warehouseId,
          validatedAt: new Date(),
          validatedBy: tenantContext.get()?.userId ?? null,
        },
      });
      await this.audit.log(tx, {
        action: 'INVENTORY_VALIDATED',
        entity: 'Inventory',
        entityId: id,
        after: {
          lines: diffs.map((d) => ({
            productId: d.line.productId,
            expected: d.expected.toString(),
            counted: d.line.countedQtyBase.toString(),
            diff: d.diff.toString(),
          })),
        },
      });
    });
    return this.get(id);
  }

  async cancel(id: string, user: CurrentUserInfo): Promise<InventoryDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertInScope(tx, user, id);
      await this.lockOpen(tx, id);
      await tx.inventory.update({
        where: { id },
        data: { status: InventoryStatus.CANCELLED, cancelledAt: new Date() },
      });
      await this.audit.log(tx, {
        action: 'INVENTORY_CANCELLED',
        entity: 'Inventory',
        entityId: id,
      });
    });
    return this.get(id);
  }

  /** Counts of the dépôts the user works in (phase 24); one without a dépôt is MAIN's. */
  private async scopeWhere(user: CurrentUserInfo, db?: Tx): Promise<Prisma.InventoryWhereInput> {
    const scope = await this.scope.of(user, db);
    const w = this.scope.warehouseWhere(scope, scope.warehouseIds, 'createdBy');
    return w ? (w) : {};
  }

  private async assertInScope(tx: Tx, user: CurrentUserInfo, id: string): Promise<void> {
    const where = await this.scopeWhere(user, tx);
    if (Object.keys(where).length === 0) return;
    const found = await tx.inventory.findFirst({ where: { id, ...where }, select: { id: true } });
    if (!found) throw new AppException(ErrorCode.NOT_FOUND, 'Inventory not found');
  }

  /** Locks the inventory row and refuses anything but an open count. */
  private async lockOpen(tx: Tx, id: string): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM inventories
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Inventory not found');
    if (row.status !== InventoryStatus.OPEN) {
      throw new AppException(ErrorCode.INVENTORY_CLOSED, 'Inventory is closed', {
        status: row.status,
      });
    }
  }
}
