#!/usr/bin/env bash
# Audit 02, part B (security): every suite, in order, on the audit database.
#
# Before (see part-a.sh for the database and the build), start the API with a stub model
# behind the assistant, so no real provider key is used:
#
#   AUDIT_DB=erp_audit02 AI_PROVIDER=OPENAI_COMPATIBLE AI_MODEL=audit-stub \
#   AI_BASE_URL=http://127.0.0.1:3999/v1 AI_API_KEY=sk-AUDIT02-CANARY-KEY-do-not-leak \
#     e2e/map-stack.sh api > e2e/artifacts/audit-02/api-b.log 2>&1 &
#   e2e/map-stack.sh web &
#
# Then:  bash e2e/audit-02/part-b.sh
#
# The last suite (files) ends with a zip bomb that kills the API (finding B-1): start it
# again before running anything else. Outputs: e2e/artifacts/audit-02/*.md|json|log
set -u
cd "$(dirname "$0")/.."
. audit-02/b-env.sh
export API_LOG="${API_LOG:-$PWD/artifacts/audit-02/api-b.log}"
OUT=artifacts/audit-02
TSX=./node_modules/.bin/tsx

step() { # name, command...
  local name=$1; shift
  local start=$SECONDS
  "$@" > "$OUT/$name.log" 2>&1
  echo "$name: exit $?, $((SECONDS - start)) s — $(grep -E '^[a-z-]+: [0-9]+ checks' "$OUT/$name.log" | tail -1)"
}

step record      $TSX api/security/record.ts        # two worlds of valid requests (tokens: .auth/)
step isolation   $TSX api/security/isolation.ts     # B1
step permissions $TSX api/security/permissions.ts   # B2, matrix and figures
step scopes      $TSX api/security/scopes.ts        # B2, seller / dépôt / pay / exports
step auth        $TSX api/security/auth.ts          # B3
step input       $TSX api/security/input.ts         # B4
step assistant   $TSX api/security/assistant.ts     # B6 (stub model on :3999)
step secrets     $TSX api/security/secrets.ts       # B7 (its own API on :3013, Sentry sink on :3098)
( cd .. && bash e2e/audit-02/secrets-scan.sh ) > /dev/null
echo "secrets-scan: $(grep -c . $OUT/secrets-scan.txt) lines in $OUT/secrets-scan.txt"
( cd .. && pnpm audit --prod --json > e2e/$OUT/pnpm-audit-prod.json 2>/dev/null )
echo "pnpm audit --prod: $(node -e 'console.log(JSON.stringify(require("./'$OUT'/pnpm-audit-prod.json").metadata.vulnerabilities))')"
# Hostile input must not leave one wrong number: the invariants of part A, again.
AUDIT_RUN=audit-02/after-b $TSX sql/run-invariants.ts > "$OUT/invariants-after-b.log" 2>&1
echo "invariants after B: exit $? — $(grep -E '^[a-z-]+: [0-9]+ checks' "$OUT/invariants-after-b.log" | tail -1)"
( cd ../apps/api && DATABASE_URL="$DB" DATABASE_URL_MIGRATE="$DB" node dist/reconcile/reconcile.cli.js ) > "$OUT/reconcile-after-b.log" 2>&1
echo "reconcile after B: exit $? — $(tail -1 "$OUT/reconcile-after-b.log")"
step files       $TSX api/security/files.ts         # B5; last, it takes the API down
