#!/usr/bin/env bash
# End-to-end test of backups: migrate + seed a WAL-G Postgres, take a base backup,
# write more rows after it (they can only come back through the archived WAL), then
# run the restore drill and compare its counts with the live database.
# Needs Docker and the repo's dependencies installed (pnpm install).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/infra/ci/compose.backup.yml")
OWNER_URL="postgresql://erp:erp@localhost:5435/erp?schema=public"
psql_live() { "${COMPOSE[@]}" exec -T db psql -U erp -d erp -v ON_ERROR_STOP=1 -At "$@"; }

cleanup() {
  local rc=$?
  "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  exit "$rc"
}
trap cleanup EXIT
"${COMPOSE[@]}" up -d --build --wait db

echo "== migrate + seed"
(cd "$ROOT/apps/api" &&
  DATABASE_URL="$OWNER_URL" DATABASE_URL_MIGRATE="$OWNER_URL" pnpm exec prisma migrate deploy &&
  DATABASE_URL_MIGRATE="$OWNER_URL" pnpm exec tsx prisma/seed.ts)

echo "== base backup"
"${COMPOSE[@]}" exec -T -u postgres db wal-g backup-push /var/lib/postgresql/data

echo "== rows written after the backup"
psql_live -c "INSERT INTO clients (id, \"tenantId\", code, name, \"updatedAt\")
  SELECT gen_random_uuid(), id, 'DRILL-' || n, 'After backup ' || n, now()
  FROM tenants, generate_series(1, 3) n"
expected=$(psql_live -c 'SELECT count(*) FROM clients')
segment=$(psql_live -c 'SELECT pg_walfile_name(pg_switch_wal())')
for _ in $(seq 1 60); do
  archived=$(psql_live -c 'SELECT coalesce(last_archived_wal, $$$$) FROM pg_stat_archiver')
  [[ "$archived" > "$segment" || "$archived" == "$segment" ]] && break
  sleep 1
done
echo "archived up to $archived (needed $segment)"

echo "== restore drill"
report="$(mktemp)"
"$ROOT/infra/scripts/restore-drill.sh" --env-file "$ROOT/infra/ci/backup.env" \
  --network erp-backup-test_default --image erp-saas/postgres:local --report "$report"

restored=$(awk -F'|' '$1 == "clients" { print $2 }' "$report")
echo "clients: live $expected, restored $restored"
[ "$restored" = "$expected" ] || { echo "== FAILED: restored copy is missing rows" >&2; exit 1; }
echo "== backup + restore drill OK"
