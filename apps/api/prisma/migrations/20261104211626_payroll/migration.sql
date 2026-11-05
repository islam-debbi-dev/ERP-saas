-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayItemMode" AS ENUM ('FIXED', 'PER_DAY');

-- CreateEnum
CREATE TYPE "PayrollManualKind" AS ENUM ('ITEM', 'REGULARISATION', 'RETENUE');

-- AlterEnum
ALTER TYPE "DocType" ADD VALUE 'PAIE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmployeeLedgerType" ADD VALUE 'SALARY_DUE';
ALTER TYPE "EmployeeLedgerType" ADD VALUE 'SALARY_PAID';
ALTER TYPE "EmployeeLedgerType" ADD VALUE 'ADVANCE_DEDUCTION';
ALTER TYPE "EmployeeLedgerType" ADD VALUE 'SALARY_REVERSAL';

-- AlterTable
ALTER TABLE "attendance_month_locks" ADD COLUMN     "employeeId" UUID,
ADD COLUMN     "payrollRunId" UUID;

-- AlterTable
ALTER TABLE "employee_balances" ADD COLUMN     "salaryDue" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "employee_ledger_entries" ADD COLUMN     "payrollRunId" UUID;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "payrollRunId" UUID;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "payrollDayDivisor" SMALLINT NOT NULL DEFAULT 30,
ADD COLUMN     "payrollDeductLateness" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payrollHourDivisor" DECIMAL(6,2) NOT NULL DEFAULT 173.33,
ADD COLUMN     "payrollOvertimeRate" DECIMAL(4,2) NOT NULL DEFAULT 0.50;

