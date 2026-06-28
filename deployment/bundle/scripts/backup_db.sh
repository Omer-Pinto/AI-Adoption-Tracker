#!/usr/bin/env bash
# Safe, hot backup of the live SQLite database — INCLUDING uncommitted WAL.
#
# Why not `cp`? With WAL journaling the newest writes live in tracker.db-wal and
# are not yet folded into tracker.db. A naive `cp tracker.db` can miss them and
# can copy a torn page mid-write. The SQLite ".backup" command uses the online
# backup API: it takes a consistent snapshot of the FULL database (main file +
# WAL) into a single self-contained file, safely, while the server is running.
#
# Output: one timestamped, gzip'd snapshot per run, plus retention pruning.
# Schedule from cron (see DB_LIFECYCLE.md). Data accumulates forever — keep
# these backups off-box too.
set -euo pipefail

BUNDLE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${TRACKER_DB:-$BUNDLE_ROOT/app/tracker.db}"
BACKUP_DIR="${TRACKER_BACKUP_DIR:-$BUNDLE_ROOT/backups}"
RETENTION="${TRACKER_BACKUP_RETENTION:-30}"   # keep this many newest snapshots

SQLITE_BIN="${SQLITE_BIN:-sqlite3}"
if ! command -v "$SQLITE_BIN" >/dev/null 2>&1; then
  echo "ERROR: '$SQLITE_BIN' not found. Install the sqlite3 CLI on the box." >&2
  exit 1
fi
if [[ ! -f "$DB" ]]; then
  echo "ERROR: database not found at $DB" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
SNAP="$BACKUP_DIR/tracker-$TS.db"

echo "==> Snapshotting $DB"
# .backup is atomic & WAL-aware. Quote the target for paths with spaces.
"$SQLITE_BIN" "$DB" ".backup '$SNAP'"

# Integrity-check the snapshot before we trust it.
RES="$("$SQLITE_BIN" "$SNAP" 'PRAGMA integrity_check;')"
if [[ "$RES" != "ok" ]]; then
  echo "ERROR: integrity check FAILED on snapshot: $RES" >&2
  rm -f "$SNAP"
  exit 1
fi

gzip -f "$SNAP"
echo "    wrote $SNAP.gz ($(du -h "$SNAP.gz" | cut -f1))"

# Retention: keep the newest $RETENTION, delete older.
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/tracker-*.db.gz 2>/dev/null | tail -n +"$((RETENTION + 1))")
if (( ${#OLD[@]} > 0 )); then
  echo "==> Pruning ${#OLD[@]} old snapshot(s) (retention=$RETENTION)"
  rm -f "${OLD[@]}"
fi

echo "Backup complete."
