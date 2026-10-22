#!/bin/sh
# archive_command: ships one WAL segment to the bucket. Postgres keeps the segment
# and retries while this fails, so a bucket outage never loses WAL (watch the disk).
# With no bucket configured (local runs) archiving is off: the segment is dropped.
set -eu
if [ -z "${WALG_S3_PREFIX:-}" ]; then
  exit 0
fi
exec wal-g wal-push "$1"
