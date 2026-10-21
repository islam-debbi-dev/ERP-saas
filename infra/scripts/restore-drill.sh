#!/usr/bin/env bash
# Restore drill (monthly, docs/runbook.md): restores the latest WAL-G backup (plus the
# archived WAL up to now, or up to --target-time) into a throwaway Postgres, runs the
# sanity checks of restore-checks.sql, prints a report and removes everything. It
# never touches the live database, and the restored copy doesn't archive WAL.
#
#   infra/scripts/restore-drill.sh --env-file /srv/erp/prod.env [--network erp-prod_default]
#   infra/scripts/restore-drill.sh --env-file ... --target-time '2026-11-03 14:05:00+01'
#
# The env file needs the WALG_* / AWS_* variables of the backups (bucket, keys,
# libsodium key). Exit code 0 when the copy starts and its ledgers reconcile.
set -euo pipefail

ENV_FILE=""
TARGET_TIME=""
NETWORK=""
IMAGE="${DRILL_IMAGE:-erp-saas/postgres:local}"
DB_USER="${DRILL_DB_USER:-erp}"
DB_NAME="${DRILL_DB_NAME:-erp}"
REPORT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --target-time) TARGET_TIME="$2"; shift 2 ;;
    --network) NETWORK="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --report) REPORT="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
[ -n "$ENV_FILE" ] || { echo "--env-file is required" >&2; exit 64; }

HERE="$(cd "$(dirname "$0")" && pwd)"
ID="erp-drill-$(date +%s)"
VOLUME="$ID-data"
NET_ARGS=()
[ -n "$NETWORK" ] && NET_ARGS=(--network "$NETWORK")

# Keeps the script's exit code: a drill that failed must never report success.
cleanup() {
  local rc=$?
  docker rm -f "$ID" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  exit "$rc"
}
trap cleanup EXIT

started=$(date +%s)
echo "== restore drill $ID ($(date -Iseconds))"
docker volume create "$VOLUME" >/dev/null

echo "== fetching the latest base backup"
docker run --rm ${NET_ARGS[@]+"${NET_ARGS[@]}"} --env-file "$ENV_FILE" -e TARGET_TIME="$TARGET_TIME" \
  -v "$VOLUME:/var/lib/postgresql/data" --entrypoint bash "$IMAGE" -euo pipefail -c '
    D=/var/lib/postgresql/data
    wal-g backup-list | tail -n 1
    wal-g backup-fetch "$D" LATEST
    {
      echo "restore_command = '\''wal-g wal-fetch %f %p'\''"
      echo "recovery_target_action = '\''promote'\''"
      [ -n "$TARGET_TIME" ] && echo "recovery_target_time = '\''$TARGET_TIME'\''"
    } >> "$D/postgresql.auto.conf"
    touch "$D/recovery.signal"
    chown -R postgres:postgres "$D"
    chmod 700 "$D"'

echo "== replaying WAL${TARGET_TIME:+ up to $TARGET_TIME}"
docker run -d --name "$ID" ${NET_ARGS[@]+"${NET_ARGS[@]}"} --env-file "$ENV_FILE" \
  -v "$VOLUME:/var/lib/postgresql/data" "$IMAGE" \
  postgres -c archive_mode=off -c listen_addresses='' >/dev/null

for _ in $(seq 1 180); do
  state=$(docker exec "$ID" psql -U "$DB_USER" -d "$DB_NAME" -Atc 'SELECT pg_is_in_recovery()' 2>/dev/null || true)
  [ "$state" = "f" ] && break
  if [ "$(docker inspect -f '{{.State.Running}}' "$ID")" != "true" ]; then
    docker logs "$ID" | tail -n 30
    echo "== FAILED: the restored server stopped" >&2
    exit 1
  fi
  sleep 2
done
[ "$state" = "f" ] || { docker logs "$ID" | tail -n 30; echo "== FAILED: recovery did not finish" >&2; exit 1; }

echo "== sanity checks"
out=$(docker exec -i "$ID" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -At < "$HERE/restore-checks.sql")
echo "$out" | column -t -s '|'
mismatches=$(echo "$out" | awk -F'|' '$1 == "ledger_mismatches" { print $2 }')
duration=$(( $(date +%s) - started ))

result="OK"
[ "$mismatches" = "0" ] || result="FAILED (ledger mismatches: $mismatches)"
summary="restore drill $(date -Iseconds): $result in ${duration}s${TARGET_TIME:+, target $TARGET_TIME}"
echo "== $summary"
if [ -n "$REPORT" ]; then
  { echo "$summary"; echo "$out"; } > "$REPORT"
fi
[ "$result" = "OK" ]
