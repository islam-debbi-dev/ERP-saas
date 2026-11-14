-- ============================================================================
-- ERP SaaS — ledger invariants (reusable, read-only).
-- Each block is a named query; the runner (sql/run-invariants.ts) executes every
-- block and expects ZERO rows back. Any row returned is a violation.
-- ============================================================================

-- name: stock_equals_ledger
-- Cached stock level must equal the sum of the stock ledger of the same product.
SELECT ps."tenantId",
       ps."productId",
       ps."qtyBase"  AS cached_qty,
       COALESCE(SUM(sm."qtyBase"), 0) AS ledger_qty
FROM product_stocks ps
LEFT JOIN stock_movements sm
  ON sm."tenantId" = ps."tenantId" AND sm."productId" = ps."productId"
GROUP BY ps."tenantId", ps."productId", ps."qtyBase"
HAVING ps."qtyBase" <> COALESCE(SUM(sm."qtyBase"), 0);

-- name: stock_products_missing_cache
-- Every product that has movements must have a cached stock row.
SELECT sm."tenantId", sm."productId", COUNT(*) AS movements
FROM stock_movements sm
LEFT JOIN product_stocks ps
  ON ps."tenantId" = sm."tenantId" AND ps."productId" = sm."productId"
WHERE ps.id IS NULL
GROUP BY sm."tenantId", sm."productId";

-- name: warehouse_sum_equals_product
-- Phase 15: the split per dépôt sums to the product level (once the default dépôt has its row).
SELECT ps."tenantId", ps."productId", ps."qtyBase" AS cached_qty, SUM(ws."qtyBase") AS split_qty
FROM product_stocks ps
JOIN warehouse_stocks ws
  ON ws."tenantId" = ps."tenantId" AND ws."productId" = ps."productId"
JOIN warehouses w ON w.id = ws."warehouseId"
GROUP BY ps."tenantId", ps."productId", ps."qtyBase"
HAVING bool_or(w."isDefault") AND ps."qtyBase" <> SUM(ws."qtyBase");

-- name: warehouse_stock_equals_ledger
-- Each dépôt level equals its movements (no dépôt on a movement = the default dépôt).
SELECT ws."tenantId", ws."productId", ws."warehouseId", ws."qtyBase" AS cached_qty,
       COALESCE(SUM(sm."qtyBase"), 0) AS ledger_qty
FROM warehouse_stocks ws
JOIN warehouses w ON w.id = ws."warehouseId"
LEFT JOIN stock_movements sm
  ON sm."tenantId" = ws."tenantId" AND sm."productId" = ws."productId"
 AND (sm."warehouseId" = ws."warehouseId" OR (w."isDefault" AND sm."warehouseId" IS NULL))
GROUP BY ws."tenantId", ws."productId", ws."warehouseId", ws."qtyBase"
HAVING ws."qtyBase" <> COALESCE(SUM(sm."qtyBase"), 0);

