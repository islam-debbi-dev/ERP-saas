-- Phase 39 (A1): mobile access and seat limit. Additive only (expand step):
--   - sessions.clientType: WEB | NATIVE, null for sessions opened before this release
--     (filled at their next refresh);
--   - index for counting the live native sessions of a tenant at login.
-- Nothing is renamed, dropped or backfilled.

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "clientType" VARCHAR(10);

-- CreateIndex
CREATE INDEX "sessions_tenantId_clientType_revokedAt_idx" ON "sessions"("tenantId", "clientType", "revokedAt");
