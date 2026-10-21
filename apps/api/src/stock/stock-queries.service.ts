import { Injectable } from '@nestjs/common';
import {
  type CursorQuery,
  cump,
  ErrorCode,
  qty,
  type ReconcileReport,
  type StockLevelDto,
  type StockListQuery,
  type StockMovementPage,
  type StockPage,
  stockValue,
  toMoneyString,
  toQtyString,
} from '@erp/shared';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Raw numeric columns come back as Prisma.Decimal. */
type Dec = Prisma.Decimal | number;

interface LevelRow {
  id: string;
  reference: string;
  designation: string;
  baseUnitId: string;
  minStock: Dec;
  qtyBase: Dec;
  avgCost: Dec;
  hasOpening: boolean;
}

const COST_TOLERANCE = qty('0.0001');

@Injectable()
export class StockQueriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Live products with their level. Raw SQL because "qty <= minStock" compares two
   * columns; tenantId is passed explicitly (raw SQL bypasses the tenant extension).
   */
  async list(query: StockListQuery): Promise<StockPage> {
    const tenantId = tenantContext.requireTenantId();
    const search = query.search?.trim();
    const filters: Prisma.Sql[] = [
      Prisma.sql`p."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`p."deletedAt" IS NULL`,
    ];
    if (search) {
      const like = `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      filters.push(Prisma.sql`(
        p.reference ILIKE ${like} OR p.designation ILIKE ${like}
        OR EXISTS (SELECT 1 FROM product_units pu
                   WHERE pu."productId" = p.id AND pu.barcode = ${search} AND pu."deletedAt" IS NULL))`);
    }
    if (query.lowStock) filters.push(Prisma.sql`COALESCE(s."qtyBase", 0) <= p."minStock"`);
    if (query.outOfStock) filters.push(Prisma.sql`COALESCE(s."qtyBase", 0) <= 0`);
    const where = Prisma.join(filters, ' AND ');
    const cursor = query.cursor
      ? Prisma.sql`AND (p.designation, p.id) > (
          SELECT c.designation, c.id FROM products c
          WHERE c.id = ${query.cursor}::uuid AND c."tenantId" = ${tenantId}::uuid)`
      : Prisma.empty;

    const rows = await this.prisma.db.$queryRaw<LevelRow[]>`
      SELECT p.id, p.reference, p.designation, p."baseUnitId", p."minStock",
             COALESCE(s."qtyBase", 0) AS "qtyBase", COALESCE(s."avgCost", 0) AS "avgCost",
             COALESCE(s."hasOpening", false) AS "hasOpening"
      FROM products p
      LEFT JOIN product_stocks s ON s."productId" = p.id
      WHERE ${where} ${cursor}
      ORDER BY p.designation, p.id
      LIMIT ${query.limit + 1}`;

    const [summary] = await this.prisma.db.$queryRaw<
      { totalValue: Dec; lowStockCount: bigint; productCount: bigint }[]
    >`
      SELECT COALESCE(SUM(CASE WHEN s."qtyBase" > 0 THEN ROUND(s."qtyBase" * s."avgCost", 2) ELSE 0 END), 0) AS "totalValue",
             COUNT(*) FILTER (WHERE COALESCE(s."qtyBase", 0) <= p."minStock") AS "lowStockCount",
             COUNT(*) AS "productCount"
      FROM products p
      LEFT JOIN product_stocks s ON s."productId" = p.id
      WHERE p."tenantId" = ${tenantId}::uuid AND p."deletedAt" IS NULL`;

    const page = rows.slice(0, query.limit);
    const items = await this.withUnits(page);
    return {
      items,
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      summary: {
        totalValue: toMoneyString((summary?.totalValue ?? 0).toString()),
        lowStockCount: Number(summary?.lowStockCount ?? 0),
        productCount: Number(summary?.productCount ?? 0),
      },
    };
  }

  /** Dashboard figures, with the stock page's own definitions (stock bas includes rupture). */
  async dashboardSummary(): Promise<{ outOfStock: number; lowStock: number; value: string }> {
    const tenantId = tenantContext.requireTenantId();
    const [row] = await this.prisma.db.$queryRaw<
      { value: Dec; lowStock: bigint; outOfStock: bigint }[]
    >`
      SELECT COALESCE(SUM(CASE WHEN s."qtyBase" > 0 THEN ROUND(s."qtyBase" * s."avgCost", 2) ELSE 0 END), 0) AS value,
             COUNT(*) FILTER (WHERE COALESCE(s."qtyBase", 0) <= p."minStock") AS "lowStock",
             COUNT(*) FILTER (WHERE COALESCE(s."qtyBase", 0) <= 0) AS "outOfStock"
      FROM products p
      LEFT JOIN product_stocks s ON s."productId" = p.id
      WHERE p."tenantId" = ${tenantId}::uuid AND p."deletedAt" IS NULL`;
    return {
      value: toMoneyString((row?.value ?? 0).toString()),
      lowStock: Number(row?.lowStock ?? 0),
      outOfStock: Number(row?.outOfStock ?? 0),
    };
  }

  async level(productId: string): Promise<StockLevelDto> {
    const product = await this.prisma.db.product.findUnique({
      where: { id: productId },
      include: { stock: true },
    });
    if (!product) throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
    const [item] = await this.withUnits([
      {
        id: product.id,
        reference: product.reference,
        designation: product.designation,
        baseUnitId: product.baseUnitId,
        minStock: product.minStock,
        qtyBase: product.stock?.qtyBase ?? 0,
        avgCost: product.stock?.avgCost ?? 0,
        hasOpening: product.stock?.hasOpening ?? false,
      },
    ]);
    if (!item) throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
    return item;
  }

  /** Stock card: newest first, each row with the balance right after it. */
  async movements(productId: string, query: CursorQuery): Promise<StockMovementPage> {
    const product = await this.prisma.db.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
    const rows = await this.prisma.db.stockMovement.findMany({
      where: { productId },
      orderBy: { seq: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    const userIds = [
      ...new Set(page.map((m) => m.createdBy).filter((id): id is string => Boolean(id))),
    ];
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      items: page.map((m) => ({
        id: m.id,
        type: m.type,
        qtyBase: toQtyString(m.qtyBase.toString()),
        unitCost: m.unitCost?.toFixed(4) ?? null,
        balanceAfter: toQtyString(m.balanceAfter.toString()),
        avgCostAfter: m.avgCostAfter.toFixed(4),
        reason: m.reason,
        refType: m.refType,
        refId: m.refId,
        note: m.note,
        createdBy: m.createdBy ? (byId.get(m.createdBy) ?? null) : null,
        createdAt: m.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Replays the ledger of every product and compares it with the cache and with the
   * balance stored on each movement. An empty `differences` list means they agree.
   */
  async reconcile(): Promise<ReconcileReport> {
    const levels = await this.prisma.db.productStock.findMany({
      select: { productId: true, qtyBase: true, avgCost: true },
    });
    const differences: ReconcileReport['differences'] = [];
    for (const level of levels) {
      const movements = await this.prisma.db.stockMovement.findMany({
        where: { productId: level.productId },
        orderBy: { seq: 'asc' },
        select: { id: true, qtyBase: true, unitCost: true, balanceAfter: true, avgCostAfter: true },
      });
      let q = qty(0);
      let avg = qty(0);
      let brokenChainAt: string | null = null;
      for (const m of movements) {
        const delta = qty(m.qtyBase.toString());
        if (delta.gt(0)) avg = cump(q, avg, delta, m.unitCost?.toString() ?? avg.toString());
        q = q.plus(delta);
        if (
          !brokenChainAt &&
          (!q.eq(m.balanceAfter.toString()) ||
            avg.minus(m.avgCostAfter.toString()).abs().gt(COST_TOLERANCE))
        ) {
          brokenChainAt = m.id;
        }
      }
      const qtyDiffers = !q.eq(level.qtyBase.toString());
      const avgDiffers = avg.minus(level.avgCost.toString()).abs().gt(COST_TOLERANCE);
      if (qtyDiffers || avgDiffers || brokenChainAt) {
        differences.push({
          productId: level.productId,
          cachedQty: toQtyString(level.qtyBase.toString()),
          ledgerQty: toQtyString(q),
          cachedAvgCost: level.avgCost.toFixed(4),
          ledgerAvgCost: avg.toFixed(4),
          brokenChainAt,
        });
      }
    }
    return { checkedProducts: levels.length, differences };
  }

  /** Adds the base unit and the largest packaging unit to level rows. */
  private async withUnits(rows: LevelRow[]): Promise<StockLevelDto[]> {
    if (rows.length === 0) return [];
    const units = await this.prisma.db.productUnit.findMany({
      where: { productId: { in: rows.map((r) => r.id) }, deletedAt: null },
      include: { unit: true },
    });
    return rows.map((r) => {
      const own = units.filter((u) => u.productId === r.id);
      const base = own.find((u) => u.unitId === r.baseUnitId);
      const biggest = own
        .filter((u) => u.unitId !== r.baseUnitId)
        .sort((a, b) => (b.factorToBase.gt(a.factorToBase) ? 1 : -1))[0];
      const qtyBase = r.qtyBase.toString();
      const avgCost = r.avgCost.toString();
      return {
        productId: r.id,
        reference: r.reference,
        designation: r.designation,
        baseUnitId: r.baseUnitId,
        minStock: toQtyString(r.minStock.toString()),
        qtyBase: toQtyString(qtyBase),
        avgCost: qty(avgCost).toFixed(4),
        value: toMoneyString(stockValue(qtyBase, avgCost)),
        lowStock: qty(qtyBase).lte(r.minStock.toString()),
        hasOpening: r.hasOpening,
        packaging: biggest
          ? {
              unitId: biggest.unitId,
              unitCode: biggest.unit.code,
              unitName: biggest.unit.name,
              factorToBase: toQtyString(biggest.factorToBase.toString()),
            }
          : null,
        baseUnit: {
          unitCode: base?.unit.code ?? '',
          unitName: base?.unit.name ?? null,
          allowsDecimal: base?.unit.allowsDecimal ?? false,
        },
      };
    });
  }
}