-- CreateTable
CREATE TABLE "payroll_rate_sets" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "cnasEmployeeRate" DECIMAL(6,4) NOT NULL,
    "cnasEmployerRate" DECIMAL(6,4) NOT NULL,
    "irgBrackets" JSONB NOT NULL,
    "abattementRate" DECIMAL(6,4) NOT NULL,
    "abattementMin" DECIMAL(14,2) NOT NULL,
    "abattementMax" DECIMAL(14,2) NOT NULL,
    "exemptionThreshold" DECIMAL(14,2) NOT NULL,
    "lissageCeiling" DECIMAL(14,2) NOT NULL,
    "lissageNum" DECIMAL(14,4) NOT NULL,
    "lissageDen" DECIMAL(14,4) NOT NULL,
    "lissageOffsetNum" DECIMAL(14,4) NOT NULL,
    "lissageOffsetDen" DECIMAL(14,4) NOT NULL,
    "snmg" DECIMAL(14,2) NOT NULL,
    "toVerify" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_rate_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_item_types" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" VARCHAR(30),
    "name" VARCHAR(80) NOT NULL,
    "cotisable" BOOLEAN NOT NULL,
    "imposable" BOOLEAN NOT NULL,
    "mode" "PayItemMode" NOT NULL DEFAULT 'FIXED',
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pay_item_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_pay_items" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "typeId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_pay_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" VARCHAR(20),
    "month" VARCHAR(7) NOT NULL,
    "warehouseId" UUID,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "rateSetId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fingerprint" VARCHAR(64) NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL,
    "computedBy" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "approvedBy" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledBy" UUID,
    "cancelReason" VARCHAR(255),
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "warehouseId" UUID,
    "rateSetId" UUID NOT NULL,
    "rateSetToVerify" BOOLEAN NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "matricule" VARCHAR(20) NOT NULL,
    "position" VARCHAR(80),
    "nss" VARCHAR(30),
    "declared" BOOLEAN NOT NULL,
    "payType" "PayType",
    "salary" DECIMAL(14,2) NOT NULL,
    "days" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "irgDetail" JSONB NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "cotisable" DECIMAL(14,2) NOT NULL,
    "cnasEmployee" DECIMAL(14,2) NOT NULL,
    "cnasEmployer" DECIMAL(14,2) NOT NULL,
    "taxable" DECIMAL(14,2) NOT NULL,
    "irg" DECIMAL(14,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "retenues" DECIMAL(14,2) NOT NULL,
    "advanceDeducted" DECIMAL(14,2) NOT NULL,
    "advanceCarried" DECIMAL(14,2) NOT NULL,
    "netToPay" DECIMAL(14,2) NOT NULL,
    "employerCost" DECIMAL(14,2) NOT NULL,
    "cumulGross" DECIMAL(14,2) NOT NULL,
    "cumulIrg" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "payslipId" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "quantity" DECIMAL(10,2),
    "base" DECIMAL(14,2),
    "rate" DECIMAL(8,4),
    "amount" DECIMAL(14,2) NOT NULL,
    "cotisable" BOOLEAN NOT NULL,
    "imposable" BOOLEAN NOT NULL,
    "incentiveRunId" UUID,

    CONSTRAINT "payslip_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_manual_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" "PayrollManualKind" NOT NULL,
    "typeId" UUID,
    "label" VARCHAR(120) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "cotisable" BOOLEAN NOT NULL DEFAULT false,
    "imposable" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(255),
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_manual_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_rate_sets_seq_key" ON "payroll_rate_sets"("seq");

-- CreateIndex
CREATE INDEX "payroll_rate_sets_effectiveFrom_seq_idx" ON "payroll_rate_sets"("effectiveFrom", "seq");

-- CreateIndex
CREATE INDEX "pay_item_types_tenantId_deletedAt_idx" ON "pay_item_types"("tenantId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pay_item_types_tenantId_key_key" ON "pay_item_types"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "employee_pay_items_seq_key" ON "employee_pay_items"("seq");

-- CreateIndex
CREATE INDEX "employee_pay_items_tenantId_employeeId_effectiveFrom_idx" ON "employee_pay_items"("tenantId", "employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "payroll_runs_tenantId_month_idx" ON "payroll_runs"("tenantId", "month");

-- CreateIndex
CREATE INDEX "payroll_runs_tenantId_status_month_idx" ON "payroll_runs"("tenantId", "status", "month");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_tenantId_number_key" ON "payroll_runs"("tenantId", "number");

-- CreateIndex
CREATE INDEX "payslips_tenantId_employeeId_month_idx" ON "payslips"("tenantId", "employeeId", "month");

-- CreateIndex
CREATE INDEX "payslips_tenantId_month_idx" ON "payslips"("tenantId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_runId_employeeId_key" ON "payslips"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "payslip_lines_tenantId_payslipId_idx" ON "payslip_lines"("tenantId", "payslipId");

-- CreateIndex
CREATE INDEX "payslip_lines_tenantId_incentiveRunId_idx" ON "payslip_lines"("tenantId", "incentiveRunId");

-- CreateIndex
CREATE INDEX "payroll_manual_lines_tenantId_runId_employeeId_idx" ON "payroll_manual_lines"("tenantId", "runId", "employeeId");

-- CreateIndex
CREATE INDEX "attendance_month_locks_tenantId_payrollRunId_idx" ON "attendance_month_locks"("tenantId", "payrollRunId");

-- CreateIndex
CREATE INDEX "employee_ledger_entries_tenantId_payrollRunId_idx" ON "employee_ledger_entries"("tenantId", "payrollRunId");

-- CreateIndex
CREATE INDEX "expenses_tenantId_payrollRunId_idx" ON "expenses"("tenantId", "payrollRunId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_item_types" ADD CONSTRAINT "pay_item_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_pay_items" ADD CONSTRAINT "employee_pay_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_pay_items" ADD CONSTRAINT "employee_pay_items_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_pay_items" ADD CONSTRAINT "employee_pay_items_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "pay_item_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_rateSetId_fkey" FOREIGN KEY ("rateSetId") REFERENCES "payroll_rate_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_runId_fkey" FOREIGN KEY ("runId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "payslips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_manual_lines" ADD CONSTRAINT "payroll_manual_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_manual_lines" ADD CONSTRAINT "payroll_manual_lines_runId_fkey" FOREIGN KEY ("runId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_manual_lines" ADD CONSTRAINT "payroll_manual_lines_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "pay_item_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one live run per month and dépôt. The company-wide run has a null dépôt, which a
-- plain unique index would treat as all different. Company + dépôt overlap: the service,
-- under an advisory lock.
CREATE UNIQUE INDEX "payroll_runs_live_month_key" ON "payroll_runs"
  ("tenantId", "month", COALESCE("warehouseId", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "status" <> 'CANCELLED';

-- Append-only tables.
CREATE FUNCTION "payroll_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_rate_sets_no_update_delete"
  BEFORE UPDATE OR DELETE ON "payroll_rate_sets"
  FOR EACH ROW EXECUTE FUNCTION "payroll_append_only"();

CREATE TRIGGER "employee_pay_items_no_update_delete"
  BEFORE UPDATE OR DELETE ON "employee_pay_items"
  FOR EACH ROW EXECUTE FUNCTION "payroll_append_only"();

-- A run leaves DRAFT once. APPROVED only moves to CANCELLED, and keeps its identity; a
-- CANCELLED run never changes. The services check first; this is the backstop.
CREATE FUNCTION "payroll_run_frozen"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'PERIOD_APPROVED: run % is frozen (DELETE not allowed)', OLD."id";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'PERIOD_APPROVED: run % is cancelled (UPDATE not allowed)', OLD."id";
  END IF;
  IF OLD."status" = 'APPROVED' AND (
    NEW."status" <> 'CANCELLED'
    OR NEW."number" IS DISTINCT FROM OLD."number"
    OR NEW."month" <> OLD."month"
    OR NEW."warehouseId" IS DISTINCT FROM OLD."warehouseId"
    OR NEW."rateSetId" <> OLD."rateSetId"
    OR NEW."version" <> OLD."version"
    OR NEW."fingerprint" <> OLD."fingerprint"
    OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
    OR NEW."approvedBy" IS DISTINCT FROM OLD."approvedBy"
  ) THEN
    RAISE EXCEPTION 'PERIOD_APPROVED: run % is frozen (UPDATE not allowed)', OLD."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_runs_frozen"
  BEFORE UPDATE OR DELETE ON "payroll_runs"
  FOR EACH ROW EXECUTE FUNCTION "payroll_run_frozen"();

-- What belongs to a run only changes while the run is a draft.
CREATE FUNCTION "payroll_child_frozen"() RETURNS trigger AS $$
DECLARE
  r RECORD;
  run_status "PayrollRunStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT "status" INTO run_status FROM "payroll_runs" WHERE "id" = r."runId";
  IF run_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'PERIOD_APPROVED: run % is frozen (% on % not allowed)', r."runId", TG_OP, TG_TABLE_NAME;
  END IF;
  RETURN r;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payslips_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "payslips"
  FOR EACH ROW EXECUTE FUNCTION "payroll_child_frozen"();

CREATE TRIGGER "payslip_lines_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "payslip_lines"
  FOR EACH ROW EXECUTE FUNCTION "payroll_child_frozen"();

CREATE TRIGGER "payroll_manual_lines_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_manual_lines"
  FOR EACH ROW EXECUTE FUNCTION "payroll_child_frozen"();

-- The month lock also covers one employee: a worker moved during the month has days in
-- another dépôt, and a worker without a dépôt has none for a dépôt lock to match.
CREATE OR REPLACE FUNCTION "attendance_month_locked"() RETURNS trigger AS $$
DECLARE
  r RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM "attendance_month_locks" l
    WHERE l."tenantId" = r."tenantId"
      AND l."month" = to_char(r."day", 'YYYY-MM')
      AND (
        l."employeeId" = r."employeeId"
        OR (l."employeeId" IS NULL
            AND (l."warehouseId" IS NULL OR l."warehouseId" = r."warehouseId"))
      )
  ) THEN
    RAISE EXCEPTION 'PERIOD_APPROVED: % is locked (% not allowed)', to_char(r."day", 'YYYY-MM'), TG_OP;
  END IF;
  RETURN r;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "pay_item_types" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "pay_item_types"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "employee_pay_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_pay_items"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "payroll_runs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payroll_runs"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "payslips" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payslips"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "payslip_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payslip_lines"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "payroll_manual_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payroll_manual_lines"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

-- The rates known in 2026, here and not in seed.ts because production never runs the seed.
-- toVerify stays true until a comptable has checked them (a new row clears it).
INSERT INTO "payroll_rate_sets" (
  "id", "effectiveFrom", "cnasEmployeeRate", "cnasEmployerRate", "irgBrackets",
  "abattementRate", "abattementMin", "abattementMax", "exemptionThreshold", "lissageCeiling",
  "lissageNum", "lissageDen", "lissageOffsetNum", "lissageOffsetDen", "snmg", "toVerify", "note"
) VALUES (
  gen_random_uuid(), '2026-01-01', 0.09, 0.26,
  '[{"upTo":"240000","rate":"0"},{"upTo":"480000","rate":"0.23"},{"upTo":"960000","rate":"0.27"},{"upTo":"1920000","rate":"0.30"},{"upTo":"3840000","rate":"0.33"},{"upTo":null,"rate":"0.35"}]'::jsonb,
  0.40, 1000, 1500, 30000, 35000, 137, 51, 27925, 8, 24000, true,
  'Taux connus en 2026, à faire vérifier par un comptable.'
);
