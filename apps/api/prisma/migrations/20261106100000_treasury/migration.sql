-- CreateEnum
CREATE TYPE "CashAccountType" AS ENUM ('CAISSE', 'BANQUE', 'CCP');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('OPENING', 'VERSEMENT', 'SUPPLIER_PAYMENT', 'EXPENSE', 'IMPORT_COST', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_ADJUST', 'REVERSAL');

-- CreateEnum
CREATE TYPE "CashTransferStatus" AS ENUM ('VALID', 'CANCELLED');

-- AlterEnum
ALTER TYPE "DocType" ADD VALUE 'TRF';

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "cashAccountId" UUID;

-- AlterTable
ALTER TABLE "import_costs" ADD COLUMN     "cashAccountId" UUID,
ADD COLUMN     "paidDate" DATE,
ADD COLUMN     "paidMode" "PaymentMode";

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "cashAccountId" UUID;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "paidCashAccountId" UUID,
ADD COLUMN     "paidMode" "PaymentMode" NOT NULL DEFAULT 'ESPECES';

-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "cashAccountId" UUID,
ADD COLUMN     "purchaseId" UUID;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "cashCountAlertThreshold" DECIMAL(14,2) NOT NULL DEFAULT 5000;

-- CreateTable
CREATE TABLE "cash_accounts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "type" "CashAccountType" NOT NULL,
    "warehouseId" UUID,
    "bankName" VARCHAR(80),
    "rib" VARCHAR(30),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'DZD',
    "openingDate" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_account_balances" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cashAccountId" UUID NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cash_account_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cashAccountId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "refType" VARCHAR(40),
    "refId" UUID,
    "date" DATE NOT NULL,
    "note" VARCHAR(255),
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_transfers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "fromAccountId" UUID NOT NULL,
    "toAccountId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" VARCHAR(255),
    "status" "CashTransferStatus" NOT NULL DEFAULT 'VALID',
    "createdBy" UUID,
    "cancelReason" VARCHAR(255),
    "cancelledBy" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cash_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_counts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cashAccountId" UUID NOT NULL,
    "counted" DECIMAL(14,2) NOT NULL,
    "expected" DECIMAL(14,2) NOT NULL,
    "ecart" DECIMAL(14,2) NOT NULL,
    "reason" VARCHAR(255),
    "alert" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_accounts_tenantId_type_idx" ON "cash_accounts"("tenantId", "type");

-- CreateIndex
CREATE INDEX "cash_accounts_tenantId_warehouseId_idx" ON "cash_accounts"("tenantId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_account_balances_cashAccountId_key" ON "cash_account_balances"("cashAccountId");

-- CreateIndex
CREATE INDEX "cash_account_balances_tenantId_idx" ON "cash_account_balances"("tenantId");

-- CreateIndex
CREATE INDEX "cash_movements_tenantId_cashAccountId_date_createdAt_idx" ON "cash_movements"("tenantId", "cashAccountId", "date", "createdAt");

-- CreateIndex
CREATE INDEX "cash_movements_tenantId_date_idx" ON "cash_movements"("tenantId", "date");

-- CreateIndex
CREATE INDEX "cash_movements_tenantId_refType_refId_idx" ON "cash_movements"("tenantId", "refType", "refId");

-- CreateIndex
CREATE INDEX "cash_transfers_tenantId_date_idx" ON "cash_transfers"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transfers_tenantId_number_key" ON "cash_transfers"("tenantId", "number");

-- CreateIndex
CREATE INDEX "cash_counts_tenantId_cashAccountId_createdAt_idx" ON "cash_counts"("tenantId", "cashAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "cash_counts_tenantId_alert_createdAt_idx" ON "cash_counts"("tenantId", "alert", "createdAt");

-- CreateIndex
CREATE INDEX "expenses_tenantId_cashAccountId_idx" ON "expenses"("tenantId", "cashAccountId");

-- CreateIndex
CREATE INDEX "import_costs_tenantId_cashAccountId_paidDate_idx" ON "import_costs"("tenantId", "cashAccountId", "paidDate");

-- CreateIndex
CREATE INDEX "payments_tenantId_cashAccountId_idx" ON "payments"("tenantId", "cashAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_purchaseId_key" ON "supplier_payments"("purchaseId");

-- CreateIndex
CREATE INDEX "supplier_payments_tenantId_cashAccountId_idx" ON "supplier_payments"("tenantId", "cashAccountId");

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_paidCashAccountId_fkey" FOREIGN KEY ("paidCashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_costs" ADD CONSTRAINT "import_costs_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_account_balances" ADD CONSTRAINT "cash_account_balances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_account_balances" ADD CONSTRAINT "cash_account_balances_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One default per type and dépôt, one live name per tenant (archived accounts free both).
CREATE UNIQUE INDEX "cash_accounts_default_key" ON "cash_accounts"
  ("tenantId", "type", COALESCE("warehouseId", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "isDefault" AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "cash_accounts_name_key" ON "cash_accounts" ("tenantId", lower("name"))
  WHERE "deletedAt" IS NULL;

-- A document moves an account once, and reverses it once: the backfill and any replay rely on it.
CREATE UNIQUE INDEX "cash_movements_ref_key" ON "cash_movements"
  ("tenantId", "cashAccountId", "refType", "refId", "type")
  WHERE "refId" IS NOT NULL;
-- One solde initial per account.
CREATE UNIQUE INDEX "cash_movements_opening_key" ON "cash_movements" ("tenantId", "cashAccountId")
  WHERE "type" = 'OPENING';

ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_amount_check" CHECK ("amount" > 0);
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_accounts_check"
  CHECK ("fromAccountId" <> "toAccountId");
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_currency_check"
  CHECK ("currency" = 'DZD');

-- The cash ledger is append-only, like the other ledgers.
CREATE FUNCTION "cash_movements_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cash_movements is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cash_movements_no_update_delete"
  BEFORE UPDATE OR DELETE ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION "cash_movements_append_only"();

-- Row-Level Security, same policy as 20261028090000_row_level_security.
ALTER TABLE "cash_accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "cash_accounts"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "cash_account_balances" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "cash_account_balances"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "cash_movements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "cash_movements"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "cash_transfers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "cash_transfers"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "cash_counts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "cash_counts"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

