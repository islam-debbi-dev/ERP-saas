-- Phase 33.5: a user's dashboard cards (additive, nullable; null = the role's default).
ALTER TABLE "users" ADD COLUMN "dashboardLayout" JSONB;
