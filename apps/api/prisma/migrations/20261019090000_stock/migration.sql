-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING', 'PURCHASE', 'PURCHASE_RETURN', 'SALE', 'SALE_RETURN', 'ADJUSTMENT', 'INVENTORY');

-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('CASSE', 'PERTE', 'ERREUR', 'AUTRE');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('OPEN', 'VALIDATED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "DocType" ADD VALUE 'INV';

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "qtyBase" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4),
    "balanceAfter" DECIMAL(14,3) NOT NULL,
    "avgCostAfter" DECIMAL(14,4) NOT NULL,
    "reason" "AdjustmentReason",
    "refType" VARCHAR(30),
    "refId" UUID,
    "note" VARCHAR(255),
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_stocks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qtyBase" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "hasOpening" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventories" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "status" "InventoryStatus" NOT NULL DEFAULT 'OPEN',
    "note" VARCHAR(255),
    "createdBy" UUID,
    "validatedBy" UUID,
    "validatedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "inventoryId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "countedQtyBase" DECIMAL(14,3) NOT NULL,
    "expectedQtyBase" DECIMAL(14,3),
    "diffQtyBase" DECIMAL(14,3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_seq_key" ON "stock_movements"("seq");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_productId_seq_idx" ON "stock_movements"("tenantId", "productId", "seq");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_refType_refId_idx" ON "stock_movements"("tenantId", "refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "product_stocks_productId_key" ON "product_stocks"("productId");

-- CreateIndex
CREATE INDEX "product_stocks_tenantId_idx" ON "product_stocks"("tenantId");

-- CreateIndex
CREATE INDEX "inventories_tenantId_createdAt_idx" ON "inventories"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventories_tenantId_number_key" ON "inventories"("tenantId", "number");

-- CreateIndex
CREATE INDEX "inventory_lines_tenantId_inventoryId_idx" ON "inventory_lines"("tenantId", "inventoryId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lines_inventoryId_productId_key" ON "inventory_lines"("inventoryId", "productId");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: value guards.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_qtyBase_check" CHECK ("qtyBase" <> 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unitCost_check" CHECK ("unitCost" IS NULL OR "unitCost" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_avgCostAfter_check" CHECK ("avgCostAfter" >= 0);
ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_avgCost_check" CHECK ("avgCost" >= 0);
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_countedQtyBase_check" CHECK ("countedQtyBase" >= 0);

-- Hand-written: the stock ledger is append-only (AGENTS.md rule 1), even for raw SQL.
CREATE FUNCTION "stock_movements_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_movements_no_update_delete"
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "stock_movements_append_only"();
