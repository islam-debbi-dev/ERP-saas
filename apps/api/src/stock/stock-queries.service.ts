import { Injectable } from '@nestjs/common';
import {
  cump,
  cumpAfterValue,
  ErrorCode,
  qty,
  type ReconcileReport,
  type StockLevelDto,
  type MovementQuery,
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
import { warehouseQtySql } from './stock.service';

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
  /**
   * `reach` (phase 24): the dépôts the user works in, null = all. A user who works in some
   * dépôts sees their quantities only; a `warehouseId` outside them gives an empty page.
   */
  async list(
    query: StockListQuery,
    showCost: boolean,
    withWarehouses = false,
    reach: string[] | null = null,
  ): Promise<StockPage> {
    const tenantId = tenantContext.requireTenantId();
    const search = query.search?.trim();
    const ids = query.warehouseId
      ? reach === null || reach.includes(query.warehouseId)
        ? [query.warehouseId]
        : []
      : reach;
    if (ids && ids.length === 0) {
      return {
        items: [],
        nextCursor: null,
        summary: { totalValue: null, lowStockCount: 0, productCount: 0 },
      };
    }
    // One dépôt: its quantity replaces the company total (filters and value included);
    // several: their sum.
    const wh =
      ids && ids.length === 1
        ? {
            join: Prisma.sql`
            JOIN warehouses w ON w.id = ${ids[0]}::uuid AND w."tenantId" = ${tenantId}::uuid
            LEFT JOIN warehouse_stocks ws ON ws."warehouseId" = w.id AND ws."productId" = p.id`,
            qty: warehouseQtySql(tenantId, 's'),
          }
        : ids
          ? {
              join: Prisma.empty,
              qty: Prisma.sql`(SELECT COALESCE(SUM(${warehouseQtySql(tenantId, 's')}), 0)
                FROM warehouses w
                LEFT JOIN warehouse_stocks ws ON ws."warehouseId" = w.id AND ws."productId" = p.id
                WHERE w."tenantId" = ${tenantId}::uuid AND w.id = ANY(${ids}::uuid[]))`,
            }
          : { join: Prisma.empty, qty: Prisma.sql`COALESCE(s."qtyBase", 0)` };
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
    if (query.lowStock) filters.push(Prisma.sql`${wh.qty} <= p."minStock"`);
    if (query.outOfStock) filters.push(Prisma.sql`${wh.qty} <= 0`);
    const where = Prisma.join(filters, ' AND ');
    const cursor = query.cursor
      ? Prisma.sql`AND (p.designation, p.id) > (
          SELECT c.designation, c.id FROM products c
          WHERE c.id = ${query.cursor}::uuid AND c."tenantId" = ${tenantId}::uuid)`
      : Prisma.empty;

    const rows = await this.prisma.db.$queryRaw<LevelRow[]>`
      SELECT p.id, p.reference, p.designation, p."baseUnitId", p."minStock",
             ${wh.qty} AS "qtyBase", COALESCE(s."avgCost", 0) AS "avgCost",
             COALESCE(s."hasOpening", false) AS "hasOpening"
      FROM products p
      LEFT JOIN product_stocks s ON s."productId" = p.id
      ${wh.join}
      WHERE ${where} ${cursor}
      ORDER BY p.designation, p.id
      LIMIT ${query.limit + 1}`;

    const [summary] = await this.prisma.db.$queryRaw<
      { totalValue: Dec; lowStockCount: bigint; productCount: bigint }[]
    >`
      SELECT COALESCE(SUM(CASE WHEN ${wh.qty} > 0 THEN ROUND(${wh.qty} * s."avgCost", 2) ELSE 0 END), 0) AS "totalValue",
             COUNT(*) FILTER (WHERE ${wh.qty} <= p."minStock") AS "lowStockCount",
             COUNT(*) AS "productCount"
      FROM products p
      LEFT JOIN product_stocks s ON s."productId" = p.id
      ${wh.join}
      WHERE p."tenantId" = ${tenantId}::uuid AND p."deletedAt" IS NULL`;

    const page = rows.slice(0, query.limit);
    const items = await this.withUnits(page, showCost);
    if (withWarehouses || reach) await this.addSplit(items, reach);
    return {
      items,
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      summary: {
        totalValue: showCost ? toMoneyString((summary?.totalValue ?? 0).toString()) : null,
        lowStockCount: Number(summary?.lowStockCount ?? 0),
        productCount: Number(summary?.productCount ?? 0),
      },
    };
  }

  /** Dashboard figures, with the stock page's own definitions (stock bas includes rupture). */
  async dashboardSummary(
    showCost: boolean,
    warehouseIds: string[] | null = null,
  ): Promise<{ outOfStock: number; lowStock: number; value: string | null }> {
    const tenantId = tenantContext.requireTenantId();
    // Phase 24: the stock of the dépôts whose figures the user sees.
    const q = warehouseIds
      ? Prisma.sql`(SELECT COALESCE(SUM(${warehouseQtySql(tenantId, 's')}), 0)
          FROM warehouses w
          LEFT JOIN warehouse_stocks ws ON ws."warehouseId" = w.id AND ws."productId" = p.id
          WHERE w."tenantId" = ${tenantId}::uuid AND w.id = ANY(${warehouseIds}::uuid[]))`
      : Prisma.sql`COALESCE(s."qtyBase", 0)`;
    const [row] = await this.prisma.db.$queryRaw<
      { value: Dec; lowStock: bigint; outOfStock: bigint }[]
    >`
      SELECT COALESCE(SUM(CASE WHEN ${q} > 0 THEN ROUND(${q} * s."avgCost", 2) ELSE 0 END), 0) AS value,
             COUNT(*) FILTER (WHERE ${q} <= p."minStock") AS "lowStock",
             COUNT(*) FILTER (WHERE ${q} <= 0) AS "outOfStock"
      FROM products p
      LEFT JOIN product_stocks s ON s."productId" = p.id
      WHERE p."tenantId" = ${tenantId}::uuid AND p."deletedAt" IS NULL`;
    return {
      value: showCost ? toMoneyString((row?.value ?? 0).toString()) : null,
      lowStock: Number(row?.lowStock ?? 0),
      outOfStock: Number(row?.outOfStock ?? 0),
    };
  }

  /**
   * `dashboardSummary` for each dépôt (phase 26): a dépôt's stock includes its trucks'.
   * One pass over products × warehouses in reach (null = all).
   */
  async summaryByUnit(
    showCost: boolean,
    warehouseIds: string[] | null,
  ): Promise<Map<string, { lowStock: number; value: string | null }>> {
    const tenantId = tenantContext.requireTenantId();
    const rows = await this.prisma.db.$queryRaw<{ unitId: string; value: Dec; lowStock: bigint }[]>`
      SELECT q."unitId", COALESCE(SUM(CASE WHEN q.qty > 0 THEN ROUND(q.qty * q."avgCost", 2) ELSE 0 END), 0) AS value,
             COUNT(*) FILTER (WHERE q.qty <= q."minStock") AS "lowStock"
      FROM (
        SELECT CASE WHEN w.type = 'VEHICLE' AND w."parentWarehouseId" IS NOT NULL
                    THEN w."parentWarehouseId" ELSE w.id END AS "unitId",
               p.id, p."minStock", COALESCE(s."avgCost", 0) AS "avgCost",
               SUM(${warehouseQtySql(tenantId, 's')}) AS qty
        FROM products p
        LEFT JOIN product_stocks s ON s."productId" = p.id
        JOIN warehouses w ON w."tenantId" = ${tenantId}::uuid
          ${warehouseIds ? Prisma.sql`AND w.id = ANY(${warehouseIds}::uuid[])` : Prisma.empty}
        LEFT JOIN warehouse_stocks ws ON ws."warehouseId" = w.id AND ws."productId" = p.id
        WHERE p."tenantId" = ${tenantId}::uuid AND p."deletedAt" IS NULL
        GROUP BY 1, p.id, p."minStock", s."avgCost"
      ) q
      GROUP BY q."unitId"`;
    return new Map(
      rows.map((r) => [
        r.unitId,
        {
          lowStock: Number(r.lowStock),
          value: showCost ? toMoneyString(r.value.toString()) : null,
        },
      ]),
    );
  }

  /** Adds the quantity of every live dépôt to each row (stock list columns, stock card). */
  private async addSplit(items: StockLevelDto[], reach: string[] | null = null): Promise<void> {
    if (items.length === 0) return;
    const tenantId = tenantContext.requireTenantId();
    const rows = await this.prisma.db.$queryRaw<
      { productId: string; warehouseId: string; qtyBase: Dec }[]
    >`
      SELECT p.id AS "productId", w.id AS "warehouseId", ${warehouseQtySql(tenantId)} AS "qtyBase"
      FROM products p
      JOIN warehouses w ON w."tenantId" = ${tenantId}::uuid AND w."deletedAt" IS NULL
      LEFT JOIN warehouse_stocks ws ON ws."warehouseId" = w.id AND ws."productId" = p.id
      LEFT JOIN product_stocks ps ON ps."productId" = p.id AND ps."tenantId" = ${tenantId}::uuid
      WHERE p."tenantId" = ${tenantId}::uuid
        AND p.id IN (${Prisma.join(items.map((i) => Prisma.sql`${i.productId}::uuid`))})
        AND ${reach ? Prisma.sql`w.id = ANY(${reach}::uuid[])` : Prisma.sql`TRUE`}
      ORDER BY w."isDefault" DESC, w.name`;
    for (const item of items) {
      item.byWarehouse = rows
        .filter((r) => r.productId === item.productId)
        .map((r) => ({ warehouseId: r.warehouseId, qtyBase: toQtyString(r.qtyBase.toString()) }));
    }
  }

  async level(
    productId: string,
    showCost: boolean,
    withWarehouses = false,
    reach: string[] | null = null,
  ): Promise<StockLevelDto> {
    const product = await this.prisma.db.product.findUnique({
      where: { id: productId },
      include: { stock: true },
    });
    if (!product) throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
    const [item] = await this.withUnits(
      [
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
      ],
      showCost,
    );
    if (!item) throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
    if (withWarehouses || reach) await this.addSplit([item], reach);
    // Phase 24: a user who works in some dépôts sees their quantity, not the company's.
    if (reach) {
      item.qtyBase = toQtyString(
        (item.byWarehouse ?? []).reduce((sum, w) => sum.plus(w.qtyBase), qty(0)).toString(),
      );
    }
    return item;
  }

  /**
   * Stock card: newest first, each row with the balance right after it. With a dépôt,
   * only its movements, plus its own running balance (computed from the immutable ledger;
   * movements written before phase 15 have no dépôt and count for the default one).
   */
  async movements(
    productId: string,
    query: MovementQuery,
    showCost: boolean,
    reach: string[] | null = null,
  ): Promise<StockMovementPage> {
    const product = await this.prisma.db.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
    const tenantId = tenantContext.requireTenantId();
    const wh = query.warehouseId
      ? await this.prisma.db.warehouse.findFirst({
          where: { id: query.warehouseId },
          select: { id: true, isDefault: true },
        })
      : null;
    if (query.warehouseId && (!wh || (reach && !reach.includes(wh.id)))) {
      throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Warehouse not found');
    }
    // Phase 24: without a dépôt chosen, a user who works in some dépôts sees their
    // movements, with their own running balance.
    const many =
      !wh && reach
        ? await this.prisma.db.warehouse.findMany({
            where: { id: { in: reach } },
            select: { id: true, isDefault: true },
          })
        : null;
    const manyHasDefault = many?.some((w) => w.isDefault) ?? false;
    const rows = await this.prisma.db.stockMovement.findMany({
      where: {
        productId,
        ...(wh
          ? wh.isDefault
            ? { OR: [{ warehouseId: wh.id }, { warehouseId: null }] }
            : { warehouseId: wh.id }
          : many
            ? {
                OR: [
                  { warehouseId: { in: many.map((w) => w.id) } },
                  ...(manyHasDefault ? [{ warehouseId: null }] : []),
                ],
              }
            : {}),
      },
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
    const running = new Map<string, string>();
    if ((wh || many) && page.length > 0) {
      const own = wh
        ? wh.isDefault
          ? Prisma.sql`("warehouseId" = ${wh.id}::uuid OR "warehouseId" IS NULL)`
          : Prisma.sql`"warehouseId" = ${wh.id}::uuid`
        : Prisma.sql`("warehouseId" = ANY(${many!.map((w) => w.id)}::uuid[])
            ${manyHasDefault ? Prisma.sql`OR "warehouseId" IS NULL` : Prisma.empty})`;
      const balances = await this.prisma.db.$queryRaw<{ id: string; balance: Dec }[]>`
        SELECT id, balance FROM (
          SELECT id, SUM("qtyBase") OVER (ORDER BY seq ROWS UNBOUNDED PRECEDING) AS balance
          FROM stock_movements
          WHERE "tenantId" = ${tenantId}::uuid AND "productId" = ${productId}::uuid AND ${own}
        ) card
        WHERE id IN (${Prisma.join(page.map((m) => Prisma.sql`${m.id}::uuid`))})`;
      for (const b of balances) running.set(b.id, toQtyString(b.balance.toString()));
    }
    return {
      items: page.map((m) => ({
        id: m.id,
        type: m.type,
        qtyBase: toQtyString(m.qtyBase.toString()),
        unitCost: showCost ? (m.unitCost?.toFixed(4) ?? null) : null,
        // The company balance is not shown to a user who works in some dépôts only.
        balanceAfter:
          many !== null
            ? (running.get(m.id) ?? toQtyString('0'))
            : toQtyString(m.balanceAfter.toString()),
        avgCostAfter: showCost ? m.avgCostAfter.toFixed(4) : null,
        reason: m.reason,
        refType: m.refType,
        refId: m.refId,
        note: m.note,
        createdBy: m.createdBy ? (byId.get(m.createdBy) ?? null) : null,
        createdAt: m.createdAt.toISOString(),
        warehouseId: m.warehouseId,
        warehouseBalanceAfter: running.get(m.id) ?? null,
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
        select: {
          id: true,
          qtyBase: true,
          unitCost: true,
          valueDelta: true,
          balanceAfter: true,
          avgCostAfter: true,
        },
      });
      let q = qty(0);
      let avg = qty(0);
      let brokenChainAt: string | null = null;
      for (const m of movements) {
        const delta = qty(m.qtyBase.toString());
        if (delta.gt(0)) avg = cump(q, avg, delta, m.unitCost?.toString() ?? avg.toString());
        // COST_ADJUST (phase 22): the value moves, the quantity does not.
        if (m.valueDelta) avg = cumpAfterValue(q, avg, m.valueDelta.toString());
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
  private async withUnits(rows: LevelRow[], showCost: boolean): Promise<StockLevelDto[]> {
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
        avgCost: showCost ? qty(avgCost).toFixed(4) : null,
        value: showCost ? toMoneyString(stockValue(qtyBase, avgCost)) : null,
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
