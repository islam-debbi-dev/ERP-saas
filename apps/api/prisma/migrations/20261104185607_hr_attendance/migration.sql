-- CreateEnum
CREATE TYPE "EmployeeContract" AS ENUM ('CDI', 'CDD', 'JOURNALIER');

-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('MONTHLY', 'DAILY');

-- CreateEnum
CREATE TYPE "AttendanceEventKind" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'CHECK_IN', 'CHECK_OUT', 'OVERTIME', 'CORRECTION');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('MANAGER', 'SELF', 'IMPORT');

-- CreateEnum
CREATE TYPE "AbsenceReason" AS ENUM ('JUSTIFIED', 'SICK', 'UNJUSTIFIED');

-- CreateEnum
CREATE TYPE "DayStatus" AS ENUM ('PRESENT', 'ABSENT_UNJUSTIFIED', 'ABSENT_JUSTIFIED', 'SICK', 'LEAVE_PAID', 'LEAVE_UNPAID', 'HALF_DAY', 'REST', 'HOLIDAY', 'NOT_EMPLOYED', 'UNMARKED');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('PAID', 'UNPAID', 'SICK', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaveEntryType" AS ENUM ('ACCRUAL', 'TAKEN', 'ADJUST', 'OPENING');

-- CreateEnum
CREATE TYPE "EmployeeLedgerType" AS ENUM ('ADVANCE', 'REVERSAL', 'OPENING');

-- AlterEnum
ALTER TYPE "DocType" ADD VALUE 'EMP';

-- AlterEnum
ALTER TYPE "GeoRefType" ADD VALUE 'ATTENDANCE';

-- AlterEnum
ALTER TYPE "ImportType" ADD VALUE 'EMPLOYEES';

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "employeeId" UUID;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "hrDailyHours" SMALLINT NOT NULL DEFAULT 8,
ADD COLUMN     "hrLeaveAccrualDays" DECIMAL(3,1) NOT NULL DEFAULT 2.5,
ADD COLUMN     "hrRestDays" INTEGER[] DEFAULT ARRAY[5]::INTEGER[],
ADD COLUMN     "hrSelfCheckIn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "lat" DECIMAL(9,6),
ADD COLUMN     "lng" DECIMAL(9,6),
ADD COLUMN     "radiusM" SMALLINT;

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "matricule" VARCHAR(20) NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(40),
    "position" VARCHAR(80),
    "warehouseId" UUID,
    "userId" UUID,
    "hireDate" DATE NOT NULL,
    "exitDate" DATE,
    "contract" "EmployeeContract" NOT NULL,
    "contractEndDate" DATE,
    "declared" BOOLEAN NOT NULL DEFAULT false,
    "nss" VARCHAR(30),
    "nin" VARCHAR(30),
    "birthDate" DATE,
    "bankAccount" VARCHAR(40),
    "restDays" SMALLINT[] DEFAULT ARRAY[]::SMALLINT[],
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_salaries" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payType" "PayType" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "reason" VARCHAR(255),
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_salaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_balances" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "advanceBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "leaveDays" DECIMAL(6,1) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_ledger_entries" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "EmployeeLedgerType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "expenseId" UUID,
    "note" VARCHAR(255),
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_events" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "warehouseId" UUID,
    "day" DATE NOT NULL,
    "kind" "AttendanceEventKind" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "AttendanceSource" NOT NULL,
    "absenceReason" "AbsenceReason",
    "correctedTo" "DayStatus",
    "lateMinutes" SMALLINT,
    "overtimeHours" DECIMAL(4,2),
    "note" VARCHAR(255),
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "warehouseId" UUID,
    "day" DATE NOT NULL,
    "status" "DayStatus" NOT NULL,
    "lateMinutes" SMALLINT NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_month_locks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "warehouseId" UUID,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_month_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_holidays" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "key" VARCHAR(30),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "type" "LeaveType" NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "days" DECIMAL(6,1) NOT NULL,
    "note" VARCHAR(255),
    "decisionReason" VARCHAR(255),
    "decidedBy" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_entries" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "LeaveEntryType" NOT NULL,
    "days" DECIMAL(6,1) NOT NULL,
    "month" VARCHAR(7),
    "leaveRequestId" UUID,
    "note" VARCHAR(255),
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_userId_key" ON "employees"("userId");

-- CreateIndex
CREATE INDEX "employees_tenantId_warehouseId_idx" ON "employees"("tenantId", "warehouseId");

-- CreateIndex
CREATE INDEX "employees_tenantId_fullName_idx" ON "employees"("tenantId", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenantId_matricule_key" ON "employees"("tenantId", "matricule");

-- CreateIndex
CREATE UNIQUE INDEX "employee_salaries_seq_key" ON "employee_salaries"("seq");

-- CreateIndex
CREATE INDEX "employee_salaries_tenantId_employeeId_effectiveFrom_idx" ON "employee_salaries"("tenantId", "employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "employee_balances_employeeId_key" ON "employee_balances"("employeeId");

-- CreateIndex
CREATE INDEX "employee_balances_tenantId_idx" ON "employee_balances"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_ledger_entries_seq_key" ON "employee_ledger_entries"("seq");

-- CreateIndex
CREATE INDEX "employee_ledger_entries_tenantId_employeeId_seq_idx" ON "employee_ledger_entries"("tenantId", "employeeId", "seq");

-- CreateIndex
CREATE INDEX "employee_ledger_entries_tenantId_expenseId_idx" ON "employee_ledger_entries"("tenantId", "expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_events_seq_key" ON "attendance_events"("seq");

-- CreateIndex
CREATE INDEX "attendance_events_tenantId_employeeId_day_seq_idx" ON "attendance_events"("tenantId", "employeeId", "day", "seq");

-- CreateIndex
CREATE INDEX "attendance_events_tenantId_day_idx" ON "attendance_events"("tenantId", "day");

-- CreateIndex
CREATE INDEX "attendance_days_tenantId_day_status_idx" ON "attendance_days"("tenantId", "day", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_days_tenantId_employeeId_day_key" ON "attendance_days"("tenantId", "employeeId", "day");

-- CreateIndex
CREATE INDEX "attendance_month_locks_tenantId_month_idx" ON "attendance_month_locks"("tenantId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "public_holidays_tenantId_date_key" ON "public_holidays"("tenantId", "date");

-- CreateIndex
CREATE INDEX "leave_requests_tenantId_status_startDate_idx" ON "leave_requests"("tenantId", "status", "startDate");

-- CreateIndex
CREATE INDEX "leave_requests_tenantId_employeeId_startDate_idx" ON "leave_requests"("tenantId", "employeeId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "leave_entries_seq_key" ON "leave_entries"("seq");

-- CreateIndex
CREATE INDEX "leave_entries_tenantId_employeeId_seq_idx" ON "leave_entries"("tenantId", "employeeId", "seq");

-- CreateIndex
CREATE INDEX "expenses_tenantId_employeeId_idx" ON "expenses"("tenantId", "employeeId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_balances" ADD CONSTRAINT "employee_balances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_balances" ADD CONSTRAINT "employee_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_ledger_entries" ADD CONSTRAINT "employee_ledger_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_ledger_entries" ADD CONSTRAINT "employee_ledger_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_month_locks" ADD CONSTRAINT "attendance_month_locks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "leave_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written from here on.
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_amount_check" CHECK ("amount" > 0);
ALTER TABLE "employee_ledger_entries" ADD CONSTRAINT "employee_ledger_entries_amount_check" CHECK ("amount" <> 0);
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_days_check" CHECK ("days" <> 0 OR "type" = 'ACCRUAL');
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_dates_check" CHECK ("startDate" <= "endDate");
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_hrDailyHours_check" CHECK ("hrDailyHours" BETWEEN 1 AND 24);
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_radiusM_check" CHECK ("radiusM" IS NULL OR "radiusM" BETWEEN 20 AND 5000);

-- One accrual per employee and month: the month-close job can run twice.
CREATE UNIQUE INDEX "leave_entries_accrual_month_key"
  ON "leave_entries" ("tenantId", "employeeId", "month") WHERE "type" = 'ACCRUAL';

-- Append-only, even for raw SQL (AGENTS.md rule 1).
CREATE FUNCTION "attendance_events_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'attendance_events is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attendance_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "attendance_events"
  FOR EACH ROW EXECUTE FUNCTION "attendance_events_append_only"();

CREATE FUNCTION "employee_salaries_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'employee_salaries is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_salaries_no_update_delete"
  BEFORE UPDATE OR DELETE ON "employee_salaries"
  FOR EACH ROW EXECUTE FUNCTION "employee_salaries_append_only"();

CREATE FUNCTION "employee_ledger_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'employee_ledger_entries is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_ledger_no_update_delete"
  BEFORE UPDATE OR DELETE ON "employee_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "employee_ledger_append_only"();

CREATE FUNCTION "leave_entries_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'leave_entries is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "leave_entries_no_update_delete"
  BEFORE UPDATE OR DELETE ON "leave_entries"
  FOR EACH ROW EXECUTE FUNCTION "leave_entries_append_only"();

-- A day inside a month whose payroll is approved takes no new event and its cached status
-- is frozen. The services check first and answer PERIOD_APPROVED; this is the backstop.
CREATE FUNCTION "attendance_month_locked"() RETURNS trigger AS $$
DECLARE
  r RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM "attendance_month_locks" l
    WHERE l."tenantId" = r."tenantId"
      AND l."month" = to_char(r."day", 'YYYY-MM')
      AND (l."warehouseId" IS NULL OR l."warehouseId" = r."warehouseId")
  ) THEN
    RAISE EXCEPTION 'PERIOD_APPROVED: % is locked (% not allowed)', to_char(r."day", 'YYYY-MM'), TG_OP;
  END IF;
  RETURN r;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attendance_events_month_locked"
  BEFORE INSERT ON "attendance_events"
  FOR EACH ROW EXECUTE FUNCTION "attendance_month_locked"();

CREATE TRIGGER "attendance_days_month_locked"
  BEFORE INSERT OR UPDATE OR DELETE ON "attendance_days"
  FOR EACH ROW EXECUTE FUNCTION "attendance_month_locked"();

-- Row-Level Security, same policy as 20261028090000_row_level_security.
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employees"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "employee_salaries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_salaries"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "employee_balances" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_balances"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "employee_ledger_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_ledger_entries"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "attendance_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attendance_events"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "attendance_days" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attendance_days"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "attendance_month_locks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attendance_month_locks"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "public_holidays" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "public_holidays"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "leave_requests"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "leave_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "leave_entries"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');
