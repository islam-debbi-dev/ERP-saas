#!/bin/sh
# The backup sidecar: a full base backup every day at BACKUP_AT (Algiers time), then
# deletes what is older than BACKUP_RETAIN_FULL daily backups (WAL included). With the
# continuous WAL archive in between, any moment of the last 30 days can be restored.
# On failure, posts to ALERT_WEBHOOK_URL (e.g. a Better Stack / Slack / ntfy webhook).
set -u
: "${PGDATA:=/var/lib/postgresql/data}"
: "${BACKUP_AT:=02:00}"
: "${BACKUP_RETAIN_FULL:=30}"
export TZ="${TZ:-Africa/Algiers}"

alert() {
  echo "backup: FAILED: $1" >&2
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS --max-time 20 -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"[${APP_ENV:-erp}] Postgres backup failed: $1\"}" \
      "$ALERT_WEBHOOK_URL" >/dev/null || echo "backup: alert webhook failed" >&2
  fi
}

backup_once() {
  echo "backup: starting base backup $(date -Iseconds)"
  if ! wal-g backup-push "$PGDATA"; then alert "backup-push"; return 1; fi
  if ! wal-g delete retain FULL "$BACKUP_RETAIN_FULL" --confirm; then alert "retention"; return 1; fi
  echo "backup: done $(date -Iseconds)"
  wal-g backup-list 2>/dev/null | tail -n 3
}

if [ -z "${WALG_S3_PREFIX:-}" ]; then
  echo "backup: WALG_S3_PREFIX is not set, backups are disabled" >&2
  exec sleep infinity
fi

if [ "${1:-}" = "--now" ]; then
  backup_once
  exit $?
fi

# First start: take a backup right away if the bucket has none yet.
if ! wal-g backup-list 2>/dev/null | grep -q base_; then backup_once || true; fi

while true; do
  now=$(date +%s)
  next=$(date -d "today ${BACKUP_AT}" +%s)
  [ "$next" -le "$now" ] && next=$(date -d "tomorrow ${BACKUP_AT}" +%s)
  echo "backup: next run $(date -d "@$next" -Iseconds)"
  sleep $((next - now))
  backup_once || true
done
