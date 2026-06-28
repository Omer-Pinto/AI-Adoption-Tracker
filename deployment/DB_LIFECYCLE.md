# Database Lifecycle — Backup, Restore, Retention

The tracker's entire value is its accumulated history. It lives in **one SQLite
file**: `app/tracker.db`. While the server runs, two sidecar files exist:

- `app/tracker.db-wal` — the write-ahead log (newest, not-yet-checkpointed writes)
- `app/tracker.db-shm` — shared-memory index for the WAL

**This data must survive forever.** Treat the box as disposable; treat the
backups as precious and store copies **off the box**.

---

## Why not just `cp tracker.db`

With WAL journaling (the app enables `PRAGMA journal_mode=WAL`), the most recent
commits live in `tracker.db-wal`, not yet folded into `tracker.db`. A naive
`cp tracker.db`:
- can **miss** those recent writes, and
- can capture a **torn** (mid-write) page → a corrupt-looking copy.

You must capture a transactionally-consistent snapshot. Use one of:

1. **`sqlite3 ".backup"`** (what `backup_db.sh` does) — the online backup API.
   Produces one consistent, self-contained `.db` from main file + WAL, safely,
   while the server keeps running. Preferred.
2. If you ever copy by hand, **stop the server first** so WAL is checkpointed,
   then copy all three files together (`tracker.db`, `-wal`, `-shm`).

---

## Backup

`./scripts/backup_db.sh` does, on each run:
1. `sqlite3 app/tracker.db ".backup 'backups/tracker-<ts>.db'"` (hot, WAL-aware)
2. `PRAGMA integrity_check` on the snapshot (aborts if not `ok`)
3. gzip it → `backups/tracker-<ts>.db.gz`
4. prune to the newest `TRACKER_BACKUP_RETENTION` (default **30**) snapshots

Tunable via env:
- `TRACKER_DB` — source DB path (default `app/tracker.db`)
- `TRACKER_BACKUP_DIR` — destination (default `backups/`)
- `TRACKER_BACKUP_RETENTION` — how many to keep (default 30)

### Cadence (suggested)

Single-user, low write volume → **daily** is plenty; **hourly** if a lost day
would hurt. Cron for the service user:

```cron
# daily at 02:30
30 2 * * *  /opt/ai-tracker-airgap/scripts/backup_db.sh >> /opt/ai-tracker-airgap/logs/backup.log 2>&1
```

**Also copy `backups/` off the box** (USB, internal NAS, scp to another host).
A backup on the same disk as the DB protects against app bugs, not disk loss.

---

## Restore

```bash
./scripts/stop.sh                                   # MUST stop first
./scripts/restore_db.sh backups/tracker-<ts>.db.gz
./scripts/start.sh
```

`restore_db.sh`:
- refuses to run while the server is up (avoids corrupting an open WAL),
- `integrity_check`s the snapshot before using it,
- moves the current DB aside to `tracker.db.pre-restore-<ts>` (so a wrong
  restore is itself undoable),
- removes stale `-wal`/`-shm`, installs the snapshot.

---

## Quick reference

| Action | Command |
|---|---|
| Back up now | `./scripts/backup_db.sh` |
| List snapshots | `ls -1t backups/tracker-*.db.gz` |
| Restore | stop → `./scripts/restore_db.sh <snap>` → start |
| Where's the data | `app/tracker.db` (+ `-wal`/`-shm` while running) |

See `UPGRADING.md` for backing up specifically **before a version upgrade**.