-- name: stock_balance_chain
-- balanceAfter of every movement must equal the running sum of qtyBase, and
-- avgCostAfter must equal the running CUMP of unitCost.
WITH chain AS (
  SELECT sm."tenantId", sm."productId", sm.seq, sm."qtyBase", sm."balanceAfter",
         sm."unitCost", sm."avgCostAfter",
         SUM(sm."qtyBase") OVER (
           PARTITION BY sm."tenantId", sm."productId" ORDER BY sm.seq
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_qty
  FROM stock_movements sm
)
SELECT "tenantId", "productId", seq, "qtyBase", "balanceAfter", running_qty
FROM chain
WHERE "balanceAfter" <> running_qty;

-- name: client_balance_equals_ledger
-- Cached client balance must equal the sum of the client ledger.
SELECT cb."tenantId", cb."clientId", cb.balance AS cached_balance,
       COALESCE(SUM(le.amount), 0) AS ledger_balance
FROM client_balances cb
LEFT JOIN client_ledger_entries le
  ON le."tenantId" = cb."tenantId" AND le."clientId" = cb."clientId"
GROUP BY cb."tenantId", cb."clientId", cb.balance
HAVING cb.balance <> COALESCE(SUM(le.amount), 0);

-- name: supplier_balance_equals_ledger
-- Cached supplier balance must equal the sum of the supplier ledger (phase 21).
SELECT sb."tenantId", sb."supplierId", sb.balance AS cached_balance,
       COALESCE(SUM(le.amount), 0) AS ledger_balance
FROM supplier_balances sb
LEFT JOIN supplier_ledger_entries le
  ON le."tenantId" = sb."tenantId" AND le."supplierId" = sb."supplierId"
GROUP BY sb."tenantId", sb."supplierId", sb.balance
HAVING sb.balance <> COALESCE(SUM(le.amount), 0);

-- name: suppliers_missing_balance
-- A supplier that has ledger entries must have a cached balance row.
SELECT le."tenantId", le."supplierId", COUNT(*) AS entries
FROM supplier_ledger_entries le
LEFT JOIN supplier_balances sb
  ON sb."tenantId" = le."tenantId" AND sb."supplierId" = le."supplierId"
WHERE sb.id IS NULL
GROUP BY le."tenantId", le."supplierId";

-- name: clients_missing_balance
-- A client that has ledger entries must have a cached balance row.
SELECT le."tenantId", le."clientId", COUNT(*) AS entries
FROM client_ledger_entries le
LEFT JOIN client_balances cb
  ON cb."tenantId" = le."tenantId" AND cb."clientId" = le."clientId"
WHERE cb.id IS NULL
GROUP BY le."tenantId", le."clientId";

-- name: employee_balances_equal_ledgers
-- Phase 31: avance and congé balances equal the sum of their ledgers. Phase 31b: salary
-- rows move salaryDue instead; an avance taken back from a payslip moves both.
SELECT eb."tenantId", eb."employeeId", eb."advanceBalance", eb."salaryDue", eb."leaveDays"
FROM employee_balances eb
WHERE eb."advanceBalance" <> COALESCE((
        SELECT SUM(l.amount) FROM employee_ledger_entries l
        WHERE l."tenantId" = eb."tenantId" AND l."employeeId" = eb."employeeId"
          AND l.type NOT IN ('SALARY_DUE', 'SALARY_PAID', 'SALARY_REVERSAL')), 0)
   OR eb."salaryDue" <> COALESCE((
        SELECT SUM(CASE WHEN l.type = 'ADVANCE_DEDUCTION' THEN l.amount ELSE -l.amount END)
        FROM employee_ledger_entries l
        WHERE l."tenantId" = eb."tenantId" AND l."employeeId" = eb."employeeId"
          AND l.type IN ('SALARY_DUE', 'SALARY_PAID', 'SALARY_REVERSAL', 'ADVANCE_DEDUCTION')), 0)
   OR eb."leaveDays" <> COALESCE((
        SELECT SUM(e.days) FROM leave_entries e
        WHERE e."tenantId" = eb."tenantId" AND e."employeeId" = eb."employeeId"), 0);

-- name: document_numbers_contiguous
-- For each tenant / type / year the numbers used by documents must be exactly
-- 1..N: no gap, no duplicate, and the format PREFIX-YYYY-000001.
WITH used AS (
  SELECT "tenantId", CASE type::text WHEN 'FACTURE' THEN 'FAC' ELSE type::text END AS doctype,
         "number" FROM sales WHERE "number" IS NOT NULL
  UNION ALL SELECT "tenantId", 'AV',  "number" FROM sale_returns
  UNION ALL SELECT "tenantId", 'BR',  "number" FROM purchases WHERE "number" IS NOT NULL
  UNION ALL SELECT "tenantId", 'RF',  "number" FROM purchase_returns
  UNION ALL SELECT "tenantId", 'VER', "number" FROM payments
  UNION ALL SELECT "tenantId", 'INV', "number" FROM inventories
  UNION ALL SELECT "tenantId", 'PAIE', "number" FROM payroll_runs WHERE "number" IS NOT NULL
  -- Audit 02: the documents added since phase 12.
  UNION ALL SELECT "tenantId", 'RGF', "number" FROM supplier_payments
  UNION ALL SELECT "tenantId", 'TR',  "number" FROM stock_transfers WHERE "number" IS NOT NULL
  UNION ALL SELECT "tenantId", 'BC',  "number" FROM orders WHERE "number" IS NOT NULL
  UNION ALL SELECT "tenantId", 'DI',  "number" FROM import_files
  UNION ALL SELECT "tenantId", 'DEP', "number" FROM expenses
  UNION ALL SELECT "tenantId", 'TRF', "number" FROM cash_transfers
),
parsed AS (
  SELECT "tenantId", doctype, "number",
         (regexp_match("number", '^([A-Z]+)-([0-9]{4})-([0-9]{6})$'))[1] AS prefix,
         (regexp_match("number", '^([A-Z]+)-([0-9]{4})-([0-9]{6})$'))[2] AS yr,
         (regexp_match("number", '^([A-Z]+)-([0-9]{4})-([0-9]{6})$'))[3] AS n
  FROM used
)
SELECT "tenantId", doctype, yr,
       COUNT(*) AS numbers_used,
       COUNT(DISTINCT n) AS distinct_numbers,
       MAX(n::int) AS max_n,
       (SELECT COUNT(*) FROM (
          SELECT generate_series(1, MAX(n::int)) AS g
        ) s) AS expected_numbers
FROM parsed
GROUP BY "tenantId", doctype, yr
HAVING COUNT(*) <> COUNT(DISTINCT n)
    OR COUNT(*) <> MAX(n::int);

-- name: document_numbers_bad_format
-- Every document number must match PREFIX-YYYY-000001 and the prefix must be
-- the one of its type.
SELECT 'sales' AS src, "tenantId", "number", type::text AS doctype
FROM sales WHERE "number" IS NOT NULL
  AND "number" !~ '^(BL|FAC)-[0-9]{4}-[0-9]{6}$'
UNION ALL
SELECT 'sale_returns', "tenantId", "number", 'AV' FROM sale_returns
  WHERE "number" !~ '^AV-[0-9]{4}-[0-9]{6}$'
UNION ALL
SELECT 'purchases', "tenantId", "number", 'BR' FROM purchases WHERE "number" IS NOT NULL
  AND "number" !~ '^BR-[0-9]{4}-[0-9]{6}$'
UNION ALL
SELECT 'payments', "tenantId", "number", 'VER' FROM payments
  WHERE "number" !~ '^VER-[0-9]{4}-[0-9]{6}$'
UNION ALL
SELECT 'inventories', "tenantId", "number", 'INV' FROM inventories
  WHERE "number" !~ '^INV-[0-9]{4}-[0-9]{6}$'
UNION ALL
SELECT 'purchase_returns', "tenantId", "number", 'RF' FROM purchase_returns
  WHERE "number" !~ '^RF-[0-9]{4}-[0-9]{6}$'
UNION ALL
SELECT 'supplier_payments', "tenantId", "number", 'RGF' FROM supplier_payments
  WHERE "number" !~ '^RGF-[0-9]{4}-[0-9]{6}$'
UNION ALL
SELECT 'stock_transfers', "tenantId", "number", 'TR' FROM stock_transfers
  WHERE "number" IS NOT NULL AND "number" !~ '^TR-[0-9]{4}-[0-9]{6}$'
UNION ALL
SELECT 'orders', "tenantId", "number", 'BC' FROM orders
  WHERE "number" IS NOT NULL AND "number" !~ '^BC-[0-9]{4}-[0-9]{6}$'
UNION ALL
SELECT 'import_files', "tenantId", "number", 'DI' FROM import_files
  WHERE "number" !~ '^DI-[0-9]{4}-[0-9]{6}$'
UNION ALL
SELECT 'expenses', "tenantId", "number", 'DEP' FROM expenses
  WHERE "number" !~ '^DEP-[0-9]{4}-[0-9]{6}$'
UNION ALL
SELECT 'cash_transfers', "tenantId", "number", 'TRF' FROM cash_transfers
  WHERE "number" !~ '^TRF-[0-9]{4}-[0-9]{6}$'
UNION ALL
SELECT 'payroll_runs', "tenantId", "number", 'PAIE' FROM payroll_runs
  WHERE "number" IS NOT NULL AND "number" !~ '^PAIE-[0-9]{4}-[0-9]{6}$'
UNION ALL
SELECT 'employees', "tenantId", matricule, 'EMP' FROM employees
  WHERE matricule !~ '^EMP-[0-9]{6}$';


-- name: document_sequence_matches_usage
-- The sequence counter must equal the number of documents issued.
WITH used AS (
  SELECT "tenantId", CASE type::text WHEN 'FACTURE' THEN 'FAC' ELSE type::text END AS doctype,
         "number" FROM sales WHERE "number" IS NOT NULL
  UNION ALL SELECT "tenantId", 'AV',  "number" FROM sale_returns
  UNION ALL SELECT "tenantId", 'BR',  "number" FROM purchases WHERE "number" IS NOT NULL
  UNION ALL SELECT "tenantId", 'RF',  "number" FROM purchase_returns
  UNION ALL SELECT "tenantId", 'VER', "number" FROM payments
  UNION ALL SELECT "tenantId", 'INV', "number" FROM inventories
  UNION ALL SELECT "tenantId", 'PAIE', "number" FROM payroll_runs WHERE "number" IS NOT NULL
  -- Audit 02: the documents added since phase 12.
  UNION ALL SELECT "tenantId", 'RGF', "number" FROM supplier_payments
  UNION ALL SELECT "tenantId", 'TR',  "number" FROM stock_transfers WHERE "number" IS NOT NULL
  UNION ALL SELECT "tenantId", 'BC',  "number" FROM orders WHERE "number" IS NOT NULL
  UNION ALL SELECT "tenantId", 'DI',  "number" FROM import_files
  UNION ALL SELECT "tenantId", 'DEP', "number" FROM expenses
  UNION ALL SELECT "tenantId", 'TRF', "number" FROM cash_transfers
),
counts AS (
  SELECT "tenantId", doctype, SUBSTRING("number" FROM '^[A-Z]+-([0-9]{4})-')::int AS yr,
         COUNT(*) AS n
  FROM used GROUP BY 1, 2, 3
)
SELECT ds."tenantId", ds."docType"::text, ds.year, ds."lastNumber", counts.n AS used
FROM document_sequences ds
LEFT JOIN counts
  ON counts."tenantId" = ds."tenantId" AND counts.doctype = ds."docType"::text AND counts.yr = ds.year
WHERE ds."lastNumber" <> COALESCE(counts.n, 0)
  -- Matricules never restart (year 0) and are not documents.
  AND ds."docType"::text <> 'EMP';

-- name: ledger_tables_have_no_updated_at
-- Append-only tables must not even have an updatedAt column: an UPDATE would
-- then be impossible without a migration.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('stock_movements', 'client_ledger_entries', 'payment_allocations',
                     'audit_logs', 'document_prints', 'attendance_events',
                     'employee_salaries', 'employee_ledger_entries', 'leave_entries',
                     'payroll_rate_sets', 'payroll_rate_confirmations', 'employee_pay_items')
  AND column_name IN ('updated_at', 'updatedat');

-- name: money_columns_are_numeric
-- Money/quantity columns must be numeric with the declared precision, never
-- float, double or int.
SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND data_type IN ('double precision', 'real')
  -- clients.lat_f / lng_f (phase 35) are the float twins of lat / lng the geo index needs.
  AND column_name NOT IN ('lat_f', 'lng_f')
  AND table_name IN (
    'sales', 'sale_lines', 'sale_returns', 'sale_return_lines',
    'purchases', 'purchase_lines', 'purchase_returns', 'purchase_return_lines',
    'payments', 'payment_allocations', 'client_ledger_entries', 'client_balances',
    'product_stocks', 'stock_movements', 'product_prices', 'inventory_lines',
    'tenants', 'clients', 'products', 'product_units');

-- name: money_columns_wrong_scale
-- Money columns must be numeric(14,2) and quantity columns numeric(14,3).
-- Cost columns (unitCost / avgCost / unitCostBase) are numeric(14,4) on purpose
-- (CUMP precision) and are not listed here.
WITH expected(table_name, column_name, scale) AS (
  VALUES
    ('sales','totalHt',2), ('sales','totalTva',2), ('sales','totalTtc',2),
    ('sales','timbre',2), ('sales','paidAmount',2),
    ('sale_lines','unitPriceHt',2), ('sale_lines','listPriceHt',2), ('sale_lines','lineHt',2),
    ('sale_returns','totalHt',2), ('sale_returns','totalTva',2), ('sale_returns','totalTtc',2),
    ('sale_return_lines','unitPriceHt',2), ('sale_return_lines','lineHt',2),
    ('purchases','totalHt',2), ('purchases','totalTva',2), ('purchases','totalTtc',2),
    ('purchases','paidAmount',2),
    ('purchase_lines','lineHt',2),
    ('purchase_returns','totalHt',2), ('purchase_returns','totalTva',2), ('purchase_returns','totalTtc',2),
    ('purchase_return_lines','lineHt',2),
    ('payments','amount',2), ('payment_allocations','amount',2),
    ('client_ledger_entries','amount',2), ('client_balances','balance',2),
    ('clients','creditLimit',2), ('product_prices','priceHt',2),
    ('sale_lines','qty',3), ('sale_lines','qtyBase',3),
    ('sale_return_lines','qty',3), ('sale_return_lines','qtyBase',3),
    ('purchase_lines','qty',3), ('purchase_lines','qtyBase',3),
    ('purchase_return_lines','qty',3), ('purchase_return_lines','qtyBase',3),
    ('product_stocks','qtyBase',3), ('stock_movements','qtyBase',3),
    ('stock_movements','balanceAfter',3),
    ('inventory_lines','countedQtyBase',3), ('inventory_lines','expectedQtyBase',3),
    ('inventory_lines','diffQtyBase',3)
)
SELECT c.table_name, c.column_name, c.data_type, c.numeric_precision, c.numeric_scale, e.scale AS expected
FROM information_schema.columns c
JOIN expected e ON e.table_name = c.table_name AND e.column_name = c.column_name
WHERE c.table_schema = 'public'
  AND (c.data_type <> 'numeric' OR c.numeric_scale <> e.scale
       OR (c.numeric_precision IS NOT NULL AND c.numeric_precision < 14));

-- name: business_tables_without_tenant
-- Every business table must carry a tenantId.
SELECT table_name
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND t.table_name <> '_prisma_migrations'
  AND t.table_name <> 'tenants'
  -- Platform tables (phases 13, 13b): plans and prices are the same for every company and
  -- the super-admins belong to none.
  AND t.table_name NOT IN ('plans', 'edition_prices', 'platform_admins', 'platform_admin_sessions')
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = t.table_name AND c.column_name = 'tenantId');

