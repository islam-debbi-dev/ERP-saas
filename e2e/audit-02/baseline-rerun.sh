#!/usr/bin/env bash
# Audit 02 baseline, quiet pass: the API Jest suites (unit + integration) once more, alone on
# the machine, on a scratch database and Node 22. The first full run (baseline.sh) shared the
# CPU with the audit's own API and suites and lost 58 tests to "Exceeded timeout of 5000 ms".
#
#   bash e2e/audit-02/baseline-rerun.sh
set -u
cd "$(dirname "$0")/../.."
OUT=e2e/artifacts/audit-02/baseline
N22=$(npx -y node@22 -p process.execPath)
export PATH="$(dirname "$N22"):$PATH"
TEST_DB=erp_test_audit02b
docker exec erp-saas-db_test-1 psql -U erp -d postgres -qc "DROP DATABASE IF EXISTS $TEST_DB" -c "CREATE DATABASE $TEST_DB" >/dev/null
export DATABASE_URL_TEST="postgresql://erp:erp@localhost:5433/$TEST_DB?schema=public"
start=$SECONDS
pnpm --filter @erp/api test > "$OUT/test-rerun.log" 2>&1
echo "test-rerun (API suites alone): exit $?, $((SECONDS - start)) s" | tee -a "$OUT/summary.txt"
docker exec erp-saas-db_test-1 psql -U erp -d postgres -qc "DROP DATABASE IF EXISTS $TEST_DB" >/dev/null
