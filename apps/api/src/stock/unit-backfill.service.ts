import { Injectable, Logger } from '@nestjs/common';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { WarehousesService } from './warehouses.service';

/** What one run did, summed over the tenants. */
export interface UnitBackfillResult {
  tenants: number;
  /** Rows without a dépôt before and after (after must be 0). */
  before: { payments: number; ledgerEntries: number; trucks: number };
  after: { payments: number; ledgerEntries: number; trucks: number };
  /** Rows given a dépôt by this run. */
  filled: { payments: number; ledgerEntries: number; trucks: number };
  /** UserWarehouseAccess rows this run created. */
  accessRows: number;
  /** Sum of the client balances before and after: must be equal. */
  balancesBefore: string;
  balancesAfter: string;
}

export class UnitBackfillMismatch extends Error {
  constructor(
    readonly tenantId: string,
    readonly problems: { check: string; clientId: string; expected: string; found: string }[],
  ) {
    super(
      `Units backfill aborted for tenant ${tenantId}: ${problems.length} mismatch(es), nothing written for this tenant`,
    );
  }
}

type Counts = UnitBackfillResult['before'];

/**
 * One-off after the phase 24 deploy (docs/runbook.md, "Units backfill"). Per tenant, in
 * one transaction, with the client balances locked in clientId order (the lock order of
 * every money path, so it is safe with the API running):
 * - versements get the dépôt of the sale they pay (the sale itself, else the oldest sale
 *   of their allocations), else the dépôt principal;
 * - client ledger entries get the dépôt of their source document (sale, avoir,
 *   versement), else the dépôt principal;
 * - every user gets OPERATE on every dépôt (MAIN / SECONDARY): nobody loses access;
 * - trucks without a parent belong to the dépôt principal.
 * Then it checks: no row left without a dépôt, and every client balance unchanged and
 * equal to its ledger. A mismatch rolls the tenant back and stops the run. Idempotent: a
 * second run fills and creates nothing.
 */
@Injectable()
export class UnitBackfillService {
  private readonly logger = new Logger(UnitBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouses: WarehousesService,
  ) {}