-- name: composite_indexes_start_with_tenant
-- Every composite index that mentions tenantId must have it as its first column.
SELECT c.relname AS table_name, i.relname AS index_name,
       (SELECT array_agg(att.attname ORDER BY k.ord)
        FROM pg_index idx
        CROSS JOIN LATERAL unnest(idx.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute att ON att.attrelid = idx.indrelid AND att.attnum = k.attnum
        WHERE idx.indexrelid = i.oid) AS columns
FROM pg_index idx
JOIN pg_class i ON i.oid = idx.indexrelid
JOIN pg_class c ON c.oid = idx.indrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'sales','sale_lines','sale_returns','sale_return_lines','purchases','purchase_lines',
    'purchase_returns','purchase_return_lines','payments','payment_allocations',
    'client_ledger_entries','client_balances','stock_movements','product_stocks',
    'products','product_units','product_prices','clients','suppliers','categories',
    'units','price_levels','inventories','inventory_lines','audit_logs','sessions',
    'import_jobs','idempotency_keys','document_prints','document_sequences')
  AND idx.indkey::int[]::text LIKE '%tenantId%'
  AND (SELECT att.attname FROM pg_index i2
       CROSS JOIN LATERAL unnest(i2.indkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute att ON att.attrelid = i2.indrelid AND att.attnum = k.attnum
       WHERE i2.indexrelid = i.oid AND k.ord = 1) IS DISTINCT FROM 'tenantId';

-- name: deleted_at_only_on_master_data
-- deletedAt must not exist on ledger or document tables.
SELECT table_name
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'deletedAt'
  AND table_name IN ('sales','sale_lines','sale_returns','sale_return_lines','purchases',
                     'purchase_lines','purchase_returns','purchase_return_lines','payments',
                     'payment_allocations','client_ledger_entries','client_balances',
                     'stock_movements','product_stocks','inventory_lines','tenants','units',
                     'price_levels');

-- name: validated_sale_has_ledger_and_audit
-- A validated sale must leave: an audit row, stock movements and a client
-- ledger entry. A facture that groups BLs has no effect of its own (the BLs
-- keep theirs), so it is excluded.
SELECT s.id, s."tenantId", s.number, s.status, s."clientId" IS NOT NULL AS has_client,
       (SELECT COUNT(*) FROM client_ledger_entries le
         WHERE le."tenantId" = s."tenantId" AND le."refId" = s.id AND le.type = 'SALE') AS ledger_rows,
       (SELECT COUNT(*) FROM stock_movements sm
         WHERE sm."tenantId" = s."tenantId" AND sm."refId" = s.id) AS movement_rows,
       (SELECT COUNT(*) FROM audit_logs a
         WHERE a."tenantId" = s."tenantId" AND a."entityId" = s.id::text AND a.action = 'SALE_VALIDATED') AS audit_rows
FROM sales s
WHERE s.status = 'VALIDATED'
  AND NOT EXISTS (SELECT 1 FROM sales b WHERE b."tenantId" = s."tenantId" AND b."invoiceId" = s.id)
  AND (
    (s."clientId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM client_ledger_entries le
        WHERE le."tenantId" = s."tenantId" AND le."refId" = s.id AND le.type = 'SALE'))
    OR NOT EXISTS (SELECT 1 FROM stock_movements sm
        WHERE sm."tenantId" = s."tenantId" AND sm."refId" = s.id)
    OR NOT EXISTS (SELECT 1 FROM audit_logs a
        WHERE a."tenantId" = s."tenantId" AND a."entityId" = s.id::text AND a.action = 'SALE_VALIDATED')
  );

