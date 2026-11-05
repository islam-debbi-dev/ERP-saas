-- A company may own its rate sets (tenantId set); platform sets stay tenantId NULL and
-- become indicative. Approving a run takes the owner's word on the set it uses.

-- AlterTable
ALTER TABLE "payroll_rate_sets" ADD COLUMN "tenantId" UUID;

-- DropIndex
DROP INDEX "payroll_rate_sets_effectiveFrom_seq_idx";

-- CreateIndex
CREATE INDEX "payroll_rate_sets_tenantId_effectiveFrom_seq_idx" ON "payroll_rate_sets"("tenantId", "effectiveFrom", "seq");

-- AddForeignKey
ALTER TABLE "payroll_rate_sets" ADD CONSTRAINT "payroll_rate_sets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "payroll_rate_confirmations" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "rateSetId" UUID NOT NULL,
    "decision" VARCHAR(16) NOT NULL,
    "text" VARCHAR(255) NOT NULL,
    "locale" VARCHAR(2) NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_rate_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_rate_confirmations_seq_key" ON "payroll_rate_confirmations"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_rate_confirmations_tenantId_rateSetId_decision_key" ON "payroll_rate_confirmations"("tenantId", "rateSetId", "decision");

-- AddForeignKey
ALTER TABLE "payroll_rate_confirmations" ADD CONSTRAINT "payroll_rate_confirmations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_rate_confirmations" ADD CONSTRAINT "payroll_rate_confirmations_rateSetId_fkey" FOREIGN KEY ("rateSetId") REFERENCES "payroll_rate_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_rate_confirmations" ADD CONSTRAINT "payroll_rate_confirmations_decision_check"
  CHECK ("decision" IN ('CONFIRMED', 'KEPT_OWN'));

-- Append-only, like the sets it points to.
CREATE TRIGGER "payroll_rate_confirmations_no_update_delete"
  BEFORE UPDATE OR DELETE ON "payroll_rate_confirmations"
  FOR EACH ROW EXECUTE FUNCTION "payroll_append_only"();

-- Every company reads the platform sets and its own, never another company's.
ALTER TABLE "payroll_rate_sets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payroll_rate_sets"
  USING ("tenantId" IS NULL
         OR "tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "payroll_rate_confirmations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payroll_rate_confirmations"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');
