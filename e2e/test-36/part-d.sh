#!/usr/bin/env bash
# Part D of test-36 (e2e/REPORT-36.md, section 12): backfill and upgrade, on the local
# scratch database erp_t36_base only (dropped and made again). Never the dev database
# `erp`, never Neon.
#
#   OLD=../erp-main bash e2e/test-36/part-d.sh
#
# OLD is a worktree of main before PR #72 (93afa56), installed and built with
# NEXT_PUBLIC_API_URL=http://localhost:3003, with apps/api/.env copied from this checkout.
# This checkout must be built too (`pnpm build`). Port 3003 must be free.
#
#   1. erp_t36_base at the pre-36 schema (old migrations), app role;
#   2. the old API on :3003, the pre-36 history through it (api/vehicles-backfill-seed.ts);
#   3. 50 000 visits and 50 000 orders added with SQL (sql/vehicles-backfill-bulk.sql);
#   4. the phase 36 migration timed statement by statement in a rolled-back transaction,
#      with a writer probe, then applied for real with `prisma migrate deploy`;
#   5. the backfill CLI twice, the truth SQL (sql/vehicles-backfill.sql), reconcile
#      (api/vehicles-backfill.ts);
#   2b. the NEW API on the pre-36 schema (what runs if Vercel deploys before db:deploy);
#   6. the old web against the new API: the old Playwright desktop suite, then the screens it
#      does not open with a vehicle route in the data (test-36/old-web-vehicle-route.ts);
#   7. the old API and the old web on the migrated schema: the old desktop suite.
# Steps 6 and 7 are skipped with OLD_WEB=0.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OLD="$(cd "${OLD:-$ROOT/../erp-main}" && pwd)"
DBN=erp_t36_base
MIG=postgresql://erp:erp@localhost:5432/$DBN
OUT="$ROOT/e2e/artifacts/test-36/part-d"
mkdir -p "$OUT"
psqlq() { docker exec -i erp-saas-db-1 psql -v ON_ERROR_STOP=1 -U erp -d $DBN "$@"; }
wait_api() { for _ in $(seq 1 30); do curl -sf localhost:3003/health >/dev/null && return 0; sleep 1; done; echo "API did not start" >&2; exit 1; }
stop_api() { pid=$(lsof -tiTCP:3003 -sTCP:LISTEN || true); [ -n "$pid" ] && kill $pid && sleep 1 || true; }
stop_web() { pid=$(lsof -tiTCP:3005 -sTCP:LISTEN || true); [ -n "$pid" ] && kill $pid && sleep 1 || true; }
start_api() { # $1 = checkout, $2 = expected status of GET /vehicle-types (404 old, 401 new)
  (cd "$1" && AUDIT_DB=$DBN LOG_LEVEL=warn e2e/map-stack.sh api >> "$OUT/api.log" 2>&1 &)
  wait_api
  test "$(curl -s -o /dev/null -w '%{http_code}' localhost:3003/vehicle-types)" = "$2" || { echo "port 3003 is not the API expected ($2)" >&2; stop_api; exit 1; }
}
start_old_web() {
  if lsof -tiTCP:3005 -sTCP:LISTEN >/dev/null; then echo "port 3005 is busy" >&2; stop_api; exit 1; fi
  (cd "$OLD" && e2e/map-stack.sh web >> "$OUT/old-web.log" 2>&1 &)
  for _ in $(seq 1 30); do curl -sf -o /dev/null localhost:3005/login && break; sleep 1; done
}
old_suite() { # $1 = output file
  # The old suite's packages are the same as this checkout's (e2e/package.json differs only in scripts).
  [ -e "$OLD/e2e/node_modules" ] || ln -s "$ROOT/e2e/node_modules" "$OLD/e2e/node_modules"
  (cd "$OLD/e2e" && DATABASE_URL=$MIG DATABASE_URL_MIGRATE=$MIG DB=$MIG \
     API=http://localhost:3003 WEB=http://localhost:3005 \
     ./node_modules/.bin/playwright test --config web/playwright.config.ts --project=desktop --trace off --reporter=line 2>&1 | tail -25) | tee "$1" || true
}

