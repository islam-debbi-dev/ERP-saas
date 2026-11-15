#!/usr/bin/env bash
# Test 36 baseline: lint, typecheck, build and test on Node 22 (CI's version), with the Jest
# integration suites on a scratch database so the result matches a clean CI run.
#
#   bash e2e/test-36/baseline.sh        (from the repo root)
#
# Outputs: e2e/artifacts/test-36/baseline/summary.txt (+ one .log per step, ignored by git)
set -u
cd "$(dirname "$0")/../.."
OUT=e2e/artifacts/test-36/baseline
mkdir -p "$OUT"

N22=$(npx -y node@22 -p process.execPath)
export PATH="$(dirname "$N22"):$PATH"
TEST_DB=erp_test_t36
docker exec erp-saas-db_test-1 psql -U erp -d postgres -qc "DROP DATABASE IF EXISTS $TEST_DB" -c "CREATE DATABASE $TEST_DB" >/dev/null
export DATABASE_URL_TEST="postgresql://erp:erp@localhost:5433/$TEST_DB?schema=public"
# The audited API listens on 3003 (e2e/map-stack.sh); the web bundle must point at it.
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:3003}"

{
  echo "commit: $(git rev-parse HEAD)"
  echo "node:   $(node -v)   pnpm: $(pnpm -v)"
  echo "date:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$OUT/summary.txt"

run() { # name, command...
  local name=$1; shift
  local start=$SECONDS
  "$@" > "$OUT/$name.log" 2>&1
  local code=$?
  echo "$name: exit $code, $((SECONDS - start)) s" | tee -a "$OUT/summary.txt"
}

run lint      pnpm exec turbo run lint --force
run typecheck pnpm exec turbo run typecheck --force
run build     pnpm exec turbo run build --force
run test      pnpm exec turbo run test --force

docker exec erp-saas-db_test-1 psql -U erp -d postgres -qc "DROP DATABASE IF EXISTS $TEST_DB" >/dev/null
echo done >> "$OUT/summary.txt"
