#!/bin/sh
# The audit stack of test-35: the built API and web, on their own ports and their own
# local database, so the dev stack (3000 / 3001, database `erp`) is left alone.
#
#   pnpm build            (once, with NEXT_PUBLIC_API_URL=http://localhost:3003)
#   e2e/map-stack.sh api  (port 3003, database erp_t35, connected as erp_app: RLS applies)
#   e2e/map-stack.sh web  (port 3005)
#
# Only environment variables differ from production; no code is changed. The rate limits
# are raised because the suites send thousands of requests from one address, and the access
# token lives 12 h so a suite does not have to log in again (the login limiter allows ten
# logins a minute per address).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DBNAME="${AUDIT_DB:-erp_t35}"
case "${1:-}" in
  api)
    cd "$ROOT/apps/api"
    DATABASE_URL="postgresql://erp_app:erp_app@localhost:5432/$DBNAME?schema=public" \
    DATABASE_URL_MIGRATE="postgresql://erp:erp@localhost:5432/$DBNAME?schema=public" \
    PORT="${API_PORT:-3003}" \
    WEB_ORIGIN="http://localhost:${WEB_PORT:-3005}" \
    LOG_LEVEL="${LOG_LEVEL:-info}" \
    RATE_LIMIT_PER_MINUTE=1000000 \
    RATE_LIMIT_AUTH_PER_MINUTE=100000 \
    ACCESS_TOKEN_TTL_SECONDS=43200 \
    COOKIE_SECURE=false \
    SENTRY_DSN="${SENTRY_DSN:-}" \
    PUBLIC_PATH_PREFIX="${PUBLIC_PATH_PREFIX:-}" \
    NODE_ENV=production \
    exec node dist/main.js
    ;;
  web)
    cd "$ROOT/apps/web"
    exec ./node_modules/.bin/next start --port "${WEB_PORT:-3005}"
    ;;
  *)
    echo "usage: $0 api|web" >&2
    exit 2
    ;;
esac
