-- CreateEnum
CREATE TYPE "SaleType" AS ENUM ('BL', 'FACTURE');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'VALIDATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('ESPECES', 'CHEQUE', 'VIREMENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('VALID', 'CANCELLED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "ReturnDisposition" AS ENUM ('RESTOCK', 'DAMAGED');

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "SaleType" NOT NULL,
    "number" VARCHAR(20),
    "status" "SaleStatus" NOT NULL DEFAULT 'DRAFT',
    "clientId" UUID,
    "clientSnapshot" JSONB,
    "documentDate" DATE NOT NULL,
    "priceLevelId" UUID,
    "note" VARCHAR(255),
    "assujettiTva" BOOLEAN NOT NULL DEFAULT true,
    "totalHt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalTva" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalTtc" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "timbre" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paymentMode" "PaymentMode",
    "invoiceId" UUID,
    "creditOverride" BOOLEAN NOT NULL DEFAULT false,
    "cancelReason" VARCHAR(255),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID,
    "validatedBy" UUID,
    "validatedAt" TIMESTAMPTZ(3),
    "cancelledBy" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
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
    "unitCostBase" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "sourceLineId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_returns" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "saleId" UUID NOT NULL,
    "clientId" UUID,
    "disposition" "ReturnDisposition" NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "totalHt" DECIMAL(14,2) NOT NULL,
    "totalTva" DECIMAL(14,2) NOT NULL,
    "totalTtc" DECIMAL(14,2) NOT NULL,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "saleLineId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "qtyBase" DECIMAL(14,3) NOT NULL,
    "unitPriceHt" DECIMAL(14,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tvaRate" DECIMAL(5,2) NOT NULL,
    "lineHt" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "clientId" UUID,
    "saleId" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'VALID',
    "reference" VARCHAR(80),
    "note" VARCHAR(255),
    "receivedBy" UUID,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_tenantId_createdAt_idx" ON "sales"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "sales_tenantId_clientId_idx" ON "sales"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "sales_tenantId_type_status_idx" ON "sales"("tenantId", "type", "status");

-- CreateIndex
CREATE INDEX "sales_tenantId_invoiceId_idx" ON "sales"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenantId_number_key" ON "sales"("tenantId", "number");

-- CreateIndex
CREATE INDEX "sale_lines_tenantId_saleId_idx" ON "sale_lines"("tenantId", "saleId");

-- CreateIndex
CREATE INDEX "sale_lines_tenantId_productId_idx" ON "sale_lines"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "sale_returns_tenantId_saleId_idx" ON "sale_returns"("tenantId", "saleId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_tenantId_number_key" ON "sale_returns"("tenantId", "number");

-- CreateIndex
CREATE INDEX "sale_return_lines_tenantId_returnId_idx" ON "sale_return_lines"("tenantId", "returnId");

-- CreateIndex
CREATE INDEX "sale_return_lines_tenantId_saleLineId_idx" ON "sale_return_lines"("tenantId", "saleLineId");

-- CreateIndex
CREATE INDEX "payments_tenantId_receivedAt_idx" ON "payments"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "payments_tenantId_clientId_idx" ON "payments"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "payments_tenantId_saleId_idx" ON "payments"("tenantId", "saleId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_number_key" ON "payments"("tenantId", "number");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "sale_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written: value guards.
ALTER TABLE "sales" ADD CONSTRAINT "sales_totals_check"
  CHECK ("totalHt" >= 0 AND "totalTva" >= 0 AND "totalTtc" >= 0 AND "timbre" >= 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_paid_check"
  CHECK ("paidAmount" >= 0 AND "paidAmount" <= "totalTtc" + "timbre");
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_values_check"
  CHECK ("qty" > 0 AND "qtyBase" > 0 AND "unitPriceHt" >= 0 AND "lineHt" >= 0
         AND "discountPct" >= 0 AND "discountPct" <= 100);
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_values_check"
  CHECK ("qty" > 0 AND "qtyBase" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount" > 0);
