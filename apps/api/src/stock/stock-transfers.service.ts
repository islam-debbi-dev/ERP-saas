import { Injectable } from '@nestjs/common';
import {
  algiersDayBounds,
  type CreateStockTransferInput,
  type MeDayTransferDto,
  DocType,
  ErrorCode,
  type StockTransferDto,
  type StockTransferListQuery,
  type StockTransferPage,
  type StockTransferResultDto,
  StockTransferStatus,
  StockTransferType,
  StockMovementType,
  type StockWarning,
  toQtyString,
  type UpdateStockTransferInput,
  WarehouseType,
  addDays,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { freezeLineWeights } from '../common/line-weight';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { type Prisma } from '../generated/prisma/client';
import { algiersMidnight } from '../common/algiers';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { type MovementInput, StockService } from './stock.service';
import { toBaseLines } from './unit-conversion';
import { WarehousesService } from './warehouses.service';

export type TransferResult = StockTransferResultDto;

/** What a transfer DTO is built from: header, warehouses, lines with the product names. */
const transferInclude = {
  fromWarehouse: { select: { id: true, name: true, type: true } },
  toWarehouse: { select: { id: true, name: true, type: true } },
  lines: {
    orderBy: { createdAt: 'asc' },
    include: { product: { select: { reference: true, designation: true } } },
  },
} satisfies Prisma.StockTransferInclude;

type TransferRow = Prisma.StockTransferGetPayload<{ include: typeof transferInclude }>;

/** LOAD fills a truck, UNLOAD empties one, TRANSFER is anything else. */
export function transferTypeOf(fromType: WarehouseType, toType: WarehouseType): StockTransferType {
  const fromTruck = fromType === WarehouseType.VEHICLE;
  const toTruck = toType === WarehouseType.VEHICLE;
  if (toTruck && !fromTruck) return StockTransferType.LOAD;
  if (fromTruck && !toTruck) return StockTransferType.UNLOAD;
  return StockTransferType.TRANSFER;
}

/**
 * Chargement / déchargement / transfert (phase 15). A draft has no effect. Validation is
 * one transaction: a TRANSFER_OUT and a TRANSFER_IN per line at the current CUMP (the
 * company stock and the CUMP do not move), both dépôt levels, the TR number and the audit.
 * Cancelling a validated transfer writes the reverse movements; nothing is ever deleted.
 */
@Injectable()
export class StockTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly numbering: DocumentNumberingService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  async create(input: CreateStockTransferInput, user: CurrentUserInfo): Promise<StockTransferDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const header = await this.checkHeader(tx, input);
      // Phase 24: goods leave a dépôt the user works in.
      await this.scope.assertWarehouse(tx, user, header.fromWarehouseId);
      const lines = await this.convert(tx, input);
      const tenantId = tenantContext.requireTenantId();
      const transfer = await tx.stockTransfer.create({
        data: {
          tenantId,
          ...header,
          note: input.note ?? null,
          createdBy: tenantContext.get()?.userId ?? null,
        },
      });
      await this.writeLines(tx, transfer.id, lines);
      await this.audit.log(tx, {
        action: 'STOCK_TRANSFER_CREATED',
        entity: 'StockTransfer',
        entityId: transfer.id,
        after: { ...header, lines: input.lines },
      });
      return transfer.id;
    });
    return this.get(id);
  }

  /** Replaces the whole draft. */
  async update(
    id: string,
    input: UpdateStockTransferInput,
    user: CurrentUserInfo,
  ): Promise<StockTransferDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertInScope(tx, user, id);
      await this.lock(tx, id, StockTransferStatus.DRAFT);
      const header = await this.checkHeader(tx, input);
      await this.scope.assertWarehouse(tx, user, header.fromWarehouseId);
      const lines = await this.convert(tx, input);
      // Draft lines have no effect anywhere, so they are simply replaced.
      await tx.stockTransferLine.deleteMany({ where: { transferId: id } });
      await this.writeLines(tx, id, lines);
      await tx.stockTransfer.update({
        where: { id },
        data: { ...header, note: input.note ?? null },
      });
      await this.audit.log(tx, {
        action: 'STOCK_TRANSFER_UPDATED',
        entity: 'StockTransfer',
        entityId: id,
        after: { ...header, lines: input.lines },
      });
    });
    return this.get(id);
  }

  async validate(id: string, user: CurrentUserInfo): Promise<TransferResult> {
    const warnings = await this.prisma.db.$transaction(async (tx) => {
      await this.assertInScope(tx, user, id);
      await this.lock(tx, id, StockTransferStatus.DRAFT);
      const t = await tx.stockTransfer.findUniqueOrThrow({
        where: { id },
        include: { lines: true },
      });
      if (t.lines.length === 0) throw new AppException(ErrorCode.TRANSFER_EMPTY, 'No lines');
      // Both dépôts must still be live (and allowed) at validation.
      await this.checkHeader(tx, {
        fromWarehouseId: t.fromWarehouseId,
        toWarehouseId: t.toWarehouseId,
        type: t.type,
      });
      const number = await this.numbering.next(tx, tenantContext.requireTenantId(), DocType.TR);
      const moved = await this.move(tx, {
        lines: t.lines,
        from: t.fromWarehouseId,
        to: t.toWarehouseId,
        refId: id,
        note: number,
      });
      await freezeLineWeights(tx, 'transfer', id);
      const userId = tenantContext.get()?.userId ?? null;
      await tx.stockTransfer.update({
        where: { id },
        data: {
          number,
          status: StockTransferStatus.VALIDATED,
          validatedAt: new Date(),
          validatedBy: userId,
        },
      });
      await this.audit.log(tx, {
        action: 'STOCK_TRANSFER_VALIDATED',
        entity: 'StockTransfer',
        entityId: id,
        after: { number, movementIds: moved.movementIds },
      });
      return moved.warnings;
    });
    return { transfer: await this.get(id), warnings };
  }

  /**
   * A draft is abandoned. A validated transfer is reversed: the goods go back from the
   * destination to the source, under the same negative-stock rule as any exit (a truck
   * that already sold the goods cannot give them back under BLOCK).
   */
  async cancel(id: string, reason: string, user: CurrentUserInfo): Promise<TransferResult> {
    const warnings = await this.prisma.db.$transaction(async (tx) => {
      await this.assertInScope(tx, user, id);
      const status = await this.lock(tx, id);
      if (status === StockTransferStatus.CANCELLED) {
        throw new AppException(ErrorCode.TRANSFER_NOT_VALIDATED, 'Already cancelled');
      }
      const t = await tx.stockTransfer.findUniqueOrThrow({
        where: { id },
        include: { lines: true },
      });
      let result: { movementIds: string[]; warnings: StockWarning[] } = {
        movementIds: [],
        warnings: [],
      };
      if (status === StockTransferStatus.VALIDATED) {
        result = await this.move(tx, {
          lines: t.lines,
          from: t.toWarehouseId,
          to: t.fromWarehouseId,
          refId: id,
          note: t.number,
        });
      }
      await tx.stockTransfer.update({
        where: { id },
        data: {
          status: StockTransferStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: tenantContext.get()?.userId ?? null,
          cancelReason: reason,
        },
      });
      await this.audit.log(tx, {
        action: 'STOCK_TRANSFER_CANCELLED',
        entity: 'StockTransfer',
        entityId: id,
        before: { status },
        after: { reason, movementIds: result.movementIds },
      });
      return result.warnings;
    });
    return { transfer: await this.get(id), warnings };
  }

  async list(query: StockTransferListQuery, user: CurrentUserInfo): Promise<StockTransferPage> {
    const rows = await this.prisma.db.stockTransfer.findMany({
      where: {
        AND: [
          await this.visibleWhere(user),
          query.warehouseId
            ? {
                OR: [{ fromWarehouseId: query.warehouseId }, { toWarehouseId: query.warehouseId }],
              }
            : {},
          query.type ? { type: query.type } : {},
          query.toWarehouseId ? { toWarehouseId: query.toWarehouseId } : {},
          query.status ? { status: query.status } : {},
          query.from || query.to
            ? {
                validatedAt: {
                  ...(query.from ? { gte: algiersMidnight(query.from) } : {}),
                  ...(query.to ? { lt: algiersMidnight(addDays(query.to, 1)) } : {}),
                },
              }
            : {},
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        fromWarehouse: { select: { id: true, name: true } },
        toWarehouse: { select: { id: true, name: true } },
        _count: { select: { lines: true } },
      },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((t) => ({
        id: t.id,
        number: t.number,
        type: t.type,
        status: t.status,
        from: t.fromWarehouse,
        to: t.toWarehouse,
        lineCount: t._count.lines,
        createdAt: t.createdAt.toISOString(),
        validatedAt: t.validatedAt?.toISOString() ?? null,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(id: string, user?: CurrentUserInfo): Promise<StockTransferDto> {
    const t = await this.prisma.db.stockTransfer.findFirst({
      where: { id, ...(user ? await this.visibleWhere(user) : {}) },
      include: transferInclude,
    });
    if (!t) throw new AppException(ErrorCode.NOT_FOUND, 'Transfer not found');
    const creator = t.createdBy
      ? await this.prisma.db.user.findUnique({
          where: { id: t.createdBy },
          select: { id: true, fullName: true },
        })
      : null;
    const [dto] = await this.toDtos([t]);
    return { ...dto!, createdBy: creator };
  }

  /**
   * Today's validated chargements / déchargements of one truck (phase 39, A2: the road
   * roles' "Mon camion"). Quantities only: the lines carry no cost or value, and none is
   * read here. The caller decides who may see which truck.
   */
  async validatedForVehicle(vehicleId: string, day: string): Promise<MeDayTransferDto[]> {
    const { start, end } = algiersDayBounds(day);
    const rows = await this.prisma.db.stockTransfer.findMany({
      where: {
        status: StockTransferStatus.VALIDATED,
        type: { in: [StockTransferType.LOAD, StockTransferType.UNLOAD] },
        OR: [{ fromWarehouseId: vehicleId }, { toWarehouseId: vehicleId }],
        validatedAt: { gte: start, lt: end },
      },
      orderBy: [{ validatedAt: 'asc' }, { id: 'asc' }],
      include: transferInclude,
    });
    const dtos = await this.toDtos(rows);
    return dtos.map((t) => ({
      id: t.id,
      number: t.number,
      type: t.type as MeDayTransferDto['type'],
      validatedAt: t.validatedAt!,
      from: { id: t.from.id, name: t.from.name },
      to: { id: t.to.id, name: t.to.name },
      lines: t.lines,
    }));
  }

  /** Header and lines of transfers (unit codes read once); `createdBy` left null. */
  private async toDtos(rows: TransferRow[]): Promise<StockTransferDto[]> {
    const unitIds = [...new Set(rows.flatMap((t) => t.lines.map((l) => l.unitId)))];
    const units = unitIds.length
      ? await this.prisma.db.unit.findMany({
          where: { id: { in: unitIds } },
          select: { id: true, code: true },
        })
      : [];
    const unitCode = new Map(units.map((u) => [u.id, u.code]));
    return rows.map((t) => ({
      id: t.id,
      number: t.number,
      type: t.type,
      status: t.status,
      from: t.fromWarehouse,
      to: t.toWarehouse,
      note: t.note,
      cancelReason: t.cancelReason,
      createdBy: null,
      createdAt: t.createdAt.toISOString(),
      validatedAt: t.validatedAt?.toISOString() ?? null,
      cancelledAt: t.cancelledAt?.toISOString() ?? null,
      lines: t.lines.map((l) => ({
        productId: l.productId,
        reference: l.product.reference,
        designation: l.product.designation,
        unitId: l.unitId,
        unitCode: unitCode.get(l.unitId) ?? '',
        qty: toQtyString(l.qty.toString()),
        qtyBase: toQtyString(l.qtyBase.toString()),
      })),
    }));
  }

  /**
   * TRANSFER_OUT then TRANSFER_IN per line, both at the CUMP read under the product lock:
   * the entry is valued at the average, so the average does not move.
   */
  /** Transfers in or out of a dépôt the user works in (phase 24). */
  private async visibleWhere(
    user: CurrentUserInfo,
    db?: Tx,
  ): Promise<Prisma.StockTransferWhereInput> {
    const { warehouseIds } = await this.scope.warehouses(user, db);
    if (!warehouseIds) return {};
    return {
      OR: [{ fromWarehouseId: { in: warehouseIds } }, { toWarehouseId: { in: warehouseIds } }],
    };
  }

  /** A transfer is changed by someone who works where its goods leave from (phase 24). */
  private async assertInScope(tx: Tx, user: CurrentUserInfo, id: string): Promise<void> {
    const { warehouseIds } = await this.scope.warehouses(user, tx);
    if (!warehouseIds) return;
    const t = await tx.stockTransfer.findFirst({
      where: { id, fromWarehouseId: { in: warehouseIds } },
      select: { id: true },
    });
    if (!t) throw new AppException(ErrorCode.NOT_FOUND, 'Transfer not found');
  }

  private async move(
    tx: Tx,
    t: {
      lines: { productId: string; qtyBase: { toString(): string } }[];
      from: string;
      to: string;
      refId: string;
      note: string | null;
    },
  ): Promise<{ movementIds: string[]; warnings: StockWarning[] }> {
    const levels = await this.stock.lockedLevels(
      tx,
      t.lines.map((l) => l.productId),
    );
    const movements: MovementInput[] = t.lines.flatMap((l) => {
      const q = toQtyString(l.qtyBase.toString());
      const cost = levels.get(l.productId)?.avg.toString() ?? '0';
      const base = {
        productId: l.productId,
        refType: 'StockTransfer',
        refId: t.refId,
        note: t.note,
      };
      return [
        {
          ...base,
          warehouseId: t.from,
          type: StockMovementType.TRANSFER_OUT,
          qtyBase: `-${q}`,
        },
        {
          ...base,
          warehouseId: t.to,
          type: StockMovementType.TRANSFER_IN,
          qtyBase: q,
          unitCost: cost,
        },
      ];
    });
    return this.stock.applyMovements(tx, movements);
  }

  /** Both dépôts live and distinct, and the type matches them (LOAD needs a truck...). */
  private async checkHeader(
    tx: Tx,
    input: Pick<CreateStockTransferInput, 'type' | 'fromWarehouseId' | 'toWarehouseId'>,
  ): Promise<{ type: StockTransferType; fromWarehouseId: string; toWarehouseId: string }> {
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'Same dépôt on both sides', {
        rule: 'same_warehouse',
      });
    }
    const from = await this.warehouses.resolve(tx, input.fromWarehouseId);
    const to = await this.warehouses.resolve(tx, input.toWarehouseId);
    const types = await tx.warehouse.findMany({
      where: { id: { in: [from, to] } },
      select: { id: true, type: true },
    });
    const typeOf = new Map(types.map((w) => [w.id, w.type]));
    const expected = transferTypeOf(typeOf.get(from)!, typeOf.get(to)!);
    if (expected !== input.type) {
      throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'Type does not match the dépôts', {
        rule: 'type_mismatch',
        expected,
      });
    }
    return { type: input.type, fromWarehouseId: from, toWarehouseId: to };
  }

  private async convert(tx: Tx, input: CreateStockTransferInput) {
    const converted = await toBaseLines(tx, input.lines);
    return input.lines.map((l, i) => ({ ...l, qtyBase: converted[i]!.qtyBase }));
  }

  private async writeLines(
    tx: Tx,
    transferId: string,
    lines: { productId: string; unitId: string; qty: string; qtyBase: string }[],
  ): Promise<void> {
    if (lines.length === 0) return;
    const tenantId = tenantContext.requireTenantId();
    await tx.stockTransferLine.createMany({
      data: lines.map((l) => ({ ...l, tenantId, transferId })),
    });
  }

  /** Locks the transfer row; with `expected`, refuses any other status. */
  private async lock(
    tx: Tx,
    id: string,
    expected?: StockTransferStatus,
  ): Promise<StockTransferStatus> {
    const rows = await tx.$queryRaw<{ status: StockTransferStatus }[]>`
      SELECT status FROM stock_transfers
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Transfer not found');
    if (expected && row.status !== expected) {
      throw new AppException(ErrorCode.TRANSFER_NOT_DRAFT, 'Only a draft can be changed', {
        status: row.status,
      });
    }
    return row.status;
  }
}
