import { Injectable, Logger } from '@nestjs/common';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { WarehousesService } from './warehouses.service';

export interface WarehouseBackfillResult {
  tenants: number;
  /** Rows that got the main dépôt, per table. */
  filled: Record<string, number>;
  /** Main-dépôt stock rows created from ProductStock. */
  stockRows: number;
  /** Company stock (sum of ProductStock) before and after: must be equal. */
  totalBefore: string;
  totalAfter: string;
}

export class WarehouseBackfillMismatch extends Error {
  constructor(
    readonly tenantId: string,
    readonly problems: { check: string; productId: string; expected: string; found: string }[],
  ) {
    super(
      `Warehouse backfill aborted for tenant ${tenantId}: ${problems.length} mismatch(es), nothing written for this tenant`,
    );
  }
}

/**
 * Rows written before phase 15 have no dépôt: they all happened in the main one. Drafts
 * keep null (a draft's dépôt is decided at validation), so sales and BRs are filled only
 * once validated or cancelled.
 */
const FILLED: { table: string; where: Prisma.Sql }[] = [
  { table: 'stock_movements', where: Prisma.empty },
  { table: 'sales', where: Prisma.sql`AND status <> 'DRAFT'` },
  { table: 'purchases', where: Prisma.sql`AND status <> 'DRAFT'` },
  { table: 'sale_returns', where: Prisma.empty },
  { table: 'purchase_returns', where: Prisma.empty },
  { table: 'inventories', where: Prisma.empty },
];

/**
 * One-off after the phase 15 deploy (docs/runbook.md, "Warehouse backfill"). Per tenant,
 * in one transaction: lock the tenant's ProductStock rows (same lock order as any stock
 * path, so it is safe with the API running), create the main dépôt, put it on every row
 * that has no dépôt, build the main dépôt's WarehouseStock from ProductStock, then verify:
 * the split sums to ProductStock and each dépôt equals its ledger. Any mismatch rolls the
 * tenant back and stops the run. Idempotent: a second run fills nothing and creates nothing.
 */
@Injectable()
export class WarehouseBackfillService {
  private readonly logger = new Logger(WarehouseBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouses: WarehousesService,
  ) {}

