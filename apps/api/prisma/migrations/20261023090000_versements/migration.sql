-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "bank" VARCHAR(80),
ADD COLUMN     "bounceReason" VARCHAR(255),
ADD COLUMN     "bouncedAt" TIMESTAMPTZ(3),
ADD COLUMN     "bouncedBy" UUID,
ADD COLUMN     "cancelReason" VARCHAR(255),
ADD COLUMN     "cancelledAt" TIMESTAMPTZ(3),
ADD COLUMN     "cancelledBy" UUID,
ADD COLUMN     "dueDate" DATE,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_allocations_tenantId_saleId_idx" ON "payment_allocations"("tenantId", "saleId");

-- CreateIndex
CREATE INDEX "payment_allocations_tenantId_paymentId_idx" ON "payment_allocations"("tenantId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_paymentId_saleId_key" ON "payment_allocations"("paymentId", "saleId");

-- CreateIndex
CREATE INDEX "payments_tenantId_mode_status_dueDate_idx" ON "payments"("tenantId", "mode", "status", "dueDate");

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: value guard.
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_check" CHECK ("amount" > 0);

-- Data: payments taken at sale time (phase 6) pay their own sale.
INSERT INTO "payment_allocations" ("id", "tenantId", "paymentId", "saleId", "amount")
SELECT gen_random_uuid(), p."tenantId", p."id", p."saleId", p."amount"
FROM "payments" p
WHERE p."saleId" IS NOT NULL;
