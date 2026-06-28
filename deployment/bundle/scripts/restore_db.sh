#!/usr/bin/env bash
# Restore the SQLite database from a snapshot produced by backup_db.sh.
#
# Usage:  ./scripts/restore_db.sh  backups/tracker-YYYYMMDD-HHMMSS.db.gz
#
# This OVERWRITES the live database. It refuses to run while the server is up
# (to avoid corrupting an open WAL). Stop the server first (./scripts/stop.sh).
# The current DB is moved aside to tracker.db.pre-restore-<ts> first, so a bad
# restore is itself reversible.
set -euo pipefail

BUNDLE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${TRACKER_DB:-$BUNDLE_ROOT/app/tracker.db}"
PIDFILE="$BUNDLE_ROOT/run/ai-tracker.pid"
SQLITE_BIN="${SQLITE_BIN:-sqlite3}"

SNAP="${1:-}"
if [[ -z "$SNAP" || ! -f "$SNAP" ]]; then
  echo "Usage: $0 <snapshot.db.gz|snapshot.db>" >&2
  echo "Available snapshots:" >&2
  ls -1t "$BUNDLE_ROOT/backups"/tracker-*.db.gz 2>/dev/null || echo "  (none)" >&2
  exit 1
fi

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "ERROR: server is running (pid $(cat "$PIDFILE")). Run ./scripts/stop.sh first." >&2
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Decompress if needed.
case "$SNAP" in
  *.gz) gzip -dc "$SNAP" > "$TMP/restore.db" ;;
  *)    cp "$SNAP" "$TMP/restore.db" ;;
esac

# Validate before touching the live file.
RES="$("$SQLITE_BIN" "$TMP/restore.db" 'PRAGMA integrity_check;')"
if [[ "$RES" != "ok" ]]; then
  echo "ERROR: snapshot failed integrity_check: $RES" >&2
  exit 1
fi

# Move current DB (and any WAL/SHM sidecars) aside, then install the snapshot.
if [[ -f "$DB" ]]; then
  mv "$DB" "$DB.pre-restore-$TS"
  echo "==> Current DB saved as $DB.pre-restore-$TS"
fi
rm -f "$DB-wal" "$DB-shm"
cp "$TMP/restore.db" "$DB"

echo "Restore complete from: $SNAP"
echo "Start the server: ./scripts/start.sh"
