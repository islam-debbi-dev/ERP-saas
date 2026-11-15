-- Phase 36, distribution par véhicule. Expand step only: every column is nullable or has a
-- default, nothing is renamed or removed, and the version still running keeps working
-- (routes."sellerId" only loses its NOT NULL; old code always writes it).
--   - vehicle_types: the company's own kinds of trucks;
--   - warehouses: code, type, wilaya, plate, capacity (identity of a truck);
--   - vehicle_assignments: who drives which truck from when (append-only);
--   - routes / visits / orders: the truck a tournée is planned for, and the truck frozen
--     on each visit and order.

-- CreateEnum
CREATE TYPE "VehicleActivity" AS ENUM ('CASH_VAN', 'PRESALE', 'DELIVERY', 'MIXED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveryVehicleId" UUID,
ADD COLUMN     "vehicleId" UUID;

-- AlterTable
ALTER TABLE "routes" ADD COLUMN     "vehicleId" UUID,
ALTER COLUMN "sellerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "vehicleId" UUID;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "capacityKg" INTEGER,
ADD COLUMN     "code" VARCHAR(30),
ADD COLUMN     "plateNumber" VARCHAR(20),
ADD COLUMN     "vehicleTypeId" UUID,
ADD COLUMN     "wilayaCode" SMALLINT;

-- CreateTable
CREATE TABLE "vehicle_types" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "codePrefix" VARCHAR(10),
    "activity" "VehicleActivity" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_assignments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "userId" UUID,
    "fromAt" TIMESTAMPTZ(3) NOT NULL,
    "setBy" UUID,
    "reason" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_types_tenantId_deletedAt_idx" ON "vehicle_types"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "vehicle_assignments_tenantId_vehicleId_fromAt_idx" ON "vehicle_assignments"("tenantId", "vehicleId", "fromAt" DESC);

-- CreateIndex
CREATE INDEX "vehicle_assignments_tenantId_userId_fromAt_idx" ON "vehicle_assignments"("tenantId", "userId", "fromAt" DESC);

-- CreateIndex
CREATE INDEX "orders_tenantId_deliveryVehicleId_status_idx" ON "orders"("tenantId", "deliveryVehicleId", "status");

-- CreateIndex
CREATE INDEX "routes_tenantId_vehicleId_idx" ON "routes"("tenantId", "vehicleId");

-- CreateIndex
CREATE INDEX "visits_tenantId_vehicleId_startedAt_idx" ON "visits"("tenantId", "vehicleId", "startedAt");

-- CreateIndex
CREATE INDEX "warehouses_tenantId_vehicleTypeId_idx" ON "warehouses"("tenantId", "vehicleTypeId");

-- AddForeignKey
ALTER TABLE "vehicle_types" ADD CONSTRAINT "vehicle_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_setBy_fkey" FOREIGN KEY ("setBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_deliveryVehicleId_fkey" FOREIGN KEY ("deliveryVehicleId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A code is unique per company among live rows, whatever the case.
CREATE UNIQUE INDEX "vehicle_types_tenantId_code_live_key"
  ON "vehicle_types"("tenantId", lower("code")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "warehouses_tenantId_code_live_key"
  ON "warehouses"("tenantId", lower("code")) WHERE "code" IS NOT NULL AND "deletedAt" IS NULL;

ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_wilaya_code_check"
  CHECK ("wilayaCode" IS NULL OR "wilayaCode" BETWEEN 1 AND 69);
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_capacity_kg_check"
  CHECK ("capacityKg" IS NULL OR "capacityKg" > 0);
-- Type, wilaya, plate and capacity belong to trucks; any dépôt may have a code.
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_vehicle_identity_check"
  CHECK ("type" = 'VEHICLE' OR ("vehicleTypeId" IS NULL AND "wilayaCode" IS NULL
         AND "plateNumber" IS NULL AND "capacityKg" IS NULL));

-- A tournée belongs to a truck or to a seller, never to nobody.
ALTER TABLE "routes" ADD CONSTRAINT "routes_owner_check"
  CHECK ("vehicleId" IS NOT NULL OR "sellerId" IS NOT NULL);

-- The driver history is append-only, like the ledgers.
CREATE FUNCTION "vehicle_assignments_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'vehicle_assignments is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "vehicle_assignments_no_update_delete"
  BEFORE UPDATE OR DELETE ON "vehicle_assignments"
  FOR EACH ROW EXECUTE FUNCTION "vehicle_assignments_append_only"();

-- Row-Level Security, same policy as 20261028090000_row_level_security.
ALTER TABLE "vehicle_types" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "vehicle_types"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "vehicle_assignments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "vehicle_assignments"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

-- History starts with today's drivers: one row per truck that has one. What happened
-- before is not known and is never guessed.
INSERT INTO "vehicle_assignments" ("id", "tenantId", "vehicleId", "userId", "fromAt", "reason")
SELECT gen_random_uuid(), w."tenantId", w."id", w."assignedUserId", w."updatedAt", 'backfill'
FROM "warehouses" w
WHERE w."type" = 'VEHICLE' AND w."assignedUserId" IS NOT NULL AND w."deletedAt" IS NULL;
