-- Phase 35 follow-up (REPORT-35, C-1): an index the API can use.
--
-- The API connects as a role that row-level security binds. Under RLS PostgreSQL only
-- takes a condition as an index condition when its operator is leakproof, and the
-- comparison operators of `numeric` are not: the lat/lng box of the client map and of
-- "Clients proches" was a filter applied after reading every client of the tenant, and
-- `clients_tenant_geo_idx` was never used (it was, for the table owner, which is why
-- EXPLAIN in psql showed it). The `float8` comparison operators are leakproof.
--
-- So: the same coordinates as double precision, kept by the database itself, and the
-- partial index on those. `lat` / `lng` stay the columns the application writes and reads.
-- A cast in the query (`lat::float8 >= …`) would not do: the cast is not leakproof either.
--
-- Additive. Adding a stored generated column rewrites the table under an exclusive lock:
-- about 1 s for 145 000 clients on a laptop, not noticeable on a pilot's few thousand.
-- `clients_tenant_geo_idx` is dropped in a later release (two-step, AGENTS.md §7).
ALTER TABLE "clients"
  ADD COLUMN "lat_f" DOUBLE PRECISION GENERATED ALWAYS AS ("lat"::double precision) STORED,
  ADD COLUMN "lng_f" DOUBLE PRECISION GENERATED ALWAYS AS ("lng"::double precision) STORED;

CREATE INDEX "clients_tenant_geo_f_idx" ON "clients" ("tenantId", "lat_f", "lng_f")
  WHERE "deletedAt" IS NULL AND "lat_f" IS NOT NULL;
