-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('VALID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RentPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- AlterEnum
ALTER TYPE "DocType" ADD VALUE 'DEP';

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "key" VARCHAR(20),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_contracts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "landlordName" VARCHAR(120) NOT NULL,
    "landlordPhone" VARCHAR(30),
    "amount" DECIMAL(14,2) NOT NULL,
    "period" "RentPeriod" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "note" VARCHAR(255),
    "createdBy" UUID,
    "closedBy" UUID,
    "closedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rent_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "date" DATE NOT NULL,
    "warehouseId" UUID,
    "categoryId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "reference" VARCHAR(80),
    "payee" VARCHAR(120),
    "periodStart" DATE,
    "periodEnd" DATE,
    "note" VARCHAR(255),
    "rentContractId" UUID,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'VALID',
    "createdBy" UUID,
    "cancelReason" VARCHAR(255),
    "cancelledBy" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_categories_tenantId_name_idx" ON "expense_categories"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_tenantId_key_key" ON "expense_categories"("tenantId", "key");

-- CreateIndex
CREATE INDEX "rent_contracts_tenantId_warehouseId_idx" ON "rent_contracts"("tenantId", "warehouseId");

-- CreateIndex
CREATE INDEX "expenses_tenantId_date_idx" ON "expenses"("tenantId", "date");

-- CreateIndex
CREATE INDEX "expenses_tenantId_warehouseId_date_idx" ON "expenses"("tenantId", "warehouseId", "date");

-- CreateIndex
CREATE INDEX "expenses_tenantId_rentContractId_idx" ON "expenses"("tenantId", "rentContractId");

-- CreateIndex
CREATE INDEX "expenses_tenantId_periodEnd_idx" ON "expenses"("tenantId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_tenantId_number_key" ON "expenses"("tenantId", "number");

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_contracts" ADD CONSTRAINT "rent_contracts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_contracts" ADD CONSTRAINT "rent_contracts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_rentContractId_fkey" FOREIGN KEY ("rentContractId") REFERENCES "rent_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money and periods are checked by the database too.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_period_valid"
  CHECK (("periodStart" IS NULL AND "periodEnd" IS NULL)
         OR ("periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodEnd" >= "periodStart"));
ALTER TABLE "rent_contracts" ADD CONSTRAINT "rent_contracts_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "rent_contracts" ADD CONSTRAINT "rent_contracts_dates_valid"
  CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

-- The default categories for every existing company (new ones get them at signup).
INSERT INTO "expense_categories" ("id", "tenantId", "name", "key", "updatedAt")
SELECT gen_random_uuid(), t."id", c."name", c."key", CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (VALUES
  ('Loyer', 'RENT'),
  ('Électricité / eau', 'UTILITIES'),
  ('Salaires', 'SALARIES'),
  ('Transport / carburant', 'TRANSPORT'),
  ('Téléphone / internet', 'TELECOM'),
  ('Autre', 'OTHER')
) AS c("name", "key")
ON CONFLICT ("tenantId", "key") DO NOTHING;

-- Row-Level Security, same policy as 20261028090000_row_level_security.
ALTER TABLE "expense_categories" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "expense_categories"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "rent_contracts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "rent_contracts"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "expenses"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');
