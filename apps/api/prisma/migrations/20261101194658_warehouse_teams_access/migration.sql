-- CreateEnum
CREATE TYPE "WarehouseAccessLevel" AS ENUM ('OPERATE', 'VIEW_STATS');

-- AlterTable
ALTER TABLE "client_ledger_entries" ADD COLUMN     "warehouseId" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "warehouseId" UUID;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "managerUserId" UUID,
ADD COLUMN     "parentWarehouseId" UUID;

-- CreateTable
CREATE TABLE "user_warehouse_access" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "level" "WarehouseAccessLevel" NOT NULL,
    "grantedBy" UUID,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_warehouse_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_brands" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "brandId" UUID NOT NULL,

    CONSTRAINT "warehouse_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_categories" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "warehouse_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_warehouse_access_tenantId_warehouseId_idx" ON "user_warehouse_access"("tenantId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "user_warehouse_access_userId_warehouseId_key" ON "user_warehouse_access"("userId", "warehouseId");

-- CreateIndex
CREATE INDEX "warehouse_brands_tenantId_warehouseId_idx" ON "warehouse_brands"("tenantId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_brands_warehouseId_brandId_key" ON "warehouse_brands"("warehouseId", "brandId");

-- CreateIndex
CREATE INDEX "warehouse_categories_tenantId_warehouseId_idx" ON "warehouse_categories"("tenantId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_categories_warehouseId_categoryId_key" ON "warehouse_categories"("warehouseId", "categoryId");

-- CreateIndex
CREATE INDEX "client_ledger_entries_tenantId_clientId_warehouseId_idx" ON "client_ledger_entries"("tenantId", "clientId", "warehouseId");

-- CreateIndex
CREATE INDEX "payments_tenantId_warehouseId_receivedAt_idx" ON "payments"("tenantId", "warehouseId", "receivedAt");

-- CreateIndex
CREATE INDEX "warehouses_tenantId_parentWarehouseId_idx" ON "warehouses"("tenantId", "parentWarehouseId");

-- AddForeignKey
ALTER TABLE "client_ledger_entries" ADD CONSTRAINT "client_ledger_entries_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_parentWarehouseId_fkey" FOREIGN KEY ("parentWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_brands" ADD CONSTRAINT "warehouse_brands_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_brands" ADD CONSTRAINT "warehouse_brands_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_brands" ADD CONSTRAINT "warehouse_brands_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_categories" ADD CONSTRAINT "warehouse_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_categories" ADD CONSTRAINT "warehouse_categories_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_categories" ADD CONSTRAINT "warehouse_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: a truck's parent is a dépôt (never itself); only trucks have one.
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_parent_not_self_check"
  CHECK ("parentWarehouseId" IS NULL OR "parentWarehouseId" <> "id");
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_parent_vehicle_only_check"
  CHECK ("parentWarehouseId" IS NULL OR "type" = 'VEHICLE');

-- The client ledger stays append-only. The single exception is the phase 24 backfill
-- (db:backfill-units): an UPDATE that only sets a missing warehouseId (NULL -> a value)
-- and changes nothing else. The contract release restores the strict function
-- (apps/api/prisma/contract/phase-24-units-contract.sql).
CREATE OR REPLACE FUNCTION "client_ledger_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."warehouseId" IS NULL
     AND NEW."warehouseId" IS NOT NULL
     AND (to_jsonb(NEW) - 'warehouseId') = (to_jsonb(OLD) - 'warehouseId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'client_ledger_entries is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- Row-Level Security, same policy as 20261028090000_row_level_security.
ALTER TABLE "user_warehouse_access" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "user_warehouse_access"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "warehouse_brands" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "warehouse_brands"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "warehouse_categories" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "warehouse_categories"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');
