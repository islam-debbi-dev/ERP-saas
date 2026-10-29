-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('MAIN', 'SECONDARY', 'VEHICLE');

-- CreateEnum
CREATE TYPE "StockTransferType" AS ENUM ('LOAD', 'UNLOAD', 'TRANSFER');

-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('DRAFT', 'VALIDATED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "DocType" ADD VALUE 'TR';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_IN';

-- AlterTable
ALTER TABLE "inventories" ADD COLUMN     "warehouseId" UUID;

-- AlterTable
ALTER TABLE "purchase_returns" ADD COLUMN     "warehouseId" UUID;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "warehouseId" UUID;

-- AlterTable
ALTER TABLE "sale_returns" ADD COLUMN     "warehouseId" UUID;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "warehouseId" UUID;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "warehouseId" UUID;

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "type" "WarehouseType" NOT NULL,
    "assignedUserId" UUID,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_stocks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qtyBase" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warehouse_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" VARCHAR(20),
    "type" "StockTransferType" NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "fromWarehouseId" UUID NOT NULL,
    "toWarehouseId" UUID NOT NULL,
    "note" VARCHAR(255),
    "createdBy" UUID,
    "validatedBy" UUID,
    "validatedAt" TIMESTAMPTZ(3),
    "cancelledBy" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "qtyBase" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouses_tenantId_type_idx" ON "warehouses"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenantId_name_key" ON "warehouses"("tenantId", "name");

-- CreateIndex
CREATE INDEX "warehouse_stocks_tenantId_productId_idx" ON "warehouse_stocks"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_stocks_warehouseId_productId_key" ON "warehouse_stocks"("warehouseId", "productId");

-- CreateIndex
CREATE INDEX "stock_transfers_tenantId_createdAt_idx" ON "stock_transfers"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_transfers_tenantId_status_idx" ON "stock_transfers"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenantId_number_key" ON "stock_transfers"("tenantId", "number");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_tenantId_transferId_idx" ON "stock_transfer_lines"("tenantId", "transferId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_lines_transferId_productId_key" ON "stock_transfer_lines"("transferId", "productId");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_productId_warehouseId_seq_idx" ON "stock_movements"("tenantId", "productId", "warehouseId", "seq");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stocks" ADD CONSTRAINT "warehouse_stocks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stocks" ADD CONSTRAINT "warehouse_stocks_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stocks" ADD CONSTRAINT "warehouse_stocks_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (phase 15).
-- One default warehouse per tenant, and one active truck per seller.
CREATE UNIQUE INDEX "warehouses_one_default_per_tenant"
  ON "warehouses"("tenantId") WHERE "isDefault";
CREATE UNIQUE INDEX "warehouses_one_vehicle_per_user"
  ON "warehouses"("assignedUserId") WHERE "assignedUserId" IS NOT NULL AND "deletedAt" IS NULL;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_driver_is_vehicle_check"
  CHECK ("assignedUserId" IS NULL OR "type" = 'VEHICLE');
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_default_is_main_check"
  CHECK (NOT "isDefault" OR "type" = 'MAIN');

ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_distinct_check"
  CHECK ("fromWarehouseId" <> "toWarehouseId");
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_qty_check"
  CHECK ("qty" > 0 AND "qtyBase" > 0);

-- The ledger stays append-only. The single exception is the backfill: an UPDATE that only
-- sets a missing warehouseId (NULL -> a value) and changes nothing else. The contract
-- release restores the strict function (apps/api/prisma/contract/).
CREATE OR REPLACE FUNCTION "stock_movements_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."warehouseId" IS NULL
     AND NEW."warehouseId" IS NOT NULL
     AND (to_jsonb(NEW) - 'warehouseId') = (to_jsonb(OLD) - 'warehouseId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'stock_movements is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- Row-Level Security, same policy as 20261028090000_row_level_security.
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "warehouses"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "warehouse_stocks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "warehouse_stocks"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "stock_transfers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "stock_transfers"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "stock_transfer_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "stock_transfer_lines"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');
