-- Sanity checks run by restore-drill.sh on the restored copy. Output: "name|value"
-- lines; the drill fails when ledger_mismatches is not 0.
\pset footer off
SELECT 'tenants|' || count(*) FROM tenants;
SELECT 'users|' || count(*) FROM users;
SELECT 'products|' || count(*) FROM products;
SELECT 'clients|' || count(*) FROM clients;
SELECT 'sales|' || count(*) FROM sales;
SELECT 'payments|' || count(*) FROM payments;
SELECT 'stock_movements|' || count(*) FROM stock_movements;
SELECT 'client_ledger_entries|' || count(*) FROM client_ledger_entries;
SELECT 'audit_logs|' || count(*) FROM audit_logs;
SELECT 'latest_audit_at|' || coalesce(max("createdAt")::text, '-') FROM audit_logs;
SELECT 'migrations|' || count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;
-- Same ledger rules as the nightly reconcile (apps/api/src/reconcile/reconcile-sql.ts).
SELECT 'ledger_mismatches|' || (
  (SELECT count(*) FROM (
     SELECT 1 FROM product_stocks ps
     LEFT JOIN stock_movements sm
       ON sm."tenantId" = ps."tenantId" AND sm."productId" = ps."productId"
     GROUP BY ps."tenantId", ps."productId", ps."qtyBase"
     HAVING ps."qtyBase" <> COALESCE(SUM(sm."qtyBase"), 0)) s)
  +
  (SELECT count(*) FROM (
     SELECT 1 FROM client_balances cb
     LEFT JOIN client_ledger_entries le
       ON le."tenantId" = cb."tenantId" AND le."clientId" = cb."clientId"
     GROUP BY cb."tenantId", cb."clientId", cb.balance
     HAVING cb.balance <> COALESCE(SUM(le.amount), 0)) c)
);
