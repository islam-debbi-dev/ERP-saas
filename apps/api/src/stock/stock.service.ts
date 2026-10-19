import { Injectable } from '@nestjs/common';
import {
  type AdjustmentReason,
  cump,
  ErrorCode,
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
import { type Tx } from '../prisma/prisma.service';

export interface MovementInput {
  productId: string;
  type: StockMovementType;
  /** Signed quantity in the base unit: + enters, - leaves. */
  qtyBase: string;
  /** Cost of one base unit. Required for OPENING and PURCHASE entries. */
  unitCost?: string | null;
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

/**
 * The only way to change stock (AGENTS.md rules 1, 3, 10). Purchases, sales,
 * adjustments and inventories call `applyMovements` inside their own transaction;
 * nothing else writes stock_movements or product_stocks.
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
    const { negativeStockMode } = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { negativeStockMode: true },
    });

    const warnings: StockWarning[] = [];
    const movementIds: string[] = [];
    for (const m of movements) {
      const level = levels.get(m.productId);
      if (!level) throw new Error(`stock level not locked for ${m.productId}`);
      const delta = qty(m.qtyBase);
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
      } else {
        const after = level.qty.plus(delta);
        if (after.isNegative()) {
          const warning = {
            productId: m.productId,
            available: toQtyString(level.qty),
            after: toQtyString(after),
          };
          if (negativeStockMode === NegativeStockMode.BLOCK) {
            throw new AppException(ErrorCode.STOCK_INSUFFICIENT, 'Not enough stock', {
              ...warning,
              requested: toQtyString(delta.abs()),
            });
          }
          if (negativeStockMode === NegativeStockMode.WARN) warnings.push(warning);
        }
        level.qty = after;
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

  /** Current level of one product, read under the same lock rules (for read-modify paths). */
  async lockedLevels(tx: Tx, productIds: string[]): Promise<Map<string, Level>> {
    return this.lockLevels(tx, tenantContext.requireTenantId(), [...new Set(productIds)].sort());
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
}
