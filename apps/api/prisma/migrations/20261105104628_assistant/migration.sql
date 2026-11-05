-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('ANTHROPIC', 'GEMINI', 'OPENAI_COMPATIBLE');

-- CreateEnum
CREATE TYPE "AiConfigScope" AS ENUM ('PLATFORM', 'TENANT');

-- CreateEnum
CREATE TYPE "AssistantRole" AS ENUM ('USER', 'ASSISTANT');

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "aiQuestionsPerMonth" INTEGER;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "allowTenantAiKey" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ai_provider_configs" (
    "id" UUID NOT NULL,
    "scope" "AiConfigScope" NOT NULL,
    "tenantId" UUID,
    "provider" "AiProvider" NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "baseUrl" VARCHAR(255),
    "apiKeyEncrypted" TEXT NOT NULL,
    "keyHint" VARCHAR(8) NOT NULL,
    "inputPricePerMTokUsd" DECIMAL(12,4) NOT NULL,
    "cachedInputPricePerMTokUsd" DECIMAL(12,4) NOT NULL,
    "outputPricePerMTokUsd" DECIMAL(12,4) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "language" VARCHAR(8),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "AssistantRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "links" JSONB,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "provider" "AiProvider",
    "model" VARCHAR(120),
    "configScope" "AiConfigScope",
    "costMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "useful" BOOLEAN,
    "feedbackComment" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_conversations_tenantId_userId_createdAt_id_idx" ON "assistant_conversations"("tenantId", "userId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "assistant_conversations_createdAt_idx" ON "assistant_conversations"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_messages_seq_key" ON "assistant_messages"("seq");

-- CreateIndex
CREATE INDEX "assistant_messages_tenantId_role_configScope_createdAt_idx" ON "assistant_messages"("tenantId", "role", "configScope", "createdAt");

-- CreateIndex
CREATE INDEX "assistant_messages_tenantId_userId_role_createdAt_idx" ON "assistant_messages"("tenantId", "userId", "role", "createdAt");

-- CreateIndex
CREATE INDEX "assistant_messages_conversationId_seq_idx" ON "assistant_messages"("conversationId", "seq");

-- AddForeignKey
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One PLATFORM row without a company, at most one TENANT row per company.
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_scope_check"
  CHECK (("scope" = 'PLATFORM') = ("tenantId" IS NULL));
CREATE UNIQUE INDEX "ai_provider_configs_platform_key" ON "ai_provider_configs"("scope")
  WHERE "scope" = 'PLATFORM';
CREATE UNIQUE INDEX "ai_provider_configs_tenant_key" ON "ai_provider_configs"("tenantId")
  WHERE "tenantId" IS NOT NULL;

-- Unlike payroll_rate_sets there is no "tenantId IS NULL" read branch: the PLATFORM row
-- holds the platform's API key, and only the system context reads it.
ALTER TABLE "ai_provider_configs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ai_provider_configs"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "assistant_conversations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "assistant_conversations"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "assistant_messages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "assistant_messages"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

-- The seed never overwrites a plan, so production gets its quotas here.
UPDATE "plans" SET "aiQuestionsPerMonth" = 300 WHERE "code" = 'STARTER';
UPDATE "plans" SET "aiQuestionsPerMonth" = 1500 WHERE "code" = 'PRO';
UPDATE "plans" SET "aiQuestionsPerMonth" = 5000 WHERE "code" = 'BUSINESS';