-- name: sale_operation_rows_share_created_at
-- The schema documents createdAt as the transaction time: "createdAt is the
-- transaction start, shared by a batch" (StockMovement) and "createdAt is
-- shared by a transaction" (ClientLedgerEntry). The rows written by ONE sale
-- validation (lines, movements, ledger, audit) must therefore share it.
SELECT s.id, s.number, s."tenantId",
       sm."createdAt" AS movement_at, le."createdAt" AS ledger_at, a."createdAt" AS audit_at
FROM sales s
JOIN stock_movements sm ON sm."tenantId" = s."tenantId" AND sm."refId" = s.id
JOIN client_ledger_entries le ON le."tenantId" = s."tenantId" AND le."refId" = s.id
JOIN audit_logs a ON a."tenantId" = s."tenantId" AND a."entityId" = s.id::text AND a.action = 'SALE_VALIDATED'
WHERE s.status = 'VALIDATED'
  AND (sm."createdAt" <> le."createdAt" OR sm."createdAt" <> a."createdAt");

-- name: validated_purchase_has_movements_and_audit
SELECT p.id, p."tenantId", p.number,
       (SELECT COUNT(*) FROM stock_movements sm
         WHERE sm."tenantId" = p."tenantId" AND sm."refId" = p.id) AS movement_rows,
       (SELECT COUNT(*) FROM audit_logs a
         WHERE a."tenantId" = p."tenantId" AND a."entityId" = p.id::text) AS audit_rows