if lsof -tiTCP:3003 -sTCP:LISTEN >/dev/null; then echo "port 3003 is busy: stop that API first" >&2; exit 1; fi
echo "old: $(git -C "$OLD" log --oneline -1)" | tee "$OUT/versions.txt"
echo "new: $(git -C "$ROOT" log --oneline -1)" | tee -a "$OUT/versions.txt"

# 1. pre-36 database
docker exec erp-saas-db-1 dropdb -U erp --if-exists $DBN
docker exec erp-saas-db-1 createdb -U erp $DBN
# The audit helpers keep one super-admin per database URL; this one was just dropped.
grep -q "/$DBN\"" "$ROOT/e2e/.auth/audit02-admin.json" 2>/dev/null && rm -f "$ROOT/e2e/.auth/audit02-admin.json"
(cd "$OLD/apps/api" && DATABASE_URL=$MIG DATABASE_URL_MIGRATE=$MIG pnpm exec prisma migrate deploy >/dev/null)
psqlq -q < "$ROOT/apps/api/prisma/app-role.sql"

# 2. old API, history
: > "$OUT/api.log"; : > "$OUT/old-web.log"; : > "$OUT/api-schema-probe.txt"
start_api "$OLD" 404
(cd "$ROOT/e2e" && API=http://localhost:3003 DB=$MIG pnpm exec tsx api/vehicles-backfill-seed.ts 2>&1) | tee "$OUT/seed.txt"
(cd "$ROOT/e2e" && LABEL="old API, pre-36 schema (control)" pnpm exec tsx test-36/api-schema-probe.ts 2>&1 | grep -v pnpm)
stop_api

# 2b. the new API on the pre-36 schema
start_api "$ROOT" 401
(cd "$ROOT/e2e" && LABEL="NEW API, pre-36 schema (deploy before db:deploy)" pnpm exec tsx test-36/api-schema-probe.ts 2>&1 | grep -v pnpm)
stop_api
{ echo "causes of the 5xx above, from the API log (api.log is git-ignored):"
  grep -o 'The column `[^`]*` does not exist' "$OUT/api.log" | sort | uniq -c || true; echo; } >> "$OUT/api-schema-probe.txt"

# 3. volume
psqlq < "$ROOT/e2e/sql/vehicles-backfill-bulk.sql" 2>&1 | tee "$OUT/bulk.txt"

# 4. the migration: timed in a rolled-back transaction with a writer probe, then for real
(cd "$ROOT/e2e" && DB=$MIG pnpm exec tsx api/vehicles-migration-lock.ts 2>&1) | tee "$OUT/migration-lock.txt"
( cd "$ROOT/apps/api" && start=$(date +%s); DATABASE_URL=$MIG DATABASE_URL_MIGRATE=$MIG pnpm exec prisma migrate deploy 2>&1 | tail -2; echo "prisma migrate deploy: $(( $(date +%s) - start )) s" ) | tee "$OUT/migrate-deploy.txt"

# 5. backfill twice, truth SQL, reconcile
(cd "$ROOT/e2e" && DB=$MIG pnpm exec tsx api/vehicles-backfill.ts 2>&1) | tee "$OUT/backfill.txt"

# 5b. both API versions on the migrated schema
start_api "$OLD" 404
(cd "$ROOT/e2e" && LABEL="old API, migrated schema" pnpm exec tsx test-36/api-schema-probe.ts 2>&1 | grep -v pnpm)
stop_api
start_api "$ROOT" 401
(cd "$ROOT/e2e" && LABEL="new API, migrated schema" pnpm exec tsx test-36/api-schema-probe.ts 2>&1 | grep -v pnpm)
stop_api

if [ "${OLD_WEB:-1}" = 1 ]; then
  # 7 first (no vehicle route yet): the old API and the old web on the migrated schema
  start_api "$OLD" 404
  start_old_web
  old_suite "$OUT/old-web-old-api-migrated.txt"
  stop_api

  # 6. the old web against the new API, then with a vehicle route in the data
  start_api "$ROOT" 401
  old_suite "$OUT/old-web-new-api.txt"
  (cd "$ROOT/e2e" && OLD="$OLD" API=http://localhost:3003 WEB=http://localhost:3005 ./node_modules/.bin/tsx test-36/old-web-vehicle-route.ts 2>&1) | tee "$OUT/old-web-vehicle-route.txt" || true
  stop_api
  stop_web
fi
echo "part D done: $OUT"
