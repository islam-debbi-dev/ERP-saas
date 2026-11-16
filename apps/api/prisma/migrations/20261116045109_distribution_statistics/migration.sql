-- Phase 37: statistiques distribution. Additive only (expand step):
--   - weightKg frozen on sale, return and transfer lines at validation (null on old rows:
--     the statistics fall back to the product's current weight and say "estimé");
--   - client_segments + clients.segmentId: the owner's own "type client / canal";
--   - vehicle_targets: monthly targets per truck (not read by the incentives engine);
--   - indexes for the statistics' hot queries.
-- Nothing is renamed, dropped or backfilled.

-- CreateEnum
CREATE TYPE "VehicleTargetMetric" AS ENUM ('CA_TTC', 'POIDS_KG', 'NB_BL', 'CLIENTS_ACTIFS');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "segmentId" UUID;

-- AlterTable
ALTER TABLE "sale_lines" ADD COLUMN     "weightKg" DECIMAL(14,3);

-- AlterTable
ALTER TABLE "sale_return_lines" ADD COLUMN     "weightKg" DECIMAL(14,3);

-- AlterTable
ALTER TABLE "stock_transfer_lines" ADD COLUMN     "weightKg" DECIMAL(14,3);

-- CreateTable
CREATE TABLE "client_segments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_targets" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "metric" "VehicleTargetMetric" NOT NULL,
    "targetValue" DECIMAL(16,3) NOT NULL,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_segments_tenantId_deletedAt_idx" ON "client_segments"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "vehicle_targets_tenantId_periodStart_idx" ON "vehicle_targets"("tenantId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_targets_tenantId_vehicleId_periodStart_metric_key" ON "vehicle_targets"("tenantId", "vehicleId", "periodStart", "metric");

-- CreateIndex
CREATE INDEX "clients_tenantId_segmentId_idx" ON "clients"("tenantId", "segmentId");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "client_segments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_segments" ADD CONSTRAINT "client_segments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_targets" ADD CONSTRAINT "vehicle_targets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_targets" ADD CONSTRAINT "vehicle_targets_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A segment code is unique among the live segments of a company, whatever the case.
CREATE UNIQUE INDEX "client_segments_tenantId_code_live_key"
  ON "client_segments"("tenantId", lower("code")) WHERE "deletedAt" IS NULL;

-- A target is for a whole month and is positive.
ALTER TABLE "vehicle_targets" ADD CONSTRAINT "vehicle_targets_periodStart_first_day"
  CHECK (EXTRACT(DAY FROM "periodStart") = 1);
ALTER TABLE "vehicle_targets" ADD CONSTRAINT "vehicle_targets_targetValue_positive"
  CHECK ("targetValue" > 0);

-- Statistics per truck: the counted sales of a dépôt or a truck over a period.
CREATE INDEX "sales_tenantId_warehouseId_validatedAt_validated_idx"
  ON "sales"("tenantId", "warehouseId", "validatedAt") WHERE "status" = 'VALIDATED';
-- Chargements of a truck over a period.
CREATE INDEX "stock_transfers_tenantId_toWarehouseId_validatedAt_idx"
  ON "stock_transfers"("tenantId", "toWarehouseId", "validatedAt");

-- Row-Level Security, same policy as 20261028090000_row_level_security.
ALTER TABLE "client_segments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "client_segments"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "vehicle_targets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "vehicle_targets"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');