FROM purchases p
WHERE p.status = 'VALIDATED'
  AND (
    NOT EXISTS (SELECT 1 FROM stock_movements sm
        WHERE sm."tenantId" = p."tenantId" AND sm."refId" = p.id)
    OR NOT EXISTS (SELECT 1 FROM audit_logs a
        WHERE a."tenantId" = p."tenantId" AND a."entityId" = p.id::text)
  );

-- name: validated_payment_has_ledger_and_audit
-- A standalone versement posts its own PAYMENT entry and its own audit row.
-- A payment created together with a sale is part of the sale operation: the
-- sale posts the ledger entry itself, so the payment has none of its own.
SELECT pay.id, pay."tenantId", pay.number, pay.status,
       (SELECT COUNT(*) FROM client_ledger_entries le
         WHERE le."tenantId" = pay."tenantId" AND le."refId" = pay.id) AS ledger_rows,
       (SELECT COUNT(*) FROM audit_logs a
         WHERE a."tenantId" = pay."tenantId" AND a."entityId" = pay.id::text) AS audit_rows
FROM payments pay
WHERE pay.status = 'VALID' AND pay."saleId" IS NULL AND pay."clientId" IS NOT NULL
  AND (
    NOT EXISTS (SELECT 1 FROM client_ledger_entries le
        WHERE le."tenantId" = pay."tenantId" AND le."refId" = pay.id)
    OR NOT EXISTS (SELECT 1 FROM audit_logs a
        WHERE a."tenantId" = pay."tenantId" AND a."entityId" = pay.id::text)
  );

-- name: cancelled_sale_has_reversing_entries
-- A cancelled sale is reversed, never deleted: the goods come back and the
-- client account gets its money back. A facture that grouped BLs has no effect
-- of its own (its lines come from the BLs: sourceLineId is set).
SELECT s.id, s.number, s."tenantId", s."clientId" IS NOT NULL AS has_client,
       (SELECT COUNT(*) FROM stock_movements sm
         WHERE sm."tenantId" = s."tenantId" AND sm."refId" = s.id AND sm.type = 'SALE_RETURN') AS back_rows,
       (SELECT COUNT(*) FROM client_ledger_entries le
         WHERE le."tenantId" = s."tenantId" AND le."refId" = s.id AND le.type = 'REVERSAL') AS reversal_rows
FROM sales s
WHERE s.status = 'CANCELLED' AND s."validatedAt" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sale_lines sl
                   WHERE sl."saleId" = s.id AND sl."sourceLineId" IS NOT NULL)
  AND (
    (EXISTS (SELECT 1 FROM stock_movements sm
              WHERE sm."tenantId" = s."tenantId" AND sm."refId" = s.id AND sm.type = 'SALE')
     AND NOT EXISTS (SELECT 1 FROM stock_movements sm
              WHERE sm."tenantId" = s."tenantId" AND sm."refId" = s.id AND sm.type = 'SALE_RETURN'))
    OR (EXISTS (SELECT 1 FROM client_ledger_entries le
                 WHERE le."tenantId" = s."tenantId" AND le."refId" = s.id AND le.type = 'SALE')
        AND NOT EXISTS (SELECT 1 FROM client_ledger_entries le
                 WHERE le."tenantId" = s."tenantId" AND le."refId" = s.id AND le.type = 'REVERSAL'))
  );

-- name: no_orphan_ledger_rows
-- A ledger row must always point to an existing document.
SELECT le.id, le."tenantId", le.type, le."refType", le."refId"
FROM client_ledger_entries le
WHERE le."refType" = 'SALE' AND le."refId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = le."refId");

-- name: packaging_balance_equals_ledger
-- Phase 20: each client's cached packaging count equals the sum of its packaging ledger.
SELECT pb."tenantId", pb."clientId", pb."packagingTypeId", pb.balance,
       COALESCE(SUM(pe.qty), 0) AS ledger
FROM client_packaging_balances pb
LEFT JOIN client_packaging_entries pe
  ON pe."tenantId" = pb."tenantId" AND pe."clientId" = pb."clientId"
 AND pe."packagingTypeId" = pb."packagingTypeId"
GROUP BY pb."tenantId", pb."clientId", pb."packagingTypeId", pb.balance
HAVING pb.balance <> COALESCE(SUM(pe.qty), 0);

-- name: cash_balance_equals_ledger
-- Phase 34: each account's cached balance equals its ledger, without what is dated before
-- its opening.
SELECT b."tenantId", b."cashAccountId", b.balance,
       COALESCE(SUM(m.amount) FILTER (
         WHERE a."openingDate" IS NULL OR m.date >= a."openingDate"), 0) AS ledger
FROM cash_account_balances b
JOIN cash_accounts a ON a.id = b."cashAccountId"
LEFT JOIN cash_movements m
  ON m."tenantId" = b."tenantId" AND m."cashAccountId" = b."cashAccountId"
GROUP BY b."tenantId", b."cashAccountId", b.balance
HAVING b.balance <> COALESCE(SUM(m.amount) FILTER (
  WHERE a."openingDate" IS NULL OR m.date >= a."openingDate"), 0);

-- ============================================================================
-- Audit 02 (2026-11): phases 12 to 34. Same rule: a block that returns a row is
-- a violated invariant.
-- ============================================================================

-- name: employee_matricules_contiguous
-- Matricules are EMP-000001..N per tenant and never restart (an archived employee keeps his).
SELECT "tenantId", COUNT(*) AS used, COUNT(DISTINCT matricule) AS distinct_used,
       MAX(SUBSTRING(matricule FROM '([0-9]+)$')::int) AS max_n
FROM employees
GROUP BY "tenantId"
HAVING COUNT(*) <> COUNT(DISTINCT matricule)
    OR COUNT(*) <> MAX(SUBSTRING(matricule FROM '([0-9]+)$')::int);

-- name: supplier_currency_balance_equals_ledger
-- Phase 22: the balance in the supplier's currency equals its ledger too.
SELECT sb."tenantId", sb."supplierId", sb."balanceCurrency" AS cached,
       COALESCE(SUM(le."amountCurrency"), 0) AS ledger