  async run(options: { tenantIds?: string[] } = {}): Promise<WarehouseBackfillResult> {
    const tenants = await tenantContext.runAsSystem(() =>
      this.prisma.db.tenant.findMany({
        where: options.tenantIds ? { id: { in: options.tenantIds } } : {},
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    );
    const result: WarehouseBackfillResult = {
      tenants: tenants.length,
      filled: Object.fromEntries(FILLED.map((f) => [f.table, 0])),
      stockRows: 0,
      totalBefore: '0',
      totalAfter: '0',
    };
    let before = new Prisma.Decimal(0);
    let after = new Prisma.Decimal(0);
    for (const { id } of tenants) {
      const r = await tenantContext.run({ tenantId: id }, () => this.tenant(id));
      for (const [table, n] of Object.entries(r.filled)) result.filled[table]! += n;
      result.stockRows += r.stockRows;
      before = before.plus(r.totalBefore);
      after = after.plus(r.totalAfter);
    }
    result.totalBefore = before.toFixed(3);
    result.totalAfter = after.toFixed(3);
    return result;
  }

  private async tenant(tenantId: string) {
    return this.prisma.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "productId" FROM product_stocks
          WHERE "tenantId" = ${tenantId}::uuid
          ORDER BY "productId"
          FOR UPDATE`;
        const totalBefore = await this.total(tx, tenantId);
        const mainId = await this.warehouses.defaultId(tx);

        const filled: Record<string, number> = {};
        for (const f of FILLED) {
          filled[f.table] = await tx.$executeRaw`
            UPDATE ${Prisma.raw(`"${f.table}"`)} SET "warehouseId" = ${mainId}::uuid
            WHERE "tenantId" = ${tenantId}::uuid AND "warehouseId" IS NULL ${f.where}`;
        }

        // Same rule as the first write after the deploy: the main dépôt holds what the
        // other dépôts do not.
        const stockRows = await tx.$executeRaw`
          INSERT INTO warehouse_stocks ("id", "tenantId", "warehouseId", "productId", "qtyBase", "updatedAt")
          SELECT gen_random_uuid(), ps."tenantId", ${mainId}::uuid, ps."productId",
                 ps."qtyBase" - COALESCE((
                   SELECT SUM(o."qtyBase") FROM warehouse_stocks o
                   WHERE o."tenantId" = ps."tenantId" AND o."productId" = ps."productId"), 0),
                 CURRENT_TIMESTAMP
          FROM product_stocks ps
          WHERE ps."tenantId" = ${tenantId}::uuid
            AND NOT EXISTS (
              SELECT 1 FROM warehouse_stocks m
              WHERE m."warehouseId" = ${mainId}::uuid AND m."productId" = ps."productId")`;

        const problems = await this.verify(tx, tenantId);
        const totalAfter = await this.total(tx, tenantId);
        if (!totalAfter.eq(totalBefore)) {
          problems.push({
            check: 'company_total',
            productId: '-',
            expected: totalBefore.toFixed(3),
            found: totalAfter.toFixed(3),
          });
        }
        if (problems.length > 0) {
          this.logger.error(`Mismatch for tenant ${tenantId}: ${JSON.stringify(problems)}`);
          throw new WarehouseBackfillMismatch(tenantId, problems);
        }
        return { filled, stockRows, totalBefore, totalAfter };
      },
      { timeout: 300_000 },
    );
  }

  private async total(tx: Tx, tenantId: string): Promise<Prisma.Decimal> {
    const [row] = await tx.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT SUM("qtyBase") AS total FROM product_stocks WHERE "tenantId" = ${tenantId}::uuid`;
    return new Prisma.Decimal(row?.total ?? 0);
  }

  /** Every product: split = ProductStock; every dépôt row: = its movements; none left without dépôt. */
  private async verify(tx: Tx, tenantId: string) {
    const split = await tx.$queryRaw<{ productId: string; expected: string; found: string }[]>`
      SELECT ps."productId", ps."qtyBase"::text AS expected,
             COALESCE(SUM(ws."qtyBase"), 0)::text AS found
      FROM product_stocks ps
      LEFT JOIN warehouse_stocks ws
        ON ws."tenantId" = ps."tenantId" AND ws."productId" = ps."productId"
      WHERE ps."tenantId" = ${tenantId}::uuid
      GROUP BY ps."productId", ps."qtyBase"
      HAVING ps."qtyBase" <> COALESCE(SUM(ws."qtyBase"), 0)`;
    const ledger = await tx.$queryRaw<{ productId: string; expected: string; found: string }[]>`
      SELECT ws."productId", COALESCE(SUM(sm."qtyBase"), 0)::text AS expected,
             ws."qtyBase"::text AS found
      FROM warehouse_stocks ws
      LEFT JOIN stock_movements sm
        ON sm."tenantId" = ws."tenantId" AND sm."productId" = ws."productId"
       AND sm."warehouseId" = ws."warehouseId"
      WHERE ws."tenantId" = ${tenantId}::uuid
      GROUP BY ws."productId", ws."warehouseId", ws."qtyBase"
      HAVING ws."qtyBase" <> COALESCE(SUM(sm."qtyBase"), 0)`;
    const [orphans] = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM stock_movements
      WHERE "tenantId" = ${tenantId}::uuid AND "warehouseId" IS NULL`;
    return [
      ...split.map((r) => ({ check: 'split_equals_product', ...r })),
      ...ledger.map((r) => ({ check: 'warehouse_equals_ledger', ...r })),
      ...(orphans && orphans.n > 0n
        ? [
            {
              check: 'movements_without_warehouse',
              productId: '-',
              expected: '0',
              found: String(orphans.n),
            },
          ]
        : []),
    ];
  }
}
