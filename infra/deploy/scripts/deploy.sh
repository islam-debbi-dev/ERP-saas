#!/usr/bin/env bash
# Deploys one image tag to one environment on the VPS:
#   pull → database up → migrate (as the owner) → api + web up → wait healthy.
# Migrations are backward compatible (CI checks it), so the old api keeps working
# while they run and a rollback never needs a down-migration.
#
#   /srv/erp/deploy/scripts/deploy.sh staging 3f2c1ab
set -euo pipefail
ENV_NAME="${1:?usage: deploy.sh <staging|production> <tag>}"
TAG="${2:?usage: deploy.sh <staging|production> <tag>}"
ROOT="${ERP_ROOT:-/srv/erp}"
ENV_FILE="$ROOT/$ENV_NAME.env"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }

PROJECT="erp-$ENV_NAME"
# STACK_NAME names the network aliases Caddy routes to (erp-<env>-api, erp-<env>-web).
export APP_TAG="$TAG" ENV_FILE STACK_NAME="$PROJECT"
compose=(docker compose -p "$PROJECT" -f "$ROOT/deploy/compose.yml" --env-file "$ENV_FILE")
profiles=()
grep -qE '^LOGTAIL_TOKEN=.+' "$ENV_FILE" && profiles=(--profile logs)

docker network create erp-edge >/dev/null 2>&1 || true
current="$(cat "$ROOT/$ENV_NAME.current-tag" 2>/dev/null || true)"

echo "== $PROJECT: deploying $TAG (current: ${current:-none})"
# SKIP_PULL=1: images built on this machine (local rehearsal of a deploy).
[ "${SKIP_PULL:-}" = "1" ] || "${compose[@]}" pull api web migrate
"${compose[@]}" up -d --wait db
"${compose[@]}" --profile migrate run --rm migrate
"${compose[@]}" ${profiles[@]+"${profiles[@]}"} up -d --wait --remove-orphans

[ -n "$current" ] && [ "$current" != "$TAG" ] && echo "$current" > "$ROOT/$ENV_NAME.previous-tag"
echo "$TAG" > "$ROOT/$ENV_NAME.current-tag"
echo "== $PROJECT: $TAG is live"
