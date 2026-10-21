-- Grants for the runtime role erp_app (RLS applies to it; it owns nothing).
-- Idempotent. Run as the owner after creating the role, e.g.:
--   CREATE ROLE erp_app LOGIN PASSWORD '...';
--   psql "$DATABASE_URL_MIGRATE" -f apps/api/prisma/app-role.sql
-- Tables created by later migrations are covered by the default privileges.
GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app;
