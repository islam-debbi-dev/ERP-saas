-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('PARTICULIER', 'PROFESSIONNEL');

-- CreateEnum
CREATE TYPE "ClientLedgerType" AS ENUM ('OPENING', 'SALE', 'PAYMENT', 'RETURN', 'ADJUSTMENT', 'REVERSAL');

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "type" "ClientType" NOT NULL DEFAULT 'PARTICULIER',
    "phone" VARCHAR(40),
    "phone2" VARCHAR(40),
    "address" VARCHAR(255),
    "wilaya" VARCHAR(60),
    "commune" VARCHAR(80),
    "rc" VARCHAR(40),
    "nif" VARCHAR(40),
    "nis" VARCHAR(40),
    "ai" VARCHAR(40),
    "priceLevelId" UUID,
    "creditLimit" DECIMAL(14,2),
    "notes" VARCHAR(500),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_ledger_entries" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "type" "ClientLedgerType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "reason" VARCHAR(255),
    "refType" VARCHAR(30),
    "refId" UUID,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_balances" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "hasOpening" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_tenantId_name_idx" ON "clients"("tenantId", "name");

-- CreateIndex
CREATE INDEX "clients_tenantId_phone_idx" ON "clients"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "clients_tenantId_code_key" ON "clients"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "client_ledger_entries_seq_key" ON "client_ledger_entries"("seq");

-- CreateIndex
CREATE INDEX "client_ledger_entries_tenantId_clientId_seq_idx" ON "client_ledger_entries"("tenantId", "clientId", "seq");

-- CreateIndex
CREATE INDEX "client_ledger_entries_tenantId_refType_refId_idx" ON "client_ledger_entries"("tenantId", "refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "client_balances_clientId_key" ON "client_balances"("clientId");

-- CreateIndex
CREATE INDEX "client_balances_tenantId_balance_idx" ON "client_balances"("tenantId", "balance");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_priceLevelId_fkey" FOREIGN KEY ("priceLevelId") REFERENCES "price_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_ledger_entries" ADD CONSTRAINT "client_ledger_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_ledger_entries" ADD CONSTRAINT "client_ledger_entries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_balances" ADD CONSTRAINT "client_balances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_balances" ADD CONSTRAINT "client_balances_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: value guards.
ALTER TABLE "client_ledger_entries" ADD CONSTRAINT "client_ledger_entries_amount_check" CHECK ("amount" <> 0);
ALTER TABLE "clients" ADD CONSTRAINT "clients_creditLimit_check" CHECK ("creditLimit" IS NULL OR "creditLimit" >= 0);

-- Hand-written: the client ledger is append-only (AGENTS.md rule 1), even for raw SQL.
CREATE FUNCTION "client_ledger_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'client_ledger_entries is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "client_ledger_no_update_delete"
  BEFORE UPDATE OR DELETE ON "client_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "client_ledger_append_only"();