  async run(options: { tenantIds?: string[] } = {}): Promise<UnitBackfillResult> {
    const tenants = await tenantContext.runAsSystem(() =>
      this.prisma.db.tenant.findMany({
        where: options.tenantIds ? { id: { in: options.tenantIds } } : {},
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    );
    const zero = (): Counts => ({ payments: 0, ledgerEntries: 0, trucks: 0 });
    const result: UnitBackfillResult = {
      tenants: tenants.length,
      before: zero(),
      after: zero(),
      filled: zero(),
      accessRows: 0,
      balancesBefore: '0.00',
      balancesAfter: '0.00',
    };
    let balancesBefore = new Prisma.Decimal(0);
    let balancesAfter = new Prisma.Decimal(0);
    const add = (into: Counts, from: Counts) => {
      into.payments += from.payments;
      into.ledgerEntries += from.ledgerEntries;
      into.trucks += from.trucks;
    };
    for (const { id } of tenants) {
      const r = await tenantContext.run({ tenantId: id }, () => this.tenant(id));
      add(result.before, r.before);
      add(result.after, r.after);
      add(result.filled, r.filled);
      result.accessRows += r.accessRows;
      balancesBefore = balancesBefore.plus(r.balancesBefore);
      balancesAfter = balancesAfter.plus(r.balancesAfter);
    }
    result.balancesBefore = balancesBefore.toFixed(2);
    result.balancesAfter = balancesAfter.toFixed(2);
    return result;
  }

  private async tenant(tenantId: string) {
    return this.prisma.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "clientId" FROM client_balances
          WHERE "tenantId" = ${tenantId}::uuid
          ORDER BY "clientId"
          FOR UPDATE`;
        const balancesBefore = await this.balances(tx, tenantId);
        const before = await this.missing(tx, tenantId);
        const mainId = await this.warehouses.defaultId(tx);

        // Versements: the sale they were taken with, else the oldest sale they pay.
        const payments = await tx.$executeRaw`
          UPDATE payments p SET "warehouseId" = COALESCE(
            (SELECT s."warehouseId" FROM sales s WHERE s.id = p."saleId"),
            (SELECT s."warehouseId" FROM payment_allocations a
               JOIN sales s ON s.id = a."saleId"
             WHERE a."paymentId" = p.id AND s."warehouseId" IS NOT NULL
             ORDER BY s."documentDate", s."createdAt", s.id
             LIMIT 1),
            ${mainId}::uuid)
          WHERE p."tenantId" = ${tenantId}::uuid AND p."warehouseId" IS NULL`;

        // Ledger entries: their source document's dépôt (versements are filled above).
        const ledgerEntries = await tx.$executeRaw`
          UPDATE client_ledger_entries e SET "warehouseId" = COALESCE(
            CASE e."refType"
              WHEN 'Sale' THEN (SELECT s."warehouseId" FROM sales s WHERE s.id = e."refId")
              WHEN 'SaleReturn' THEN (SELECT r."warehouseId" FROM sale_returns r WHERE r.id = e."refId")
              WHEN 'Payment' THEN (SELECT p."warehouseId" FROM payments p WHERE p.id = e."refId")
            END,
            ${mainId}::uuid)
          WHERE e."tenantId" = ${tenantId}::uuid AND e."warehouseId" IS NULL`;

        const accessRows = await tx.$executeRaw`
          INSERT INTO user_warehouse_access ("id", "tenantId", "userId", "warehouseId", "level", "grantedAt")
          SELECT gen_random_uuid(), u."tenantId", u.id, w.id, 'OPERATE', CURRENT_TIMESTAMP
          FROM users u
          JOIN warehouses w ON w."tenantId" = u."tenantId"
            AND w.type IN ('MAIN', 'SECONDARY') AND w."deletedAt" IS NULL
          WHERE u."tenantId" = ${tenantId}::uuid
            AND NOT EXISTS (SELECT 1 FROM user_warehouse_access x
                            WHERE x."userId" = u.id AND x."warehouseId" = w.id)
          ON CONFLICT ("userId", "warehouseId") DO NOTHING`;

        const trucks = await tx.$executeRaw`
          UPDATE warehouses SET "parentWarehouseId" = ${mainId}::uuid
          WHERE "tenantId" = ${tenantId}::uuid AND type = 'VEHICLE'
            AND "parentWarehouseId" IS NULL AND "deletedAt" IS NULL`;

        const after = await this.missing(tx, tenantId);
        const balancesAfter = await this.balances(tx, tenantId);
        const problems = await this.verify(tx, tenantId);
        if (!balancesAfter.eq(balancesBefore)) {
          problems.push({
            check: 'balances_total',
            clientId: '-',
            expected: balancesBefore.toFixed(2),
            found: balancesAfter.toFixed(2),
          });
        }
        for (const [key, n] of Object.entries(after)) {
          if (n > 0) {
            problems.push({
              check: `${key}_without_warehouse`,
              clientId: '-',
              expected: '0',
              found: String(n),
            });
          }
        }
        if (problems.length > 0) {
          this.logger.error(`Mismatch for tenant ${tenantId}: ${JSON.stringify(problems)}`);
          throw new UnitBackfillMismatch(tenantId, problems);
        }
        return {
          before,
          after,
          filled: { payments, ledgerEntries, trucks },
          accessRows,
          balancesBefore,
          balancesAfter,
        };
      },
      { timeout: 300_000 },
    );
  }

  private async balances(tx: Tx, tenantId: string): Promise<Prisma.Decimal> {
    const [row] = await tx.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT SUM(balance) AS total FROM client_balances WHERE "tenantId" = ${tenantId}::uuid`;
    return new Prisma.Decimal(row?.total ?? 0);
  }

  private async missing(tx: Tx, tenantId: string): Promise<Counts> {
    const [row] = await tx.$queryRaw<{ payments: bigint; ledger: bigint; trucks: bigint }[]>`
      SELECT
        (SELECT COUNT(*) FROM payments WHERE "tenantId" = ${tenantId}::uuid AND "warehouseId" IS NULL) AS payments,
        (SELECT COUNT(*) FROM client_ledger_entries WHERE "tenantId" = ${tenantId}::uuid AND "warehouseId" IS NULL) AS ledger,
        (SELECT COUNT(*) FROM warehouses WHERE "tenantId" = ${tenantId}::uuid AND type = 'VEHICLE'
           AND "parentWarehouseId" IS NULL AND "deletedAt" IS NULL) AS trucks`;
    return {
      payments: Number(row?.payments ?? 0),
      ledgerEntries: Number(row?.ledger ?? 0),
      trucks: Number(row?.trucks ?? 0),
    };
  }

  /** Every cached client balance equals its ledger (the backfill must not move money). */
  private async verify(tx: Tx, tenantId: string) {
    const rows = await tx.$queryRaw<{ clientId: string; expected: string; found: string }[]>`
      SELECT b."clientId", COALESCE(SUM(e.amount), 0)::text AS expected, b.balance::text AS found
      FROM client_balances b
      LEFT JOIN client_ledger_entries e
        ON e."tenantId" = b."tenantId" AND e."clientId" = b."clientId"
      WHERE b."tenantId" = ${tenantId}::uuid
      GROUP BY b."clientId", b.balance
      HAVING b.balance <> COALESCE(SUM(e.amount), 0)`;
    return rows.map((r) => ({ check: 'balance_equals_ledger', ...r }));
  }
}
