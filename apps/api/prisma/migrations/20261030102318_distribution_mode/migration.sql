-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('FREE_UNITS', 'PERCENT_DISCOUNT');

-- CreateEnum
CREATE TYPE "PromotionClientScope" AS ENUM ('ALL', 'PRICE_LEVEL', 'SECTOR', 'CLIENTS');

-- CreateEnum
CREATE TYPE "PromotionTarget" AS ENUM ('PRODUCTS', 'BRAND', 'CATEGORY');

-- CreateEnum
CREATE TYPE "PackagingEntryType" AS ENUM ('DELIVERY', 'RETURN', 'OPENING', 'ADJUST', 'REVERSAL');

-- AlterEnum
ALTER TYPE "ImportType" ADD VALUE 'PACKAGING_OPENING';

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "freeOfPosition" SMALLINT,
ADD COLUMN     "isFree" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promotionId" UUID,
ADD COLUMN     "promotionName" VARCHAR(80);

-- AlterTable
ALTER TABLE "sale_lines" ADD COLUMN     "freeOfPosition" SMALLINT,
ADD COLUMN     "isFree" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promotionId" UUID,
ADD COLUMN     "promotionName" VARCHAR(80);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "type" "PromotionType" NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "clientScope" "PromotionClientScope" NOT NULL DEFAULT 'ALL',
    "priceLevelId" UUID,
    "sectorId" UUID,
    "buyProductId" UUID,
    "buyUnitId" UUID,
    "buyQty" DECIMAL(14,3),
    "freeProductId" UUID,
    "freeUnitId" UUID,
    "freeQty" DECIMAL(14,3),
    "repeatable" BOOLEAN NOT NULL DEFAULT true,
    "target" "PromotionTarget",
    "brandId" UUID,
    "categoryId" UUID,
    "discountPct" DECIMAL(5,2),
    "minQtyBase" DECIMAL(14,3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_products" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "promotionId" UUID NOT NULL,
    "productId" UUID NOT NULL,

    CONSTRAINT "promotion_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_clients" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "promotionId" UUID NOT NULL,
    "clientId" UUID NOT NULL,

    CONSTRAINT "promotion_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_types" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "depositValue" DECIMAL(14,2),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "packaging_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_packagings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "packagingTypeId" UUID NOT NULL,
    "qtyBasePerPackaging" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_packagings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_packaging_entries" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "packagingTypeId" UUID NOT NULL,
    "type" "PackagingEntryType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "note" VARCHAR(255),
    "refType" VARCHAR(30),
    "refId" UUID,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_packaging_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_packaging_balances" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "packagingTypeId" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "hasOpening" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_packaging_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotions_tenantId_validFrom_validTo_idx" ON "promotions"("tenantId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "promotion_products_tenantId_productId_idx" ON "promotion_products"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_products_promotionId_productId_key" ON "promotion_products"("promotionId", "productId");

-- CreateIndex
CREATE INDEX "promotion_clients_tenantId_clientId_idx" ON "promotion_clients"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_clients_promotionId_clientId_key" ON "promotion_clients"("promotionId", "clientId");

-- CreateIndex
CREATE INDEX "packaging_types_tenantId_name_idx" ON "packaging_types"("tenantId", "name");

-- CreateIndex
CREATE INDEX "product_packagings_tenantId_productId_idx" ON "product_packagings"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_packagings_productId_packagingTypeId_key" ON "product_packagings"("productId", "packagingTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "client_packaging_entries_seq_key" ON "client_packaging_entries"("seq");

-- CreateIndex
CREATE INDEX "client_packaging_entries_tenantId_clientId_seq_idx" ON "client_packaging_entries"("tenantId", "clientId", "seq");

-- CreateIndex
CREATE INDEX "client_packaging_entries_tenantId_refType_refId_idx" ON "client_packaging_entries"("tenantId", "refType", "refId");

-- CreateIndex
CREATE INDEX "client_packaging_balances_tenantId_clientId_idx" ON "client_packaging_balances"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "client_packaging_balances_clientId_packagingTypeId_key" ON "client_packaging_balances"("clientId", "packagingTypeId");

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_clients" ADD CONSTRAINT "promotion_clients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_clients" ADD CONSTRAINT "promotion_clients_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_clients" ADD CONSTRAINT "promotion_clients_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_types" ADD CONSTRAINT "packaging_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_packagings" ADD CONSTRAINT "product_packagings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_packagings" ADD CONSTRAINT "product_packagings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_packagings" ADD CONSTRAINT "product_packagings_packagingTypeId_fkey" FOREIGN KEY ("packagingTypeId") REFERENCES "packaging_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_packaging_entries" ADD CONSTRAINT "client_packaging_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_packaging_entries" ADD CONSTRAINT "client_packaging_entries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_packaging_entries" ADD CONSTRAINT "client_packaging_entries_packagingTypeId_fkey" FOREIGN KEY ("packagingTypeId") REFERENCES "packaging_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_packaging_balances" ADD CONSTRAINT "client_packaging_balances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_packaging_balances" ADD CONSTRAINT "client_packaging_balances_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_packaging_balances" ADD CONSTRAINT "client_packaging_balances_packagingTypeId_fkey" FOREIGN KEY ("packagingTypeId") REFERENCES "packaging_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: the packaging ledger is append-only (AGENTS.md rule 1), even for raw SQL.
CREATE FUNCTION "client_packaging_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'client_packaging_entries is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "client_packaging_no_update_delete"
  BEFORE UPDATE OR DELETE ON "client_packaging_entries"
  FOR EACH ROW EXECUTE FUNCTION "client_packaging_append_only"();

ALTER TABLE "client_packaging_entries" ADD CONSTRAINT "client_packaging_entries_qty_check" CHECK ("qty" <> 0);
ALTER TABLE "product_packagings" ADD CONSTRAINT "product_packagings_qty_check" CHECK ("qtyBasePerPackaging" > 0);
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_dates_check" CHECK ("validFrom" <= "validTo");
-- A free line is priced 0 (AGENTS.md rule 9 keeps it frozen).
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_free_price_check" CHECK (NOT "isFree" OR "unitPriceHt" = 0);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_free_price_check" CHECK (NOT "isFree" OR "unitPriceHt" = 0);

-- Row-Level Security, same policy as 20261028090000_row_level_security.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['promotions', 'promotion_products', 'promotion_clients', 'packaging_types',
    'product_packagings', 'client_packaging_entries', 'client_packaging_balances']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY "tenant_isolation" ON %I
      USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             OR current_setting('app.rls_bypass', true) = 'on')
      WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             OR current_setting('app.rls_bypass', true) = 'on')$p$, t);
  END LOOP;
END $$;
