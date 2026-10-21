/**
 * Ledger checks (AGENTS.md rule 1): cached stock levels and client balances must equal
 * the sum of their immutable ledgers. Each query returns the rows that disagree, so an
 * empty result is a pass. Same checks as e2e/sql/invariants.sql. Run across all
 * tenants, as the system context.
 */
export interface ReconcileCheck {
  name: string;
  /** What the rows point at, for the audit row and the alert. */
  entity: 'Product' | 'Client';
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
];
