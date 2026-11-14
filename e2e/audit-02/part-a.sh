#!/usr/bin/env bash
# Audit 02, part A (correctness): every suite, in order, on the audit database.
#
# Before:
#   docker compose -f infra/docker-compose.yml up -d db
#   docker exec erp-saas-db-1 psql -U erp -d postgres -c 'CREATE DATABASE erp_audit02'
#   (cd apps/api && DATABASE_URL_MIGRATE=postgresql://erp:erp@localhost:5432/erp_audit02 pnpm exec prisma migrate deploy)
#   NEXT_PUBLIC_API_URL=http://localhost:3003 pnpm build
#   AUDIT_DB=erp_audit02 e2e/map-stack.sh api &      # port 3003, connected as erp_app (RLS applies)
#   e2e/map-stack.sh web &                           # port 3005
#
# Then:  bash e2e/audit-02/part-a.sh          (add `web` to run the browser suite too)
#
# Outputs: e2e/artifacts/audit-02/*.md|json|log
set -u
cd "$(dirname "$0")/.."
export API="${API:-http://localhost:3003}"
export WEB="${WEB:-http://localhost:3005}"
export DB="${DB:-postgresql://erp:erp@localhost:5432/erp_audit02}"
export AUDIT_RUN=audit-02
OUT=artifacts/audit-02
mkdir -p "$OUT"
TSX=./node_modules/.bin/tsx

step() { # name, command...
  local name=$1; shift
  local start=$SECONDS
  "$@" > "$OUT/$name.log" 2>&1
  echo "$name: exit $?, $((SECONDS - start)) s — $(grep -E '^[a-z-]+: [0-9]+ checks' "$OUT/$name.log" | tail -1)"
}

step scenario    $TSX api/scenario.ts
step attacks     $TSX api/attacks.ts
step concurrency $TSX api/concurrency.ts
step invariants  $TSX sql/run-invariants.ts
# The repo's own reconcile, on the same database, as the owner (it reads every tenant).
( cd ../apps/api && DATABASE_URL="$DB" DATABASE_URL_MIGRATE="$DB" node dist/reconcile/reconcile.cli.js ) > "$OUT/reconcile.log" 2>&1
echo "reconcile: exit $? — $(tail -1 "$OUT/reconcile.log")"
if [ "${1:-}" = "web" ]; then
  # The suite's setup creates its super-admin with the repo CLI, which reads apps/api/.env
  # (the dev database) unless told otherwise.
  DATABASE_URL="$DB" DATABASE_URL_MIGRATE="$DB" \
  PLAYWRIGHT_JSON_OUTPUT_FILE="$OUT/web.json" ./node_modules/.bin/playwright test \
    --config web/playwright.config.ts --project=desktop --trace off > "$OUT/web.log" 2>&1
  echo "web: exit $? — $(grep -E '^\s+[0-9]+ (passed|failed)' "$OUT/web.log" | tr '\n' ' ')"
fi
