import { Injectable } from '@nestjs/common';
import {
  type AdjustmentReason,
  cump,
  cumpAfterValue,
  ErrorCode,
  money,
  NegativeStockMode,
  qty,
  type Qty,
  roundCost,
  StockMovementType,
  type StockWarning,
  toQtyString,
} from '@erp/shared';
import { AppException } from '../common/app-exception';
import { chunks } from '../common/chunks';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { type PrismaService, type Tx } from '../prisma/prisma.service';

export interface MovementInput {
  productId: string;
  /** The dépôt the goods enter or leave (phase 15); resolve it with WarehousesService. */
  warehouseId: string;
  type: StockMovementType;
  /** Signed quantity in the base unit: + enters, - leaves. */
  qtyBase: string;
  /** Cost of one base unit. Required for OPENING and PURCHASE entries. */
  unitCost?: string | null;
  /**
   * COST_ADJUST only (phase 22): stock value added (or removed) with `qtyBase` "0". The
   * caller computes it under this lock with `lockedLevels`; the CUMP moves by
   * valueDelta / stock, so the stock must be > 0.
   */
  valueDelta?: string | null;
  reason?: AdjustmentReason | null;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
}

export interface ApplyResult {
  movementIds: string[];
  warnings: StockWarning[];
}

/** Entries that must say what they cost (they define the CUMP). */
const COST_REQUIRED = new Set<StockMovementType>([
  StockMovementType.OPENING,
  StockMovementType.PURCHASE,
]);

interface Level {
  qty: Qty;
  avg: Qty;
  hasOpening: boolean;
}

/** Quantity of one product in one dépôt (the CUMP stays on the product level). */
interface WarehouseLevel {
  qty: Qty;
  isDefault: boolean;
}

const pairKey = (productId: string, warehouseId: string) => `${productId}:${warehouseId}`;

/**
 * Quantity of product `p` in warehouse `w` for reads, with aliases p (products),
 * w (warehouses), ws (its warehouse_stocks row, LEFT JOIN) and ps (product_stocks, LEFT
 * JOIN). A default dépôt without a row yet holds what is outside the other dépôts, the
 * same rule the first write applies (see lockWarehouseLevels).
 */
export function warehouseQtySql(tenantId: string, stockAlias = 'ps'): Prisma.Sql {
  return Prisma.sql`COALESCE(ws."qtyBase", CASE WHEN w."isDefault"
    THEN COALESCE(${Prisma.raw(`${stockAlias}."qtyBase"`)}, 0) - COALESCE((
      SELECT SUM(o."qtyBase") FROM warehouse_stocks o
      WHERE o."tenantId" = ${tenantId}::uuid AND o."productId" = p.id), 0)
    ELSE 0 END)`;
}

/**
 * The only way to change stock (AGENTS.md rules 1, 3, 10). Purchases, sales,
 * adjustments, inventories and transfers call `applyMovements` inside their own
 * transaction; nothing else writes stock_movements, product_stocks or warehouse_stocks.
 *
 * Phase 15: the quantity is also split per dépôt (WarehouseStock), always summing to
 * ProductStock.qtyBase; the CUMP stays per product. Lock order, in every path:
 * ProductStock rows by productId, then WarehouseStock rows by (productId, warehouseId).
 * negativeStockMode applies to the dépôt the goods leave.
 */
