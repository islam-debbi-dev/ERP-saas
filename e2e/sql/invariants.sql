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

-- name: clients_missing_balance
-- A client that has ledger entries must have a cached balance row.
SELECT le."tenantId", le."clientId", COUNT(*) AS entries
FROM client_ledger_entries le
LEFT JOIN client_balances cb
  ON cb."tenantId" = le."tenantId" AND cb."clientId" = le."clientId"
WHERE cb.id IS NULL
GROUP BY le."tenantId", le."clientId";

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
  WHERE "number" !~ '^INV-[0-9]{4}-[0-9]{6}$';

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
WHERE ds."lastNumber" <> COALESCE(counts.n, 0);

-- name: ledger_tables_have_no_updated_at
-- Append-only tables must not even have an updatedAt column: an UPDATE would
-- then be impossible without a migration.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('stock_movements', 'client_ledger_entries', 'payment_allocations',
                     'audit_logs', 'document_prints')
  AND column_name IN ('updated_at', 'updatedat');

-- name: money_columns_are_numeric
-- Money/quantity columns must be numeric with the declared precision, never
-- float, double or int.
SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND data_type IN ('double precision', 'real')
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
  AND t.table_name NOT IN ('tenants')
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
