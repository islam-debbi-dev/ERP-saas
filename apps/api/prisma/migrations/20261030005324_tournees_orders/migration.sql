-- CreateEnum
CREATE TYPE "VisitOutcome" AS ENUM ('SALE', 'ORDER', 'PAYMENT_ONLY', 'NO_SALE');

-- CreateEnum
CREATE TYPE "NoSaleReason" AS ENUM ('CLOSED', 'HAS_STOCK', 'NO_MONEY', 'REFUSED', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SellerSessionStatus" AS ENUM ('OPEN', 'CLOSED', 'ADJUST');

-- AlterEnum
ALTER TYPE "DocType" ADD VALUE 'BC';

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sellerId" UUID NOT NULL,
    "weekdays" SMALLINT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "routeId" UUID,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "outcome" "VisitOutcome" NOT NULL,
    "reason" "NoSaleReason",
    "note" VARCHAR(255),
    "saleId" UUID,
    "orderId" UUID,
    "paymentId" UUID,
    "correctsVisitId" UUID,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" VARCHAR(20),
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "clientId" UUID NOT NULL,
    "sellerId" UUID,
    "warehouseId" UUID,
    "livreurId" UUID,
    "requestedDate" DATE,
    "priceLevelId" UUID,
    "note" VARCHAR(255),
    "assujettiTva" BOOLEAN NOT NULL DEFAULT true,
    "totalHt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalTva" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalTtc" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "saleId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID,
    "confirmedBy" UUID,
    "confirmedAt" TIMESTAMPTZ(3),
    "deliveredBy" UUID,
    "deliveredAt" TIMESTAMPTZ(3),
    "cancelledBy" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "productId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "designation" VARCHAR(160) NOT NULL,
    "unitCode" VARCHAR(40) NOT NULL,
    "unitName" VARCHAR(40),
    "factorToBase" DECIMAL(14,3) NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "qtyBase" DECIMAL(14,3) NOT NULL,
    "listPriceHt" DECIMAL(14,2),
    "unitPriceHt" DECIMAL(14,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tvaRate" DECIMAL(5,2) NOT NULL,
    "lineHt" DECIMAL(14,2) NOT NULL,
    "qtyDelivered" DECIMAL(14,3),
    "qtyNotDelivered" DECIMAL(14,3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_sessions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "warehouseId" UUID,
    "status" "SellerSessionStatus" NOT NULL DEFAULT 'OPEN',
    "expectedCash" DECIMAL(14,2),
    "cashFromSales" DECIMAL(14,2),
    "cashFromPayments" DECIMAL(14,2),
    "handedCash" DECIMAL(14,2),
    "ecart" DECIMAL(14,2),
    "note" VARCHAR(255),
    "adjustsSessionId" UUID,
    "createdBy" UUID,
    "closedBy" UUID,
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seller_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "routes_tenantId_sellerId_idx" ON "routes"("tenantId", "sellerId");

-- CreateIndex
CREATE INDEX "route_stops_tenantId_routeId_position_idx" ON "route_stops"("tenantId", "routeId", "position");

-- CreateIndex
CREATE INDEX "route_stops_tenantId_clientId_idx" ON "route_stops"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_routeId_clientId_key" ON "route_stops"("routeId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "visits_correctsVisitId_key" ON "visits"("correctsVisitId");

-- CreateIndex
CREATE INDEX "visits_tenantId_sellerId_startedAt_idx" ON "visits"("tenantId", "sellerId", "startedAt");

-- CreateIndex
CREATE INDEX "visits_tenantId_clientId_startedAt_idx" ON "visits"("tenantId", "clientId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "orders_saleId_key" ON "orders"("saleId");

-- CreateIndex
CREATE INDEX "orders_tenantId_status_requestedDate_idx" ON "orders"("tenantId", "status", "requestedDate");

-- CreateIndex
CREATE INDEX "orders_tenantId_sellerId_createdAt_idx" ON "orders"("tenantId", "sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_tenantId_livreurId_status_idx" ON "orders"("tenantId", "livreurId", "status");

-- CreateIndex
CREATE INDEX "orders_tenantId_clientId_idx" ON "orders"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenantId_number_key" ON "orders"("tenantId", "number");

-- CreateIndex
CREATE INDEX "order_lines_tenantId_orderId_idx" ON "order_lines"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "order_lines_tenantId_productId_idx" ON "order_lines"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "seller_sessions_tenantId_date_idx" ON "seller_sessions"("tenantId", "date");

-- CreateIndex
CREATE INDEX "seller_sessions_tenantId_sellerId_date_idx" ON "seller_sessions"("tenantId", "sellerId", "date");

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_correctsVisitId_fkey" FOREIGN KEY ("correctsVisitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_livreurId_fkey" FOREIGN KEY ("livreurId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_sessions" ADD CONSTRAINT "seller_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_sessions" ADD CONSTRAINT "seller_sessions_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_sessions" ADD CONSTRAINT "seller_sessions_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_sessions" ADD CONSTRAINT "seller_sessions_adjustsSessionId_fkey" FOREIGN KEY ("adjustsSessionId") REFERENCES "seller_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One closing per seller per day; ADJUST rows point to it and are not counted.
CREATE UNIQUE INDEX "seller_sessions_one_per_day" ON "seller_sessions" ("tenantId", "sellerId", "date")
  WHERE "adjustsSessionId" IS NULL;

ALTER TABLE "routes" ADD CONSTRAINT "routes_weekdays_valid"
  CHECK (cardinality("weekdays") >= 1 AND "weekdays" <@ ARRAY[0,1,2,3,4,5,6]::smallint[]);
ALTER TABLE "visits" ADD CONSTRAINT "visits_reason_no_sale_only"
  CHECK (("outcome" = 'NO_SALE') = ("reason" IS NOT NULL));
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_delivery_split"
  CHECK ("qtyDelivered" IS NULL OR ("qtyDelivered" >= 0 AND "qtyNotDelivered" >= 0
         AND "qtyDelivered" + "qtyNotDelivered" = "qty"));

-- Row-Level Security, same policy as 20261028090000_row_level_security.
ALTER TABLE "routes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "routes"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "route_stops" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "route_stops"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "visits"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "orders"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "order_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "order_lines"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "seller_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "seller_sessions"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

