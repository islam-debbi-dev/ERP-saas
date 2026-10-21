#!/bin/sh
# Runs once, when the Postgres data directory is first created (docker-entrypoint-initdb.d).
# Creates erp_app, the role the API connects as: not the owner and not a superuser, so
# the row-level security policies apply to it. Migrations (run as the owner) grant it
# access to the tables. Existing databases: see docs/runbook.md, "Database roles".
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v pw="${APP_DB_PASSWORD:-erp_app}" <<'SQL'
SELECT format('CREATE ROLE erp_app LOGIN PASSWORD %L', :'pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app') \gexec
SQL
