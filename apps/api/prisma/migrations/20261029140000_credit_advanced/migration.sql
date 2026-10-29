-- CreateEnum
CREATE TYPE "SupplierLedgerType" AS ENUM ('OPENING', 'PURCHASE', 'PAYMENT', 'RETURN', 'ADJUST', 'REVERSAL');

-- CreateEnum
CREATE TYPE "SupplierPaymentStatus" AS ENUM ('VALID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShareDocType" AS ENUM ('RELEVE', 'FACTURE');

-- AlterEnum
ALTER TYPE "DocType" ADD VALUE 'RGF';

-- AlterEnum
ALTER TYPE "ImportType" ADD VALUE 'SUPPLIERS';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "reminderDays" SMALLINT NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "code" VARCHAR(30);

-- CreateTable
CREATE TABLE "supplier_ledger_entries" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "type" "SupplierLedgerType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "reason" VARCHAR(255),
    "refType" VARCHAR(30),
    "refId" UUID,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_balances" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "hasOpening" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "supplierId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "status" "SupplierPaymentStatus" NOT NULL DEFAULT 'VALID',
    "reference" VARCHAR(80),
    "bank" VARCHAR(80),
    "dueDate" DATE,
    "note" VARCHAR(255),
    "paidBy" UUID,
    "paidAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelReason" VARCHAR(255),
    "cancelledBy" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "docType" "ShareDocType" NOT NULL,
    "docId" UUID NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedBy" UUID,
    "createdBy" UUID,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "lastOpenedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_ledger_entries_seq_key" ON "supplier_ledger_entries"("seq");

-- CreateIndex
CREATE INDEX "supplier_ledger_entries_tenantId_supplierId_seq_idx" ON "supplier_ledger_entries"("tenantId", "supplierId", "seq");

-- CreateIndex
CREATE INDEX "supplier_ledger_entries_tenantId_refType_refId_idx" ON "supplier_ledger_entries"("tenantId", "refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_balances_supplierId_key" ON "supplier_balances"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_balances_tenantId_balance_idx" ON "supplier_balances"("tenantId", "balance");

-- CreateIndex
CREATE INDEX "supplier_payments_tenantId_supplierId_idx" ON "supplier_payments"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "supplier_payments_tenantId_paidAt_idx" ON "supplier_payments"("tenantId", "paidAt");

-- CreateIndex
CREATE INDEX "supplier_payments_tenantId_mode_status_dueDate_idx" ON "supplier_payments"("tenantId", "mode", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_tenantId_number_key" ON "supplier_payments"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_tokenHash_key" ON "share_links"("tokenHash");

-- CreateIndex
CREATE INDEX "share_links_tenantId_docType_docId_idx" ON "share_links"("tenantId", "docType", "docId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenantId_code_key" ON "suppliers"("tenantId", "code");

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_balances" ADD CONSTRAINT "supplier_balances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_balances" ADD CONSTRAINT "supplier_balances_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: value guards.
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_amount_check" CHECK ("amount" <> 0);
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amount_check" CHECK ("amount" > 0);
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_reminderDays_check" CHECK ("reminderDays" BETWEEN 1 AND 365);

-- Hand-written: the supplier ledger is append-only (AGENTS.md rule 1), even for raw SQL.
CREATE FUNCTION "supplier_ledger_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'supplier_ledger_entries is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "supplier_ledger_no_update_delete"
  BEFORE UPDATE OR DELETE ON "supplier_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "supplier_ledger_append_only"();

-- Row-Level Security, same policy as 20261028090000_row_level_security. A public share
-- link is looked up by its token hash in the system context, then served in its tenant.
ALTER TABLE "supplier_ledger_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "supplier_ledger_entries"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "supplier_balances" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "supplier_balances"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "supplier_payments"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "share_links" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "share_links"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');
