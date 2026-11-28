-- Phase 40b (expand only): roles AREA_MANAGER and PREVENDEUR, seller scope BY_ZONE, field
-- zones and the dated zone assignments of sellers. The running version ignores all of it.
-- The new enum values are only added here, never used, so one transaction is enough.

-- CreateEnum
CREATE TYPE "ZoneKind" AS ENUM ('AREA', 'CITY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'AREA_MANAGER';
ALTER TYPE "Role" ADD VALUE 'PREVENDEUR';

-- AlterEnum
ALTER TYPE "SellerScope" ADD VALUE 'BY_ZONE';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "zoneIncludesAssigned" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "field_zones" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" "ZoneKind" NOT NULL,
    "parentZoneId" UUID,
    "wilayaCodes" SMALLINT[] DEFAULT ARRAY[]::SMALLINT[],
    "communeCodes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "responsibleUserId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "field_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_zone_assignments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "zoneId" UUID,
    "communeCodes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "assignedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_zone_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "field_zones_tenantId_kind_deletedAt_idx" ON "field_zones"("tenantId", "kind", "deletedAt");

-- CreateIndex
CREATE INDEX "field_zones_tenantId_responsibleUserId_idx" ON "field_zones"("tenantId", "responsibleUserId");

-- CreateIndex
CREATE INDEX "field_zones_tenantId_parentZoneId_idx" ON "field_zones"("tenantId", "parentZoneId");

-- CreateIndex
CREATE INDEX "seller_zone_assignments_tenantId_userId_validFrom_idx" ON "seller_zone_assignments"("tenantId", "userId", "validFrom" DESC);

-- CreateIndex
CREATE INDEX "seller_zone_assignments_tenantId_zoneId_idx" ON "seller_zone_assignments"("tenantId", "zoneId");

-- AddForeignKey
ALTER TABLE "field_zones" ADD CONSTRAINT "field_zones_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_zones" ADD CONSTRAINT "field_zones_parentZoneId_fkey" FOREIGN KEY ("parentZoneId") REFERENCES "field_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_zones" ADD CONSTRAINT "field_zones_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_zone_assignments" ADD CONSTRAINT "seller_zone_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_zone_assignments" ADD CONSTRAINT "seller_zone_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_zone_assignments" ADD CONSTRAINT "seller_zone_assignments_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "field_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_zone_assignments" ADD CONSTRAINT "seller_zone_assignments_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Who created a client: a team lead's "clients sans commune" list covers the clients his
-- team created. Existing rows take it from their CLIENT_CREATED audit row; without one it
-- stays null (never guessed).
ALTER TABLE "clients" ADD COLUMN "createdBy" UUID;
UPDATE "clients" c SET "createdBy" = a."userId"
FROM "audit_logs" a
WHERE a."tenantId" = c."tenantId" AND a."entity" = 'Client' AND a."entityId" = c."id"::text
  AND a."action" = 'CLIENT_CREATED' AND a."userId" IS NOT NULL;

-- An area is a top level: only a city zone sits inside another zone.
ALTER TABLE "field_zones" ADD CONSTRAINT "field_zones_parent_check"
  CHECK ("kind" = 'CITY' OR "parentZoneId" IS NULL);

-- An assignment names a zone or lists communes, never both and never neither.
ALTER TABLE "seller_zone_assignments" ADD CONSTRAINT "seller_zone_assignments_target_check"
  CHECK (("zoneId" IS NOT NULL) <> (COALESCE(cardinality("communeCodes"), 0) > 0));
ALTER TABLE "seller_zone_assignments" ADD CONSTRAINT "seller_zone_assignments_period_check"
  CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");

-- One open assignment per user: two moves at the same time cannot leave two.
CREATE UNIQUE INDEX "seller_zone_assignments_one_open_key"
  ON "seller_zone_assignments"("tenantId", "userId") WHERE "validTo" IS NULL;

-- The history is append-only. The one change allowed is closing an open row, once:
-- "validTo" goes from null to a time and nothing else moves.
CREATE FUNCTION "seller_zone_assignments_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."validTo" IS NULL AND NEW."validTo" IS NOT NULL
       AND (to_jsonb(NEW) - 'validTo') = (to_jsonb(OLD) - 'validTo') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'seller_zone_assignments is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "seller_zone_assignments_close_only"
  BEFORE UPDATE OR DELETE ON "seller_zone_assignments"
  FOR EACH ROW EXECUTE FUNCTION "seller_zone_assignments_append_only"();

-- Row-Level Security, same policy as 20261028090000_row_level_security.
ALTER TABLE "field_zones" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "field_zones"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "seller_zone_assignments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "seller_zone_assignments"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');
