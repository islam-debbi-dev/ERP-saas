-- CreateEnum
CREATE TYPE "SellerScope" AS ENUM ('ALL_CLIENTS', 'ASSIGNED_ONLY');

-- AlterEnum (PostgreSQL 16: several values in one migration is fine; none is used here)


ALTER TYPE "Role" ADD VALUE 'SUPERVISOR';
ALTER TYPE "Role" ADD VALUE 'LIVREUR';

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "assignedSellerId" UUID,
ADD COLUMN     "sectorId" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "collectedBy" UUID;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "brandId" UUID;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "sellerId" UUID;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "sellerScope" "SellerScope" NOT NULL DEFAULT 'ALL_CLIENTS';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "managerId" UUID;

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "supplierId" UUID,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sectors" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "wilaya" VARCHAR(60),
    "communes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brands_tenantId_name_idx" ON "brands"("tenantId", "name");

-- CreateIndex
CREATE INDEX "sectors_tenantId_name_idx" ON "sectors"("tenantId", "name");

-- CreateIndex
CREATE INDEX "clients_tenantId_sectorId_idx" ON "clients"("tenantId", "sectorId");

-- CreateIndex
CREATE INDEX "clients_tenantId_assignedSellerId_idx" ON "clients"("tenantId", "assignedSellerId");

-- CreateIndex
CREATE INDEX "payments_tenantId_collectedBy_receivedAt_idx" ON "payments"("tenantId", "collectedBy", "receivedAt");

-- CreateIndex
CREATE INDEX "products_tenantId_brandId_idx" ON "products"("tenantId", "brandId");

-- CreateIndex
CREATE INDEX "sales_tenantId_sellerId_validatedAt_idx" ON "sales"("tenantId", "sellerId", "validatedAt");

-- CreateIndex
CREATE INDEX "users_tenantId_managerId_idx" ON "users"("tenantId", "managerId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_assignedSellerId_fkey" FOREIGN KEY ("assignedSellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_collectedBy_fkey" FOREIGN KEY ("collectedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security, same policy as 20261028090000_row_level_security.
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "brands"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "sectors" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "sectors"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');