@Injectable()
export class StockService {
  async applyMovements(tx: Tx, movements: MovementInput[]): Promise<ApplyResult> {
    if (movements.length === 0) return { movementIds: [], warnings: [] };
    const tenantId = tenantContext.requireTenantId();
    const userId = tenantContext.get()?.userId ?? null;
    const productIds = [...new Set(movements.map((m) => m.productId))].sort();

    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, deletedAt: true },
    });
    if (products.length !== productIds.length) {
      throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Unknown product in stock movement');
    }
    const archived = products.find((p) => p.deletedAt);
    if (archived) {
      throw new AppException(ErrorCode.PRODUCT_ARCHIVED, 'Archived product', {
        productId: archived.id,
      });
    }

    const levels = await this.lockLevels(tx, tenantId, productIds);
    const places = await this.lockWarehouseLevels(
      tx,
      tenantId,
      movements.map((m) => ({ productId: m.productId, warehouseId: m.warehouseId })),
    );
    const { negativeStockMode } = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { negativeStockMode: true },
    });

    const warnings: StockWarning[] = [];
    const movementIds: string[] = [];
    for (const m of movements) {
      const level = levels.get(m.productId);
      if (!level) throw new Error(`stock level not locked for ${m.productId}`);
      const place = places.get(pairKey(m.productId, m.warehouseId));
      if (!place) throw new Error(`warehouse level not locked for ${m.productId}`);
      const delta = qty(m.qtyBase);
      if (m.type === StockMovementType.COST_ADJUST) {
        // A value change, not a quantity change: the only movement that is zero.
        if (!delta.isZero() || !m.valueDelta)
          throw new Error('COST_ADJUST needs qtyBase 0 and a valueDelta');
        if (level.qty.lte(0)) throw new Error('COST_ADJUST needs stock on hand');
        level.avg = cumpAfterValue(level.qty, level.avg, m.valueDelta);
        const row = await tx.stockMovement.create({
          data: {
            tenantId,
            productId: m.productId,
            type: m.type,
            qtyBase: '0',
            valueDelta: money(m.valueDelta).toString(),
            balanceAfter: level.qty.toString(),
            avgCostAfter: level.avg.toString(),
            refType: m.refType ?? null,
            refId: m.refId ?? null,
            note: m.note ?? null,
            createdBy: userId,
            warehouseId: m.warehouseId,
          },
          select: { id: true },
        });
        movementIds.push(row.id);
        continue;
      }
      if (delta.isZero()) throw new Error('A stock movement cannot be zero');

      if (m.type === StockMovementType.OPENING) {
        if (level.hasOpening) {
          throw new AppException(ErrorCode.OPENING_ALREADY_SET, 'Opening stock already set', {
            productId: m.productId,
          });
        }
        level.hasOpening = true;
      }

      let unitCost: string | null = null;
      if (delta.gt(0)) {
        if (COST_REQUIRED.has(m.type) && (m.unitCost === undefined || m.unitCost === null)) {
          throw new Error(`${m.type} entries need a unit cost`);
        }
        // Without an explicit cost (adjustment, inventory gain, return) the entry is
        // valued at the current CUMP, so the average does not move.
        const cost = m.unitCost ?? level.avg.toString();
        unitCost = roundCost(cost).toString();
        level.avg = cump(level.qty, level.avg, delta, cost);
        level.qty = level.qty.plus(delta);
        place.qty = place.qty.plus(delta);
      } else {
        // A transfer leaves at the CUMP it enters with (shown on the stock card).
        if (m.type === StockMovementType.TRANSFER_OUT) unitCost = roundCost(level.avg).toString();
        // The dépôt decides: 10 cartons in the dépôt do not cover a sale from an empty truck.
        const after = place.qty.plus(delta);
        if (after.isNegative()) {
          const warning: StockWarning = {
            productId: m.productId,
            available: toQtyString(place.qty),
            after: toQtyString(after),
            // Named only off the main dépôt, so single-dépôt tenants see what they always saw.
            ...(place.isDefault ? {} : { warehouseId: m.warehouseId }),
          };
          if (negativeStockMode === NegativeStockMode.BLOCK) {
            throw new AppException(ErrorCode.STOCK_INSUFFICIENT, 'Not enough stock', {
              ...warning,
              requested: toQtyString(delta.abs()),
            });
          }
          if (negativeStockMode === NegativeStockMode.WARN) warnings.push(warning);
        }
        place.qty = after;
        level.qty = level.qty.plus(delta);
      }

      const row = await tx.stockMovement.create({
        data: {
          tenantId,
          productId: m.productId,
          type: m.type,
          qtyBase: delta.toString(),
          unitCost,
          balanceAfter: level.qty.toString(),
          avgCostAfter: level.avg.toString(),
          reason: m.reason ?? null,
          refType: m.refType ?? null,
          refId: m.refId ?? null,
          note: m.note ?? null,
          createdBy: userId,
          warehouseId: m.warehouseId,
        },
        select: { id: true },
      });
      movementIds.push(row.id);
    }

    for (const [productId, level] of levels) {
      await tx.productStock.update({
        where: { productId },
        data: {
          qtyBase: level.qty.toString(),
          avgCost: level.avg.toString(),
          hasOpening: level.hasOpening,
        },
      });
    }
    for (const [key, place] of places) {
      const [productId, warehouseId] = key.split(':') as [string, string];
      await tx.$executeRaw`
        UPDATE warehouse_stocks SET "qtyBase" = ${place.qty.toString()}::numeric,
               "updatedAt" = CURRENT_TIMESTAMP
        WHERE "tenantId" = ${tenantId}::uuid AND "productId" = ${productId}::uuid
          AND "warehouseId" = ${warehouseId}::uuid`;
    }
    return { movementIds, warnings };
  }

  /**
   * Quantity and opening flag per product, without locking (import preview). Products
   * with no level row yet are absent: they have no stock and no opening.
   */
  async levelsSnapshot(
    tx: Tx,
    productIds: string[],
  ): Promise<Map<string, { qtyBase: string; hasOpening: boolean }>> {
    const out = new Map<string, { qtyBase: string; hasOpening: boolean }>();
    for (const chunk of chunks([...new Set(productIds)])) {
      const rows = await tx.productStock.findMany({
        where: { productId: { in: chunk } },
        select: { productId: true, qtyBase: true, hasOpening: true },
      });
      for (const r of rows) {
        out.set(r.productId, { qtyBase: toQtyString(r.qtyBase), hasOpening: r.hasOpening });
      }
    }
    return out;
  }

  /** Quantities of some products in one dépôt, without locking (display, open inventory). */
  async warehouseQuantities(
    db: Tx | PrismaService['db'],
    warehouseId: string,
    productIds: string[],
  ): Promise<Map<string, Qty>> {
    const out = new Map<string, Qty>();
    const tenantId = tenantContext.requireTenantId();
    for (const chunk of chunks([...new Set(productIds)])) {
      const rows = await db.$queryRaw<{ productId: string; qtyBase: Prisma.Decimal }[]>`
        SELECT p.id AS "productId", ${warehouseQtySql(tenantId)} AS "qtyBase"
        FROM products p
        JOIN warehouses w ON w.id = ${warehouseId}::uuid AND w."tenantId" = ${tenantId}::uuid
        LEFT JOIN warehouse_stocks ws ON ws."warehouseId" = w.id AND ws."productId" = p.id
        LEFT JOIN product_stocks ps ON ps."productId" = p.id AND ps."tenantId" = ${tenantId}::uuid
        WHERE p."tenantId" = ${tenantId}::uuid
          AND p.id IN (${Prisma.join(chunk.map((id) => Prisma.sql`${id}::uuid`))})`;
      for (const r of rows) out.set(r.productId, qty(r.qtyBase.toString()));
    }
    return out;
  }

  /**
   * Current levels, read under the same lock rules (for read-modify paths). With a
   * warehouseId, `qty` is that dépôt's quantity (inventory per dépôt); `avg` is always
   * the company CUMP.
   */
  async lockedLevels(
    tx: Tx,
    productIds: string[],
    warehouseId?: string,
  ): Promise<Map<string, Level>> {
    const tenantId = tenantContext.requireTenantId();
    const sorted = [...new Set(productIds)].sort();
    const levels = await this.lockLevels(tx, tenantId, sorted);
    if (!warehouseId) return levels;
    const places = await this.lockWarehouseLevels(
      tx,
      tenantId,
      sorted.map((productId) => ({ productId, warehouseId })),
    );
    for (const [productId, level] of levels) {
      const place = places.get(pairKey(productId, warehouseId));
      if (place) level.qty = place.qty;
    }
    return levels;
  }

  /**
   * Creates missing level rows, then locks every row with SELECT ... FOR UPDATE in
   * productId order, so two transactions touching the same products always lock
   * them in the same order (no deadlock) and the second waits for the first.
   */
  private async lockLevels(
    tx: Tx,
    tenantId: string,
    sortedIds: string[],
  ): Promise<Map<string, Level>> {
    for (const productId of sortedIds) {
      await tx.$executeRaw`
        INSERT INTO product_stocks ("id", "tenantId", "productId", "updatedAt")
        VALUES (gen_random_uuid(), ${tenantId}::uuid, ${productId}::uuid, CURRENT_TIMESTAMP)
        ON CONFLICT ("productId") DO NOTHING`;
    }
    const rows = await tx.$queryRaw<
      { productId: string; qtyBase: Prisma.Decimal; avgCost: Prisma.Decimal; hasOpening: boolean }[]
    >`
      SELECT "productId", "qtyBase", "avgCost", "hasOpening"
      FROM product_stocks
      WHERE "tenantId" = ${tenantId}::uuid
        AND "productId" IN (${Prisma.join(sortedIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "productId"
      FOR UPDATE`;
    if (rows.length !== sortedIds.length) {
      throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Stock level not found');
    }
    return new Map(
      rows.map((r) => [
        r.productId,
        {
          qty: qty(r.qtyBase.toString()),
          avg: qty(r.avgCost.toString()),
          hasOpening: r.hasOpening,
        },
      ]),
    );
  }

  /**
   * Called with the ProductStock rows already locked. Creates the missing dépôt rows,
   * then locks them all in (productId, warehouseId) order.
   *
   * A missing row of the default dépôt starts with what the product holds outside the
   * other dépôts (ProductStock − their sum): stock that existed before phase 15 is in
   * the main dépôt, and the sum always equals ProductStock, even before the backfill.
   * Any other dépôt starts at 0. Safe because the product row lock is held: nobody else
   * changes ProductStock or this product's dépôt rows meanwhile.
   */
  private async lockWarehouseLevels(
    tx: Tx,
    tenantId: string,
    pairs: { productId: string; warehouseId: string }[],
  ): Promise<Map<string, WarehouseLevel>> {
    const unique = [
      ...new Map(pairs.map((p) => [pairKey(p.productId, p.warehouseId), p])).values(),
    ].sort((a, b) => {
      const ka = pairKey(a.productId, a.warehouseId);
      const kb = pairKey(b.productId, b.warehouseId);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    for (const { productId, warehouseId } of unique) {
      await tx.$executeRaw`
        INSERT INTO warehouse_stocks ("id", "tenantId", "warehouseId", "productId", "qtyBase", "updatedAt")
        SELECT gen_random_uuid(), ${tenantId}::uuid, w.id, ${productId}::uuid,
               CASE WHEN w."isDefault"
                    THEN COALESCE(ps."qtyBase", 0) - COALESCE((
                      SELECT SUM(o."qtyBase") FROM warehouse_stocks o
                      WHERE o."tenantId" = ${tenantId}::uuid AND o."productId" = ${productId}::uuid), 0)
                    ELSE 0 END,
               CURRENT_TIMESTAMP
        FROM warehouses w
        LEFT JOIN product_stocks ps
          ON ps."tenantId" = ${tenantId}::uuid AND ps."productId" = ${productId}::uuid
        WHERE w.id = ${warehouseId}::uuid AND w."tenantId" = ${tenantId}::uuid
        ON CONFLICT ("warehouseId", "productId") DO NOTHING`;
    }
    const rows = await tx.$queryRaw<
      { productId: string; warehouseId: string; qtyBase: Prisma.Decimal; isDefault: boolean }[]
    >`
      SELECT ws."productId", ws."warehouseId", ws."qtyBase", w."isDefault"
      FROM warehouse_stocks ws
      JOIN warehouses w ON w.id = ws."warehouseId"
      WHERE ws."tenantId" = ${tenantId}::uuid
        AND (ws."productId", ws."warehouseId") IN (${Prisma.join(
          unique.map((p) => Prisma.sql`(${p.productId}::uuid, ${p.warehouseId}::uuid)`),
        )})
      ORDER BY ws."productId", ws."warehouseId"
      FOR UPDATE OF ws`;
    if (rows.length !== unique.length) {
      throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Unknown warehouse');
    }
    return new Map(
      rows.map((r) => [
        pairKey(r.productId, r.warehouseId),
        { qty: qty(r.qtyBase.toString()), isDefault: r.isDefault },
      ]),
    );
  }
}
