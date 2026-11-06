/**
 * Ledger checks (AGENTS.md rule 1): cached stock levels, client and supplier balances must equal
 * the sum of their immutable ledgers. Each query returns the rows that disagree, so an
 * empty result is a pass. Same checks as e2e/sql/invariants.sql. Run across all
 * tenants, as the system context.
 */
export interface ReconcileCheck {
  name: string;
  /** What the rows point at, for the audit row and the alert. */
  entity: 'Product' | 'Client' | 'Supplier' | 'Employee' | 'CashAccount';
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
    // Phase 22: a foreign supplier's balance in its currency. DZD suppliers only have
    // currency amounts when something is wrong, so only those rows are aggregated.
    name: 'supplier_currency_balance_equals_ledger',
    entity: 'Supplier',
    sql: `
      SELECT sb."tenantId"::text AS "tenantId", sb."supplierId"::text AS "entityId",
             sb."balanceCurrency"::text AS cached,
             COALESCE(SUM(le."amountCurrency"), 0)::text AS ledger
      FROM supplier_balances sb
      JOIN suppliers s ON s.id = sb."supplierId"
        AND (s.currency <> 'DZD' OR sb."balanceCurrency" <> 0)
      LEFT JOIN supplier_ledger_entries le
        ON le."tenantId" = sb."tenantId" AND le."supplierId" = sb."supplierId"
      GROUP BY sb."tenantId", sb."supplierId", sb."balanceCurrency"
      HAVING sb."balanceCurrency" <> COALESCE(SUM(le."amountCurrency"), 0)`,
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
  {
    // Phase 20: each client's packaging count equals the sum of its packaging ledger.
    name: 'packaging_balance_equals_ledger',
    entity: 'Client',
    sql: `
      SELECT pb."tenantId"::text AS "tenantId", pb."clientId"::text AS "entityId",
             pb.balance::text AS cached, COALESCE(SUM(pe.qty), 0)::text AS ledger
      FROM client_packaging_balances pb
      LEFT JOIN client_packaging_entries pe
        ON pe."tenantId" = pb."tenantId" AND pe."clientId" = pb."clientId"
       AND pe."packagingTypeId" = pb."packagingTypeId"
      GROUP BY pb."tenantId", pb."clientId", pb."packagingTypeId", pb.balance
      HAVING pb.balance <> COALESCE(SUM(pe.qty), 0)`,
  },
  {
    name: 'packaging_missing_balance',
    entity: 'Client',
    sql: `
      SELECT pe."tenantId"::text AS "tenantId", pe."clientId"::text AS "entityId",
             NULL AS cached, SUM(pe.qty)::text AS ledger
      FROM client_packaging_entries pe
      LEFT JOIN client_packaging_balances pb
        ON pb."tenantId" = pe."tenantId" AND pb."clientId" = pe."clientId"
       AND pb."packagingTypeId" = pe."packagingTypeId"
      WHERE pb.id IS NULL
      GROUP BY pe."tenantId", pe."clientId", pe."packagingTypeId"`,
  },
  {
    // Phase 31: what each worker owes in avances equals his account. The salary types of
    // phase 31b move the other balance (`employeeBalanceDelta`).
    name: 'employee_advance_equals_ledger',
    entity: 'Employee',
    sql: `
      SELECT eb."tenantId"::text AS "tenantId", eb."employeeId"::text AS "entityId",
             eb."advanceBalance"::text AS cached,
             COALESCE(SUM(le.amount) FILTER (
               WHERE le.type NOT IN ('SALARY_DUE', 'SALARY_PAID', 'SALARY_REVERSAL')), 0)::text AS ledger
      FROM employee_balances eb
      LEFT JOIN employee_ledger_entries le
        ON le."tenantId" = eb."tenantId" AND le."employeeId" = eb."employeeId"
      GROUP BY eb."tenantId", eb."employeeId", eb."advanceBalance"
      HAVING eb."advanceBalance" <> COALESCE(SUM(le.amount) FILTER (
        WHERE le.type NOT IN ('SALARY_DUE', 'SALARY_PAID', 'SALARY_REVERSAL')), 0)`,
  },
  {
    // Phase 31b: what the company owes each worker: salaries due, less payments and the
    // avances taken back from them.
    name: 'employee_salary_due_equals_ledger',
    entity: 'Employee',
    sql: `
      SELECT eb."tenantId"::text AS "tenantId", eb."employeeId"::text AS "entityId",
             eb."salaryDue"::text AS cached,
             COALESCE(SUM(CASE
               WHEN le.type IN ('SALARY_DUE', 'SALARY_PAID', 'SALARY_REVERSAL') THEN -le.amount
               WHEN le.type = 'ADVANCE_DEDUCTION' THEN le.amount
               ELSE 0 END), 0)::text AS ledger
      FROM employee_balances eb
      LEFT JOIN employee_ledger_entries le
        ON le."tenantId" = eb."tenantId" AND le."employeeId" = eb."employeeId"
      GROUP BY eb."tenantId", eb."employeeId", eb."salaryDue"
      HAVING eb."salaryDue" <> COALESCE(SUM(CASE
        WHEN le.type IN ('SALARY_DUE', 'SALARY_PAID', 'SALARY_REVERSAL') THEN -le.amount
        WHEN le.type = 'ADVANCE_DEDUCTION' THEN le.amount
        ELSE 0 END), 0)`,
  },
  {
    // Phase 31: the congé balance equals the sum of its ledger.
    name: 'employee_leave_equals_ledger',
    entity: 'Employee',
    sql: `
      SELECT eb."tenantId"::text AS "tenantId", eb."employeeId"::text AS "entityId",
             eb."leaveDays"::text AS cached, COALESCE(SUM(le.days), 0)::text AS ledger
      FROM employee_balances eb
      LEFT JOIN leave_entries le
        ON le."tenantId" = eb."tenantId" AND le."employeeId" = eb."employeeId"
      GROUP BY eb."tenantId", eb."employeeId", eb."leaveDays"
      HAVING eb."leaveDays" <> COALESCE(SUM(le.days), 0)`,
  },
  {
    name: 'employee_missing_balance',
    entity: 'Employee',
    sql: `
      SELECT x."tenantId"::text AS "tenantId", x."employeeId"::text AS "entityId",
             NULL AS cached, 'ledger rows without a balance' AS ledger
      FROM (
        SELECT "tenantId", "employeeId" FROM employee_ledger_entries
        UNION SELECT "tenantId", "employeeId" FROM leave_entries
      ) x
      LEFT JOIN employee_balances eb
        ON eb."tenantId" = x."tenantId" AND eb."employeeId" = x."employeeId"
      WHERE eb.id IS NULL`,
  },
  {
    // Phase 34: a balance equals its ledger, without what is dated before the opening.
    name: 'cash_balance_equals_ledger',
    entity: 'CashAccount',
    sql: `
      SELECT b."tenantId"::text AS "tenantId", b."cashAccountId"::text AS "entityId",
             b.balance::text AS cached,
             COALESCE(SUM(m.amount) FILTER (
               WHERE a."openingDate" IS NULL OR m.date >= a."openingDate"), 0)::text AS ledger
      FROM cash_account_balances b
      JOIN cash_accounts a ON a.id = b."cashAccountId"
      LEFT JOIN cash_movements m
        ON m."tenantId" = b."tenantId" AND m."cashAccountId" = b."cashAccountId"
      GROUP BY b."tenantId", b."cashAccountId", b.balance
      HAVING b.balance <> COALESCE(SUM(m.amount) FILTER (
        WHERE a."openingDate" IS NULL OR m.date >= a."openingDate"), 0)`,
  },
  {
    name: 'cash_missing_balance',
    entity: 'CashAccount',
    sql: `
      SELECT a."tenantId"::text AS "tenantId", a.id::text AS "entityId",
             NULL AS cached, 'account without a balance' AS ledger
      FROM cash_accounts a
      LEFT JOIN cash_account_balances b ON b."cashAccountId" = a.id
      WHERE b.id IS NULL`,
  },
];
