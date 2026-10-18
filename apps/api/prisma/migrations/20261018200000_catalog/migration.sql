-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "parentId" UUID,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(40),
    "allowsDecimal" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_levels" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "designation" VARCHAR(160) NOT NULL,
    "categoryId" UUID,
    "baseUnitId" UUID NOT NULL,
    "tvaRate" DECIMAL(5,2) NOT NULL,
    "minStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_units" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "factorToBase" DECIMAL(14,3) NOT NULL,
    "barcode" VARCHAR(64),
    "deletedBarcode" VARCHAR(64),
    "isDefaultSale" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultPurchase" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_prices" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productUnitId" UUID NOT NULL,
    "priceLevelId" UUID NOT NULL,
    "priceHt" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_tenantId_parentId_idx" ON "categories"("tenantId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "units_tenantId_code_key" ON "units"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "price_levels_tenantId_position_key" ON "price_levels"("tenantId", "position");

-- CreateIndex
CREATE INDEX "products_tenantId_designation_idx" ON "products"("tenantId", "designation");

-- CreateIndex
CREATE INDEX "products_tenantId_categoryId_idx" ON "products"("tenantId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_reference_key" ON "products"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "product_units_tenantId_barcode_key" ON "product_units"("tenantId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "product_units_productId_unitId_key" ON "product_units"("productId", "unitId");

-- CreateIndex
CREATE INDEX "product_prices_tenantId_productId_idx" ON "product_prices"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_prices_productUnitId_priceLevelId_key" ON "product_prices"("productUnitId", "priceLevelId");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_levels" ADD CONSTRAINT "price_levels_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_baseUnitId_fkey" FOREIGN KEY ("baseUnitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_productUnitId_fkey" FOREIGN KEY ("productUnitId") REFERENCES "product_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_priceLevelId_fkey" FOREIGN KEY ("priceLevelId") REFERENCES "price_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: value guards (defense in depth behind the zod schemas).
ALTER TABLE "products" ADD CONSTRAINT "products_tvaRate_check" CHECK ("tvaRate" >= 0 AND "tvaRate" <= 100);
ALTER TABLE "products" ADD CONSTRAINT "products_minStock_check" CHECK ("minStock" >= 0);
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_factorToBase_check" CHECK ("factorToBase" > 0);
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_priceHt_check" CHECK ("priceHt" >= 0);
ALTER TABLE "price_levels" ADD CONSTRAINT "price_levels_position_check" CHECK ("position" BETWEEN 1 AND 5);

-- Hand-written: give existing tenants the default unit catalog and price levels
-- (new tenants get them from CatalogService.initTenant at registration).
INSERT INTO "units" ("id", "tenantId", "code", "allowsDecimal")
SELECT gen_random_uuid(), t."id", u.code, u.allows_decimal
FROM "tenants" t
CROSS JOIN (VALUES
  ('PIECE', false), ('KG', true), ('LITRE', true), ('METRE', true), ('CARTON', false),
  ('FARDEAU', false), ('SAC', false), ('BOITE', false), ('PAQUET', false)
) AS u(code, allows_decimal)
ON CONFLICT ("tenantId", "code") DO NOTHING;

INSERT INTO "price_levels" ("id", "tenantId", "position", "name", "updatedAt")
SELECT gen_random_uuid(), t."id", l.position, l.name, CURRENT_TIMESTAMP
FROM "tenants" t
JOIN (VALUES (1, 'Gros'), (2, 'Demi-gros'), (3, 'Détail'), (4, 'Niveau 4'), (5, 'Niveau 5'))
  AS l(position, name) ON l.position <= t."priceLevelCount"
ON CONFLICT ("tenantId", "position") DO NOTHING;
