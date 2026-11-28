-- Phase 40a (expand): official wilaya and commune codes next to the old text columns.
-- The text stays; db:backfill-communes fills the codes of existing clients.

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "wilayaCode" SMALLINT,
ADD COLUMN     "communeCode" INTEGER;

-- AlterTable
ALTER TABLE "sectors" ADD COLUMN     "wilayaCode" SMALLINT,
ADD COLUMN     "communeCodes" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

ALTER TABLE "clients" ADD CONSTRAINT "clients_wilayaCode_check"
  CHECK ("wilayaCode" BETWEEN 1 AND 69);
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_wilayaCode_check"
  CHECK ("wilayaCode" BETWEEN 1 AND 69);

-- CreateIndex
CREATE INDEX "clients_tenantId_communeCode_idx" ON "clients"("tenantId", "communeCode");
