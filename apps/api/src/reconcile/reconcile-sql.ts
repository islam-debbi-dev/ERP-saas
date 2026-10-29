/**
 * Ledger checks (AGENTS.md rule 1): cached stock levels, client and supplier balances must equal
 * the sum of their immutable ledgers. Each query returns the rows that disagree, so an
 * empty result is a pass. Same checks as e2e/sql/invariants.sql. Run across all
 * tenants, as the system context.
 */
export interface ReconcileCheck {
  name: string;
  /** What the rows point at, for the audit row and the alert. */
  entity: 'Product' | 'Client' | 'Supplier';
  sql: string;
}

export const RECONCILE_CHECKS: ReconcileCheck[] = [
  {
    name: 'stock_equals_ledger',
    entity: 'Product',
    sql: `
      SELECT ps."tenantId"::text AS "tenantId", ps."productId"::text AS "entityId",
             ps."qtyBase"::text AS cached, COALESCE(SUM(sm."qtyBase"), 0)::text AS ledger
      FROM product_stocks ps
      LEFT JOIN stock_movements sm
        ON sm."tenantId" = ps."tenantId" AND sm."productId" = ps."productId"
      GROUP BY ps."tenantId", ps."productId", ps."qtyBase"
      HAVING ps."qtyBase" <> COALESCE(SUM(sm."qtyBase"), 0)`,
  },
  {
    name: 'stock_missing_cache',
    entity: 'Product',
    sql: `
      SELECT sm."tenantId"::text AS "tenantId", sm."productId"::text AS "entityId",
             NULL AS cached, SUM(sm."qtyBase")::text AS ledger
      FROM stock_movements sm
      LEFT JOIN product_stocks ps
        ON ps."tenantId" = sm."tenantId" AND ps."productId" = sm."productId"
      WHERE ps.id IS NULL
      GROUP BY sm."tenantId", sm."productId"`,
  },
  {
    name: 'stock_balance_chain',
    entity: 'Product',
    sql: `
      SELECT DISTINCT ON ("tenantId", "productId")
             "tenantId"::text AS "tenantId", "productId"::text AS "entityId",
             "balanceAfter"::text AS cached, running::text AS ledger
      FROM (
        SELECT sm."tenantId", sm."productId", sm.seq, sm."balanceAfter",
               SUM(sm."qtyBase") OVER (
                 PARTITION BY sm."tenantId", sm."productId" ORDER BY sm.seq
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
        FROM stock_movements sm
      ) chain
      WHERE "balanceAfter" <> running
      ORDER BY "tenantId", "productId", seq`,
  },
  {
    // Phase 15: the split per dépôt sums to the product level. Checked once the default
    // dépôt has its row (the first write after the deploy, or the backfill, creates it).
    name: 'warehouse_sum_equals_product',
    entity: 'Product',
    sql: `
      SELECT ps."tenantId"::text AS "tenantId", ps."productId"::text AS "entityId",
             ps."qtyBase"::text AS cached, SUM(ws."qtyBase")::text AS ledger
      FROM product_stocks ps
      JOIN warehouse_stocks ws
        ON ws."tenantId" = ps."tenantId" AND ws."productId" = ps."productId"
      JOIN warehouses w ON w.id = ws."warehouseId"
      GROUP BY ps."tenantId", ps."productId", ps."qtyBase"
      HAVING bool_or(w."isDefault") AND ps."qtyBase" <> SUM(ws."qtyBase")`,
  },
  {
    // Each dépôt level equals its movements; movements written before phase 15 have no
    // dépôt and belong to the default one.
    name: 'warehouse_stock_equals_ledger',
    entity: 'Product',
    sql: `
      SELECT ws."tenantId"::text AS "tenantId", ws."productId"::text AS "entityId",
             ws."qtyBase"::text AS cached, COALESCE(SUM(sm."qtyBase"), 0)::text AS ledger
      FROM warehouse_stocks ws
      JOIN warehouses w ON w.id = ws."warehouseId"
      LEFT JOIN stock_movements sm
        ON sm."tenantId" = ws."tenantId" AND sm."productId" = ws."productId"
       AND (sm."warehouseId" = ws."warehouseId" OR (w."isDefault" AND sm."warehouseId" IS NULL))
      GROUP BY ws."tenantId", ws."productId", ws."warehouseId", ws."qtyBase"
      HAVING ws."qtyBase" <> COALESCE(SUM(sm."qtyBase"), 0)`,
  },
  {
    name: 'client_balance_equals_ledger',
    entity: 'Client',
    sql: `
      SELECT cb."tenantId"::text AS "tenantId", cb."clientId"::text AS "entityId",
             cb.balance::text AS cached, COALESCE(SUM(le.amount), 0)::text AS ledger
      FROM client_balances cb
      LEFT JOIN client_ledger_entries le
        ON le."tenantId" = cb."tenantId" AND le."clientId" = cb."clientId"
      GROUP BY cb."tenantId", cb."clientId", cb.balance
      HAVING cb.balance <> COALESCE(SUM(le.amount), 0)`,
  },
  {
    name: 'client_missing_balance',
    entity: 'Client',
    sql: `
      SELECT le."tenantId"::text AS "tenantId", le."clientId"::text AS "entityId",
             NULL AS cached, SUM(le.amount)::text AS ledger
      FROM client_ledger_entries le
      LEFT JOIN client_balances cb
        ON cb."tenantId" = le."tenantId" AND cb."clientId" = le."clientId"
      WHERE cb.id IS NULL
      GROUP BY le."tenantId", le."clientId"`,
  },
  {
    name: 'supplier_balance_equals_ledger',
    entity: 'Supplier',
    sql: `
      SELECT sb."tenantId"::text AS "tenantId", sb."supplierId"::text AS "entityId",
             sb.balance::text AS cached, COALESCE(SUM(le.amount), 0)::text AS ledger
      FROM supplier_balances sb
      LEFT JOIN supplier_ledger_entries le
        ON le."tenantId" = sb."tenantId" AND le."supplierId" = sb."supplierId"
      GROUP BY sb."tenantId", sb."supplierId", sb.balance
      HAVING sb.balance <> COALESCE(SUM(le.amount), 0)`,
  },
  {
    name: 'supplier_missing_balance',
    entity: 'Supplier',
    sql: `
      SELECT le."tenantId"::text AS "tenantId", le."supplierId"::text AS "entityId",
             NULL AS cached, SUM(le.amount)::text AS ledger
      FROM supplier_ledger_entries le
      LEFT JOIN supplier_balances sb
        ON sb."tenantId" = le."tenantId" AND sb."supplierId" = le."supplierId"
      WHERE sb.id IS NULL
      GROUP BY le."tenantId", le."supplierId"`,
  },
];
