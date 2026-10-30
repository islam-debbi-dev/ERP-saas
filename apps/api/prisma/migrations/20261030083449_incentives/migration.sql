-- CreateEnum
CREATE TYPE "IncentivePeriod" AS ENUM ('MONTH', 'QUARTER');

-- CreateEnum
CREATE TYPE "IncentivePlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "IncentiveAppliesTo" AS ENUM ('ROLE', 'USER', 'TEAM_MANAGER');

-- CreateEnum
CREATE TYPE "IncentiveRunStatus" AS ENUM ('PREVIEW', 'APPROVED', 'EXPORTED');

-- CreateTable
CREATE TABLE "sales_targets" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "userId" UUID,
    "teamManagerId" UUID,
    "metric" VARCHAR(30) NOT NULL,
    "scopeKey" VARCHAR(160) NOT NULL DEFAULT '',
    "brandId" UUID,
    "categoryId" UUID,
    "productId" UUID,
    "targetValue" DECIMAL(16,3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_plans" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" VARCHAR(80) NOT NULL,
    "period" "IncentivePeriod" NOT NULL DEFAULT 'MONTH',
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "status" "IncentivePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incentive_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_rules" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "appliesTo" "IncentiveAppliesTo" NOT NULL,
    "roleOrUserId" VARCHAR(40) NOT NULL,
    "params" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incentive_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_runs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "IncentiveRunStatus" NOT NULL DEFAULT 'PREVIEW',
    "computedAt" TIMESTAMPTZ(3) NOT NULL,
    "computedBy" UUID,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "exportedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incentive_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "metrics" JSONB NOT NULL,
    "target" DECIMAL(16,3),
    "amount" DECIMAL(14,2) NOT NULL,
    "explanation" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incentive_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_targets_tenantId_periodStart_idx" ON "sales_targets"("tenantId", "periodStart");

-- CreateIndex
CREATE INDEX "incentive_plans_tenantId_status_idx" ON "incentive_plans"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "incentive_plans_tenantId_familyId_version_key" ON "incentive_plans"("tenantId", "familyId", "version");

-- CreateIndex
CREATE INDEX "incentive_rules_tenantId_planId_idx" ON "incentive_rules"("tenantId", "planId");

-- CreateIndex
CREATE INDEX "incentive_runs_tenantId_planId_periodStart_idx" ON "incentive_runs"("tenantId", "planId", "periodStart");

-- CreateIndex
CREATE INDEX "incentive_runs_tenantId_status_periodStart_idx" ON "incentive_runs"("tenantId", "status", "periodStart");

-- CreateIndex
CREATE INDEX "incentive_lines_tenantId_runId_idx" ON "incentive_lines"("tenantId", "runId");

-- CreateIndex
CREATE INDEX "incentive_lines_tenantId_userId_idx" ON "incentive_lines"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_plans" ADD CONSTRAINT "incentive_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_rules" ADD CONSTRAINT "incentive_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_rules" ADD CONSTRAINT "incentive_rules_planId_fkey" FOREIGN KEY ("planId") REFERENCES "incentive_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_runs" ADD CONSTRAINT "incentive_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_runs" ADD CONSTRAINT "incentive_runs_planId_fkey" FOREIGN KEY ("planId") REFERENCES "incentive_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_lines" ADD CONSTRAINT "incentive_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_lines" ADD CONSTRAINT "incentive_lines_runId_fkey" FOREIGN KEY ("runId") REFERENCES "incentive_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_lines" ADD CONSTRAINT "incentive_lines_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "incentive_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: a target is for a seller or for a team, never both.
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_subject_check"
  CHECK (("userId" IS NULL) <> ("teamManagerId" IS NULL));
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_value_check" CHECK ("targetValue" >= 0);

-- One target per subject, month, metric and scope.
CREATE UNIQUE INDEX "sales_targets_subject_key" ON "sales_targets"
  ("tenantId", "periodStart", COALESCE("userId", "teamManagerId"), ("teamManagerId" IS NOT NULL), "metric", "scopeKey");

-- One preview and at most one approved run per plan and period.
CREATE UNIQUE INDEX "incentive_runs_preview_key" ON "incentive_runs" ("tenantId", "planId", "periodStart")
  WHERE "status" = 'PREVIEW';
CREATE UNIQUE INDEX "incentive_runs_approved_key" ON "incentive_runs" ("tenantId", "planId", "periodStart")
  WHERE "status" IN ('APPROVED', 'EXPORTED');

-- An approved run is frozen, even for raw SQL: it only moves to EXPORTED (and records
-- when), and is never deleted.
CREATE FUNCTION "incentive_runs_frozen"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'PREVIEW' THEN
      RAISE EXCEPTION 'incentive_runs: an approved run cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'PREVIEW' AND NOT (
    NEW."status" IN ('APPROVED', 'EXPORTED')
    AND NEW."planId" = OLD."planId"
    AND NEW."periodStart" = OLD."periodStart"
    AND NEW."periodEnd" = OLD."periodEnd"
    AND NEW."computedAt" = OLD."computedAt"
    AND NEW."approvedBy" IS NOT DISTINCT FROM OLD."approvedBy"
    AND NEW."approvedAt" IS NOT DISTINCT FROM OLD."approvedAt"
  ) THEN
    RAISE EXCEPTION 'incentive_runs: an approved run is frozen';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "incentive_runs_frozen"
  BEFORE UPDATE OR DELETE ON "incentive_runs"
  FOR EACH ROW EXECUTE FUNCTION "incentive_runs_frozen"();

-- Lines of an approved run are never changed, removed or added.
CREATE FUNCTION "incentive_lines_frozen"() RETURNS trigger AS $$
DECLARE
  run_status text;
BEGIN
  SELECT "status" INTO run_status FROM "incentive_runs"
  WHERE "id" = (CASE WHEN TG_OP = 'INSERT' THEN NEW."runId" ELSE OLD."runId" END);
  IF run_status IS DISTINCT FROM 'PREVIEW' THEN
    RAISE EXCEPTION 'incentive_lines: the run is approved (% not allowed)', TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "incentive_lines_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "incentive_lines"
  FOR EACH ROW EXECUTE FUNCTION "incentive_lines_frozen"();

-- Row-Level Security, same policy as 20261028090000_row_level_security.
ALTER TABLE "sales_targets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "sales_targets"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "incentive_plans" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "incentive_plans"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "incentive_rules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "incentive_rules"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "incentive_runs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "incentive_runs"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "incentive_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "incentive_lines"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