FROM supplier_balances sb
LEFT JOIN supplier_ledger_entries le
  ON le."tenantId" = sb."tenantId" AND le."supplierId" = sb."supplierId"
GROUP BY sb."tenantId", sb."supplierId", sb."balanceCurrency"
HAVING sb."balanceCurrency" IS NOT NULL
   AND sb."balanceCurrency" <> COALESCE(SUM(le."amountCurrency"), 0);

-- name: ledger_rows_missing_cached_balance
-- A cash account or an employee with ledger rows must have its cached balance row.
SELECT 'cash_movements' AS ledger, m."tenantId", m."cashAccountId"::text AS party, COUNT(*) AS entries
FROM cash_movements m
LEFT JOIN cash_account_balances b
  ON b."tenantId" = m."tenantId" AND b."cashAccountId" = m."cashAccountId"
WHERE b."cashAccountId" IS NULL
GROUP BY m."tenantId", m."cashAccountId"
UNION ALL
SELECT 'employee_ledger_entries', l."tenantId", l."employeeId"::text, COUNT(*)
FROM employee_ledger_entries l
LEFT JOIN employee_balances b
  ON b."tenantId" = l."tenantId" AND b."employeeId" = l."employeeId"
WHERE b."employeeId" IS NULL
GROUP BY l."tenantId", l."employeeId"
UNION ALL
SELECT 'leave_entries', l."tenantId", l."employeeId"::text, COUNT(*)
FROM leave_entries l
LEFT JOIN employee_balances b
  ON b."tenantId" = l."tenantId" AND b."employeeId" = l."employeeId"
WHERE b."employeeId" IS NULL
GROUP BY l."tenantId", l."employeeId";

-- name: ledger_tables_are_append_only
-- AGENTS.md 3.1: "Never UPDATE a ledger row". Every ledger table must carry an enabled
-- BEFORE UPDATE OR DELETE row trigger, so a row that exists was never rewritten.
-- run-invariants.ts also tries it for real on the nine money, stock and time ledgers.
WITH ledgers(table_name) AS (
  VALUES ('stock_movements'), ('client_ledger_entries'), ('supplier_ledger_entries'),
         ('employee_ledger_entries'), ('cash_movements'), ('leave_entries'),
         ('client_packaging_entries'), ('audit_logs'), ('attendance_events'),
         ('import_cost_allocations'), ('employee_salaries'), ('document_prints'),
         ('geo_check_reviews'), ('payroll_rate_sets'), ('payroll_rate_confirmations'),
         ('employee_pay_items')
)
SELECT l.table_name
FROM ledgers l
WHERE NOT EXISTS (
  SELECT 1 FROM pg_trigger t
  WHERE t.tgrelid = ('public.' || quote_ident(l.table_name))::regclass
    AND NOT t.tgisinternal
    AND t.tgenabled IN ('O', 'A')
    AND (t.tgtype & 1) = 1    -- FOR EACH ROW
    AND (t.tgtype & 2) = 2    -- BEFORE
    AND (t.tgtype & 8) = 8    -- DELETE
    AND (t.tgtype & 16) = 16  -- UPDATE
);

-- name: ledger_like_tables_without_append_only_trigger
-- Tables named like the rows of an operation (`*_entries`, `*_movements`, `*_allocations`,
-- `*_events`) that no UPDATE / DELETE trigger protects.
SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname ~ '(_entries|_movements|_allocations|_events)$'
  AND NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')
      AND (t.tgtype & 8) = 8 AND (t.tgtype & 16) = 16);

