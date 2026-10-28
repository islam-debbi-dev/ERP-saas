-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentMethod" AS ENUM ('BARIDIMOB', 'VIREMENT', 'ESPECES');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "onboardingDismissedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "monthlyPrice" DECIMAL(14,2) NOT NULL,
    "maxUsers" INTEGER,
    "maxProducts" INTEGER,
    "maxDocumentsPerMonth" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" SMALLINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "trialEndsAt" TIMESTAMPTZ(3),
    "currentPeriodEnd" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "SubscriptionPaymentMethod" NOT NULL,
    "reference" VARCHAR(80),
    "months" SMALLINT NOT NULL,
    "periodFrom" TIMESTAMPTZ(3) NOT NULL,
    "periodTo" TIMESTAMPTZ(3) NOT NULL,
    "planId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "totpSecret" VARCHAR(64) NOT NULL,
    "failedLoginCount" SMALLINT NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_sessions" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "refreshTokenHash" CHAR(64) NOT NULL,
    "previousRefreshTokenHash" CHAR(64),
    "rotatedAt" TIMESTAMPTZ(3),
    "userAgent" VARCHAR(255),
    "ip" VARCHAR(45),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "platform_admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "adminId" UUID,
    "sessionId" UUID,
    "tenantId" UUID,
    "action" VARCHAR(60) NOT NULL,
    "detail" JSONB,
    "ip" VARCHAR(45),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenantId_key" ON "subscriptions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_idempotencyKey_key" ON "subscription_payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "subscription_payments_tenantId_createdAt_idx" ON "subscription_payments"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE INDEX "platform_admin_sessions_adminId_revokedAt_idx" ON "platform_admin_sessions"("adminId", "revokedAt");

-- CreateIndex
CREATE INDEX "platform_audit_logs_createdAt_idx" ON "platform_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "platform_audit_logs_tenantId_createdAt_idx" ON "platform_audit_logs"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_admin_sessions" ADD CONSTRAINT "platform_admin_sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Plans (phase 13). Prices in DZD per month; NULL limit = unlimited. The seed upserts
-- the same rows, so a fresh database and production agree.
INSERT INTO "plans" ("id", "code", "name", "monthlyPrice", "maxUsers", "maxProducts", "maxDocumentsPerMonth", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'STARTER',  'Starter',  2500.00, 2,    500,  300,  1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PRO',      'Pro',      4500.00, 5,    3000, 1500, 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'BUSINESS', 'Business', 8000.00, NULL, NULL, NULL, 3, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Every tenant that exists before billing is a pilot: free on Business, never suspended.
-- The super-admin switches them to paid later.
INSERT INTO "subscriptions" ("id", "tenantId", "planId", "status", "isFree", "currentPeriodEnd", "updatedAt")
SELECT gen_random_uuid(), t."id", p."id", 'ACTIVE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t CROSS JOIN "plans" p
WHERE p."code" = 'BUSINESS'
ON CONFLICT ("tenantId") DO NOTHING;

-- Row-Level Security, same policy as 20261028090000_row_level_security.
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "subscriptions"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "subscription_payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "subscription_payments"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

-- Super-admin tables: only the system context (admin flows run in it) sees them.
ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "system_only" ON "platform_admins"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "platform_admin_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "system_only" ON "platform_admin_sessions"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "platform_audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "system_only" ON "platform_audit_logs"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
