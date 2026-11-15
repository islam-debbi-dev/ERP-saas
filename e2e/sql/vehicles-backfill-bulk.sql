-- Part D of test-36: volume for the migration lock time and the backfill (pre-36 schema).
-- Run as the owner role on erp_t36_base after api/vehicles-backfill-seed.ts. Copies rows the
-- old API wrote in company "T36 D pre36", so every foreign key is real:
--   - 25 000 visits linked to a van sale (the backfill must give each the sale's truck),
--   - 25 000 visits with neither sale nor order (must stay null),
--   - 50 000 confirmed orders on the dépôt principal, without BL (must stay null).
\set ON_ERROR_STOP 1
\timing on
BEGIN;
CREATE TEMP TABLE t36d AS
SELECT t.id AS tenant FROM tenants t WHERE t.name LIKE 'A2 T36 D pre36 a2%' AND t.name NOT LIKE '%pre36 Q%';
DO $$ BEGIN
  IF (SELECT count(*) FROM t36d) <> 1 THEN RAISE EXCEPTION 'expected one company "T36 D pre36"'; END IF;
END $$;

INSERT INTO visits (id, "tenantId", "sellerId", "clientId", "routeId", "startedAt", "endedAt",
                    outcome, reason, note, "saleId", "orderId", "paymentId", "createdBy", "createdAt")
SELECT gen_random_uuid(), v."tenantId", v."sellerId", v."clientId", NULL,
       v."startedAt" - make_interval(mins => g), v."endedAt" - make_interval(mins => g),
       v.outcome, v.reason, 'bulk t36d', v."saleId", NULL, NULL, v."createdBy", v."createdAt"
FROM (SELECT v.* FROM visits v JOIN t36d ON v."tenantId" = t36d.tenant
      JOIN sales s ON s.id = v."saleId" JOIN warehouses w ON w.id = s."warehouseId" AND w.type = 'VEHICLE'
      ORDER BY v."createdAt" LIMIT 1) v
CROSS JOIN generate_series(1, 25000) g;

INSERT INTO visits (id, "tenantId", "sellerId", "clientId", "routeId", "startedAt", "endedAt",
                    outcome, reason, note, "saleId", "orderId", "paymentId", "createdBy", "createdAt")
SELECT gen_random_uuid(), v."tenantId", v."sellerId", v."clientId", NULL,
       v."startedAt" - make_interval(mins => g), v."endedAt" - make_interval(mins => g),
       v.outcome, v.reason, 'bulk t36d', NULL, NULL, NULL, v."createdBy", v."createdAt"
FROM (SELECT v.* FROM visits v JOIN t36d ON v."tenantId" = t36d.tenant
      WHERE v."saleId" IS NULL AND v."orderId" IS NULL ORDER BY v."createdAt" LIMIT 1) v
CROSS JOIN generate_series(1, 25000) g;

INSERT INTO orders (id, "tenantId", number, status, "clientId", "sellerId", "warehouseId",
                    "priceLevelId", note, "assujettiTva", "totalHt", "totalTva", "totalTtc",
                    version, "createdBy", "confirmedBy", "confirmedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."tenantId", 'BULK-' || lpad(g::text, 6, '0'), 'CONFIRMED', o."clientId",
       o."sellerId", o."warehouseId", o."priceLevelId", 'bulk t36d', o."assujettiTva", o."totalHt",
       o."totalTva", o."totalTtc", 1, o."createdBy", o."confirmedBy", o."confirmedAt", o."createdAt", o."updatedAt"
FROM (SELECT o.* FROM orders o JOIN t36d ON o."tenantId" = t36d.tenant
      JOIN warehouses w ON w.id = o."warehouseId" AND w.type = 'MAIN' ORDER BY o."createdAt" LIMIT 1) o
CROSS JOIN generate_series(1, 50000) g;
COMMIT;
ANALYZE visits; ANALYZE orders;
SELECT (SELECT count(*) FROM visits) AS visits, (SELECT count(*) FROM orders) AS orders,
       (SELECT count(*) FROM routes) AS routes, (SELECT count(*) FROM warehouses) AS warehouses;
