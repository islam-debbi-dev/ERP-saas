#!/usr/bin/env bash
# Puts the previous image tag (or the one given) back, without touching the database:
# migrations are expand-only, so the older api runs against the newer schema.
#
#   /srv/erp/deploy/scripts/rollback.sh production          # to the previous tag
#   /srv/erp/deploy/scripts/rollback.sh production 3f2c1ab  # to a given tag
set -euo pipefail
ENV_NAME="${1:?usage: rollback.sh <staging|production> [tag]}"
ROOT="${ERP_ROOT:-/srv/erp}"
ENV_FILE="$ROOT/$ENV_NAME.env"
TAG="${2:-$(cat "$ROOT/$ENV_NAME.previous-tag" 2>/dev/null || true)}"
[ -n "$TAG" ] || { echo "no previous tag recorded; pass one" >&2; exit 1; }

PROJECT="erp-$ENV_NAME"
# STACK_NAME names the network aliases Caddy routes to (erp-<env>-api, erp-<env>-web).
export APP_TAG="$TAG" ENV_FILE STACK_NAME="$PROJECT"
compose=(docker compose -p "$PROJECT" -f "$ROOT/deploy/compose.yml" --env-file "$ENV_FILE")
profiles=()
grep -qE '^LOGTAIL_TOKEN=.+' "$ENV_FILE" && profiles=(--profile logs)

current="$(cat "$ROOT/$ENV_NAME.current-tag" 2>/dev/null || true)"
echo "== $PROJECT: rolling back ${current:-?} → $TAG"
[ "${SKIP_PULL:-}" = "1" ] || "${compose[@]}" pull api web
"${compose[@]}" ${profiles[@]+"${profiles[@]}"} up -d --wait --no-deps api web
echo "$TAG" > "$ROOT/$ENV_NAME.current-tag"
[ -n "$current" ] && echo "$current" > "$ROOT/$ENV_NAME.previous-tag"
echo "== $PROJECT: $TAG is live"
