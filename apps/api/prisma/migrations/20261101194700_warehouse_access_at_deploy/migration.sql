-- Phase 24: nobody loses access at deploy. Every user works in every existing dépôt, and
-- every truck belongs to the dépôt principal. db:backfill-units does the same
-- (idempotent) and fills the dépôt of old versements and ledger entries.
INSERT INTO "user_warehouse_access" ("id", "tenantId", "userId", "warehouseId", "level", "grantedAt")
SELECT gen_random_uuid(), u."tenantId", u."id", w."id", 'OPERATE', CURRENT_TIMESTAMP
FROM "users" u
JOIN "warehouses" w ON w."tenantId" = u."tenantId"
  AND w."type" IN ('MAIN', 'SECONDARY') AND w."deletedAt" IS NULL
ON CONFLICT ("userId", "warehouseId") DO NOTHING;

UPDATE "warehouses" t SET "parentWarehouseId" = m."id"
FROM "warehouses" m
WHERE t."type" = 'VEHICLE' AND t."parentWarehouseId" IS NULL
  AND m."tenantId" = t."tenantId" AND m."isDefault" = true;