-- name: tenant_tables_without_rls
-- AGENTS.md 3.5 and architecture.md: every table with a tenantId has row-level security
-- on and at least one policy.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       (SELECT COUNT(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND EXISTS (SELECT 1 FROM pg_attribute a
               WHERE a.attrelid = c.oid AND a.attname = 'tenantId' AND NOT a.attisdropped)
  AND (NOT c.relrowsecurity
       OR NOT EXISTS (SELECT 1 FROM pg_policies p
                       WHERE p.schemaname = 'public' AND p.tablename = c.relname));

-- name: rls_policies_not_bound_to_the_tenant
-- A policy on a tenant table must compare tenantId with the session's app.tenant_id.
SELECT p.tablename, p.policyname, p.qual
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND EXISTS (SELECT 1 FROM information_schema.columns k
               WHERE k.table_schema = 'public' AND k.table_name = p.tablename
                 AND k.column_name = 'tenantId')
  AND POSITION('"tenantId" = (NULLIF(current_setting(''app.tenant_id''' IN COALESCE(p.qual, '')) = 0
  -- A table only the platform reads (platform_audit_logs) is closed to every tenant.
  AND COALESCE(p.qual, '') <> '(current_setting(''app.rls_bypass''::text, true) = ''on''::text)';

-- name: tenant_tables_without_tenant_leading_index
-- AGENTS.md 3.5: "Composite indexes start with tenantId". Every table with a tenantId
-- needs at least one index whose first column is tenantId.
SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND EXISTS (SELECT 1 FROM pg_attribute a
               WHERE a.attrelid = c.oid AND a.attname = 'tenantId' AND NOT a.attisdropped)
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = c.oid AND a.attname = 'tenantId');

-- name: float_columns
-- No float anywhere, except the two generated columns the geo index uses (not money).
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND data_type IN ('double precision', 'real', 'money')
  AND (table_name, column_name) NOT IN (('clients', 'lat_f'), ('clients', 'lng_f'));

-- name: numeric_columns_of_an_unknown_shape
-- Every numeric column of the schema has one of the shapes below. A new shape must be a
-- decision, not an accident: money is (14,2), a quantity (14,3), a unit cost (14,4).
SELECT table_name, column_name, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public' AND data_type = 'numeric'
  AND (numeric_precision, numeric_scale) NOT IN (
    (14,2),          -- money
    (14,3),          -- quantities
    (14,4),          -- unit costs (CUMP precision), lissage terms
    (12,6),          -- exchange rates
    (9,6),           -- latitude / longitude
    (5,2), (4,2),    -- percentages, hours of a day
    (6,1), (3,1),    -- congé days
    (6,2), (6,4), (7,4), (8,4),  -- payroll divisors and rates, timbre rate
    (16,3),          -- incentive targets (money or units)
    (12,3), (12,4),  -- weight, volume, price per million tokens (USD)
    (10,2)           -- payslip line quantity (days, hours)
  );

-- name: money_named_columns_outside_14_2
-- AGENTS.md 3.4: money is Decimal(14,2). Any numeric column named like money must be it.
-- Unit costs are (14,4) on purpose and USD-per-token prices are not tenant money.
SELECT table_name, column_name, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public' AND data_type = 'numeric'
  AND column_name ~* '(amount|total|balance|price|paid|salary|cash|ecart|timbre|deposit|gross|^net|irg|cnas|retenue|cotisable|taxable|creditLimit|lineHt|supplement|threshold|expected|handed|counted|valueDelta|stockValue|snmg|employerCost)'
  AND column_name !~* '(PerMTok|balanceAfter|exchangeRate|timbreRate|Rate$|Qty)'
  AND NOT (numeric_precision = 14 AND numeric_scale = 2);

-- name: quantity_named_columns_outside_14_3
-- AGENTS.md 3.4: quantities are Decimal(14,3) in the base unit.
SELECT table_name, column_name, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public' AND data_type = 'numeric'
  AND (column_name ~ '(^qty|Qty|factorToBase|minStock)'
       OR (table_name = 'stock_movements' AND column_name = 'balanceAfter'))
  AND NOT (numeric_precision = 14 AND numeric_scale = 3);

-- name: sale_totals_equal_their_lines
-- A numbered sale: total HT = sum of its lines, TTC = HT + TVA + timbre.
SELECT s."tenantId", s.id, s."number", s."totalHt", SUM(l."lineHt") AS lines_ht,
       s."totalTva", s.timbre, s."totalTtc"
FROM sales s
JOIN sale_lines l ON l."saleId" = s.id
WHERE s."number" IS NOT NULL
GROUP BY s."tenantId", s.id, s."number", s."totalHt", s."totalTva", s.timbre, s."totalTtc"
HAVING s."totalHt" <> SUM(l."lineHt")
    OR s."totalTtc" <> s."totalHt" + s."totalTva" + COALESCE(s.timbre, 0);

-- name: sale_stock_movements_equal_their_lines
-- What a validated sale took out of stock is exactly what its lines say (a facture made
-- from BLs moves nothing: its lines have a sourceLineId).
SELECT s."tenantId", s.id, s."number",
       (SELECT COALESCE(SUM(l."qtyBase"), 0) FROM sale_lines l
         WHERE l."saleId" = s.id AND l."sourceLineId" IS NULL) AS lines_qty,
       (SELECT COALESCE(-SUM(m."qtyBase"), 0) FROM stock_movements m
         WHERE m."tenantId" = s."tenantId" AND m."refId" = s.id AND m.type = 'SALE') AS moved_qty
FROM sales s
WHERE s."validatedAt" IS NOT NULL
  AND (SELECT COALESCE(SUM(l."qtyBase"), 0) FROM sale_lines l
        WHERE l."saleId" = s.id AND l."sourceLineId" IS NULL)
   <> (SELECT COALESCE(-SUM(m."qtyBase"), 0) FROM stock_movements m
        WHERE m."tenantId" = s."tenantId" AND m."refId" = s.id AND m.type = 'SALE');

-- name: stock_transfer_movements_sum_to_zero
-- A transfer moves goods between two dépôts: for the company its movements sum to zero
-- (validated: out + in; cancelled: out + in + in + out).
SELECT m."tenantId", m."refId" AS transfer_id, m."productId", SUM(m."qtyBase") AS net
FROM stock_movements m
WHERE m."refType" = 'StockTransfer'
GROUP BY m."tenantId", m."refId", m."productId"
HAVING SUM(m."qtyBase") <> 0;

-- name: negative_stock_while_blocked
-- A tenant in BLOCK mode holds no negative dépôt level (concurrent sales of the last unit
-- included).
SELECT ws."tenantId", ws."productId", ws."warehouseId", ws."qtyBase"
FROM warehouse_stocks ws
JOIN tenants t ON t.id = ws."tenantId"
WHERE t."negativeStockMode" = 'BLOCK' AND ws."qtyBase" < 0;

-- name: cash_transfer_movements_sum_to_zero
-- Phase 34: a transfer between two accounts is neither cash in nor cash out.
SELECT m."tenantId", m."refId" AS transfer_id, SUM(m.amount) AS net
FROM cash_movements m
WHERE m."refType" = 'CashTransfer'
GROUP BY m."tenantId", m."refId"
HAVING SUM(m.amount) <> 0;

-- name: money_documents_move_their_account_exactly_once
-- Phase 34: "A document moves an account once and reverses it once". A valid versement
-- nets +amount on its account, a valid règlement or dépense -amount, and a cancelled or
-- bounced one nets zero. Rows written before the TREASURY backfill have no account.
SELECT 'payments' AS doc, p."tenantId", p.id, p."number", p.status::text, p.amount,
       COALESCE((SELECT SUM(m.amount) FROM cash_movements m
                  WHERE m."tenantId" = p."tenantId" AND m."refType" = 'Payment' AND m."refId" = p.id), 0) AS moved
FROM payments p
WHERE p."cashAccountId" IS NOT NULL
  AND COALESCE((SELECT SUM(m.amount) FROM cash_movements m
                 WHERE m."tenantId" = p."tenantId" AND m."refType" = 'Payment' AND m."refId" = p.id), 0)
      <> CASE WHEN p.status = 'VALID' THEN p.amount ELSE 0 END
UNION ALL
SELECT 'supplier_payments', p."tenantId", p.id, p."number", p.status::text, p.amount,
       COALESCE((SELECT SUM(m.amount) FROM cash_movements m
                  WHERE m."tenantId" = p."tenantId" AND m."refType" = 'SupplierPayment' AND m."refId" = p.id), 0)
FROM supplier_payments p
WHERE p."cashAccountId" IS NOT NULL
  AND COALESCE((SELECT SUM(m.amount) FROM cash_movements m
                 WHERE m."tenantId" = p."tenantId" AND m."refType" = 'SupplierPayment' AND m."refId" = p.id), 0)
      <> CASE WHEN p.status = 'VALID' THEN -p.amount ELSE 0 END
UNION ALL
SELECT 'expenses', e."tenantId", e.id, e."number", e.status::text, e.amount,
       COALESCE((SELECT SUM(m.amount) FROM cash_movements m
                  WHERE m."tenantId" = e."tenantId" AND m."refType" = 'Expense' AND m."refId" = e.id), 0)
FROM expenses e
WHERE e."cashAccountId" IS NOT NULL
  AND COALESCE((SELECT SUM(m.amount) FROM cash_movements m
                 WHERE m."tenantId" = e."tenantId" AND m."refType" = 'Expense' AND m."refId" = e.id), 0)
      <> CASE WHEN e.status = 'VALID' THEN -e.amount ELSE 0 END;

-- name: payslips_add_up
-- Phase 31b: net = brut - CNAS - IRG and net à payer = net - retenues - avance, to the centime.
SELECT p."tenantId", p.id, p.matricule, p.gross, p."cnasEmployee", p.irg, p.net,
       p.retenues, p."advanceDeducted", p."netToPay"
FROM payslips p
JOIN payroll_runs r ON r.id = p."runId"
WHERE r.status <> 'CANCELLED'
  AND (p.net <> p.gross - p."cnasEmployee" - p.irg
       OR p."netToPay" <> p.net - p.retenues - p."advanceDeducted");

-- name: payroll_paid_more_than_due
-- What was paid for an employee of a run (its valid dépenses) never exceeds his net à payer.
SELECT p."tenantId", p."runId", p."employeeId", p."netToPay", SUM(e.amount) AS paid
FROM payslips p
JOIN expenses e
  ON e."tenantId" = p."tenantId" AND e."payrollRunId" = p."runId"
 AND e."employeeId" = p."employeeId" AND e.status = 'VALID'
GROUP BY p."tenantId", p."runId", p."employeeId", p."netToPay"
HAVING SUM(e.amount) > p."netToPay";

-- name: payroll_runs_live_twice_or_badly_numbered
-- One live run per month and dépôt; an approved run has a number, a draft has none.
SELECT r."tenantId", r.month, r."warehouseId", COUNT(*) AS live_runs,
       COUNT(*) FILTER (WHERE r.status = 'DRAFT' AND r."number" IS NOT NULL) AS numbered_drafts,
       COUNT(*) FILTER (WHERE r.status = 'APPROVED' AND r."number" IS NULL) AS approved_without_number
FROM payroll_runs r
WHERE r.status <> 'CANCELLED'
GROUP BY r."tenantId", r.month, r."warehouseId"
HAVING COUNT(*) > 1
    OR COUNT(*) FILTER (WHERE r.status = 'DRAFT' AND r."number" IS NOT NULL) > 0
    OR COUNT(*) FILTER (WHERE r.status = 'APPROVED' AND r."number" IS NULL) > 0;

-- name: salary_posted_twice
-- An approved payslip posts SALARY_DUE once (approving the same run twice must not double it).
SELECT l."tenantId", l."employeeId", l."payrollRunId", COUNT(*) AS salary_due_rows
FROM employee_ledger_entries l
WHERE l.type = 'SALARY_DUE'
GROUP BY l."tenantId", l."employeeId", l."payrollRunId"
HAVING COUNT(*) > 1;

-- name: order_lines_deliver_more_than_ordered
-- Phase 16: what was delivered plus what came back never exceeds what was ordered.
SELECT l."tenantId", l."orderId", l.id, l.qty, l."qtyDelivered", l."qtyNotDelivered"
FROM order_lines l
WHERE l."qtyDelivered" + l."qtyNotDelivered" > l.qty OR l."qtyDelivered" < 0 OR l."qtyNotDelivered" < 0;

-- name: idempotency_keys_used_twice
-- A key answers one request of a tenant.
SELECT "tenantId", key, COUNT(*) AS n
FROM idempotency_keys
GROUP BY "tenantId", key
HAVING COUNT(*) > 1;

-- name: rows_pointing_at_another_tenant
-- A row never points at a parent of another tenant.
SELECT 'sales.clientId' AS link, s.id::text AS row_id FROM sales s JOIN clients c ON c.id = s."clientId" WHERE c."tenantId" <> s."tenantId"
UNION ALL SELECT 'payments.clientId', p.id::text FROM payments p JOIN clients c ON c.id = p."clientId" WHERE c."tenantId" <> p."tenantId"
UNION ALL SELECT 'sale_lines.productId', l.id::text FROM sale_lines l JOIN products p ON p.id = l."productId" WHERE p."tenantId" <> l."tenantId"
UNION ALL SELECT 'stock_movements.warehouseId', m.id::text FROM stock_movements m JOIN warehouses w ON w.id = m."warehouseId" WHERE w."tenantId" <> m."tenantId"
UNION ALL SELECT 'cash_movements.cashAccountId', m.id::text FROM cash_movements m JOIN cash_accounts a ON a.id = m."cashAccountId" WHERE a."tenantId" <> m."tenantId"
UNION ALL SELECT 'payslips.employeeId', p.id::text FROM payslips p JOIN employees e ON e.id = p."employeeId" WHERE e."tenantId" <> p."tenantId"
UNION ALL SELECT 'purchases.supplierId', p.id::text FROM purchases p JOIN suppliers s ON s.id = p."supplierId" WHERE s."tenantId" <> p."tenantId"
UNION ALL SELECT 'expenses.cashAccountId', e.id::text FROM expenses e JOIN cash_accounts a ON a.id = e."cashAccountId" WHERE a."tenantId" <> e."tenantId";
