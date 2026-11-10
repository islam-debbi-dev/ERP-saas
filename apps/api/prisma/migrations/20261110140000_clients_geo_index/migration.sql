-- Phase 35: the client map and "near me" read live clients with a saved point, filtered by
-- a lat/lng box. Additive only; Prisma cannot express the partial index, so it lives here.
CREATE INDEX "clients_tenant_geo_idx" ON "clients" ("tenantId", "lat", "lng")
  WHERE "deletedAt" IS NULL AND "lat" IS NOT NULL;
