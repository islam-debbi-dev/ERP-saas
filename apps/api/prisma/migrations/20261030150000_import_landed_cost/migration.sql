-- Phase 22: importateur. Dossiers d'importation, currencies, coût de revient (expand only).

-- CreateEnum
CREATE TYPE "ImportFileStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportCostType" AS ENUM ('FRET', 'DOUANE', 'TVA_IMPORT', 'TRANSITAIRE', 'MAGASINAGE', 'TRANSPORT', 'ASSURANCE', 'AUTRE');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('VALUE', 'QUANTITY', 'WEIGHT', 'VOLUME', 'MANUAL');

-- AlterEnum
ALTER TYPE "DocType" ADD VALUE 'DI';

-- AlterEnum
ALTER TYPE "PurchaseStatus" ADD VALUE 'IN_TRANSIT';

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'COST_ADJUST';

-- AlterEnum
ALTER TYPE "SupplierLedgerType" ADD VALUE 'IMPORT_COST';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "volumeM3" DECIMAL(12,4),
ADD COLUMN     "weightKg" DECIMAL(12,3);

-- AlterTable
ALTER TABLE "purchase_lines" ADD COLUMN     "landedUnitCostBase" DECIMAL(14,4),
ADD COLUMN     "unitCostCurrency" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'DZD',
ADD COLUMN     "exchangeRate" DECIMAL(12,6) NOT NULL DEFAULT 1,
ADD COLUMN     "importFileId" UUID,
ADD COLUMN     "totalCurrency" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "valueDelta" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "supplier_balances" ADD COLUMN     "balanceCurrency" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "supplier_ledger_entries" ADD COLUMN     "amountCurrency" DECIMAL(14,2),
ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'DZD';

-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "amountCurrency" DECIMAL(14,2),
ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'DZD',
ADD COLUMN     "exchangeRate" DECIMAL(12,6);

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'DZD';

-- CreateTable
CREATE TABLE "import_files" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "status" "ImportFileStatus" NOT NULL DEFAULT 'OPEN',
    "reference" VARCHAR(60),
    "containerNo" VARCHAR(40),
    "arrivalDate" DATE,
    "note" VARCHAR(255),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID,
    "closedBy" UUID,
    "closedAt" TIMESTAMPTZ(3),
    "cancelledBy" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_costs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "importFileId" UUID NOT NULL,
    "type" "ImportCostType" NOT NULL,
    "label" VARCHAR(120),
    "supplierId" UUID,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'DZD',
    "amountCurrency" DECIMAL(14,2),
    "exchangeRate" DECIMAL(12,6) NOT NULL DEFAULT 1,
    "amount" DECIMAL(14,2) NOT NULL,
    "tvaAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "method" "AllocationMethod" NOT NULL,
    "manualSplit" JSONB,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledBy" UUID,
    "cancelledAt" TIMESTAMPTZ(3),

    CONSTRAINT "import_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_cost_allocations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "importCostId" UUID NOT NULL,
    "purchaseLineId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "stockValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ecart" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_cost_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_files_tenantId_status_createdAt_idx" ON "import_files"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "import_files_tenantId_number_key" ON "import_files"("tenantId", "number");

-- CreateIndex
CREATE INDEX "import_costs_tenantId_importFileId_idx" ON "import_costs"("tenantId", "importFileId");

-- CreateIndex
CREATE INDEX "import_cost_allocations_tenantId_importCostId_idx" ON "import_cost_allocations"("tenantId", "importCostId");

-- CreateIndex
CREATE INDEX "import_cost_allocations_tenantId_productId_createdAt_idx" ON "import_cost_allocations"("tenantId", "productId", "createdAt");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_importFileId_fkey" FOREIGN KEY ("importFileId") REFERENCES "import_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_costs" ADD CONSTRAINT "import_costs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_costs" ADD CONSTRAINT "import_costs_importFileId_fkey" FOREIGN KEY ("importFileId") REFERENCES "import_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_costs" ADD CONSTRAINT "import_costs_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_cost_allocations" ADD CONSTRAINT "import_cost_allocations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_cost_allocations" ADD CONSTRAINT "import_cost_allocations_importCostId_fkey" FOREIGN KEY ("importCostId") REFERENCES "import_costs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_cost_allocations" ADD CONSTRAINT "import_cost_allocations_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "purchase_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_cost_allocations" ADD CONSTRAINT "import_cost_allocations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "purchases_tenantId_importFileId_idx" ON "purchases"("tenantId", "importFileId");

-- An allocation is the frozen share of a cost: never changed or removed.
CREATE FUNCTION "import_cost_allocations_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'import_cost_allocations is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "import_cost_allocations_no_update_delete"
  BEFORE UPDATE OR DELETE ON "import_cost_allocations"
  FOR EACH ROW EXECUTE FUNCTION "import_cost_allocations_append_only"();

-- Row-Level Security, same policy as 20261028090000_row_level_security.
ALTER TABLE "import_files" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "import_files"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "import_costs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "import_costs"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "import_cost_allocations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "import_cost_allocations"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

