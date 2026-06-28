# Upgrading to a New Version Without Losing Data

The golden rule: **the production database file persists across upgrades.** A
new product version is a new bundle; you point it at the *same* data and verify
on a staging port before switching real traffic to it.

> **DEV-ONLY habit that must NEVER happen in prod:** during development the app
> is reset with `seed.py`, which *deletes* `tracker.db` and recreates it from
> `schema.sql`. **`seed.py` is excluded from this bundle on purpose.** In prod
> the DB file is never deleted. Startup only runs `schema.sql`, which is written
> with `CREATE TABLE IF NOT EXISTS` — i.e. it is **non-destructive**: it creates
> missing tables and leaves existing tables (and their rows) untouched.

---

## Layout convention (keep the old version runnable for rollback)

Install each version in its own directory and use a `current` symlink:

```
/opt/ai-tracker/
  releases/
    0.1.0/        <- old bundle (app/, web/, .venv, ...)
    0.2.0/        <- new bundle
  current -> releases/0.1.0
  data/
    tracker.db    <- the ONE database, outside any release dir
```

Because `db.py` currently hard-codes the DB at `app/tracker.db` *inside* the
release, you keep one canonical DB by **symlinking** it into each release:

```bash
ln -sfn /opt/ai-tracker/data/tracker.db  releases/0.2.0/app/tracker.db
```

(Or move the whole `app/` data out via a configurable path — see
`RECOMMENDATIONS.md`, "DB path should be configurable". Until that lands, the
symlink approach is the reliable way to share one DB across releases.)

---

## Upgrade flow (both schema-unchanged and schema-changed)

### Step 1 — Back up first, always

```bash
cd /opt/ai-tracker/current
./scripts/backup_db.sh        # snapshot incl. WAL -> backups/
cp backups/tracker-*.db.gz /off-box/safe/place/   # copy off the box too
```

### Step 2 — Install the new version side by side

```bash
unzip ai-tracker-airgap-0.2.0.zip -d /opt/ai-tracker/releases/
mv /opt/ai-tracker/releases/ai-tracker-airgap /opt/ai-tracker/releases/0.2.0
cd /opt/ai-tracker/releases/0.2.0
./scripts/install.sh
```

### Step 3 — Point the new version at a COPY of the data, run on a staging port

Never validate a new version against the live DB. Use a copy:

```bash
mkdir -p /opt/ai-tracker/releases/0.2.0/app
gzip -dc /opt/ai-tracker/current/backups/tracker-<latest>.db.gz \
    > /opt/ai-tracker/releases/0.2.0/app/tracker.db

cp env.example env   # reuse your real env values, but:
#   set PORT=8100   (staging UI+API port)
./scripts/start.sh
```

Open `http://<box-ip>:8100` and verify your real data loads and the app works.

### Step 4 — Handle the schema

- **Schema UNCHANGED** (most patch/minor releases): nothing to do. Startup runs
  `schema.sql`; `IF NOT EXISTS` makes it a no-op against existing tables.

- **Schema CHANGED** (new tables/columns/indexes): there is currently **no
  migrations framework** in the product (see RECOMMENDATIONS.md — "Add a
  migrations folder"). Until one exists, apply additive changes by hand on the
  STAGING copy and confirm before going live:
  ```bash
  ./scripts/stop.sh
  sqlite3 app/tracker.db < migrations/0.2.0.sql   # additive only: ADD COLUMN,
                                                   # CREATE TABLE, CREATE INDEX
  ./scripts/start.sh    # re-verify on :8100
  ```
  Rules for safe additive migrations:
  - `ALTER TABLE ... ADD COLUMN` (with a default / nullable) — safe.
  - `CREATE TABLE` / `CREATE INDEX IF NOT EXISTS` — safe.
  - **Avoid** dropping/renaming columns or `DELETE`/destructive rewrites in a
    live upgrade. SQLite has limited `ALTER`; a column rename/type change needs
    the create-new-table → copy → drop-old dance — do that only with a fresh
    backup and on staging first.
  - Keep each version's migration as a checked-in `.sql` so it's repeatable.

### Step 5 — Switch live traffic

Once staging is verified:

```bash
cd /opt/ai-tracker/releases/0.2.0
./scripts/stop.sh                         # stop the staging instance

# stop the old prod, repoint the canonical DB, start new prod on the real port
/opt/ai-tracker/current/scripts/stop.sh
ln -sfn /opt/ai-tracker/data/tracker.db app/tracker.db   # the REAL data
# (if schema changed, apply migrations/0.2.0.sql to the REAL DB now, after a
#  fresh backup_db.sh)
# set PORT back to 8080 in env
ln -sfn /opt/ai-tracker/releases/0.2.0 /opt/ai-tracker/current
./scripts/start.sh
```

(With systemd: update `WorkingDirectory`/paths in the unit, or keep the unit
pointing at the `current` symlink so only the symlink swap is needed, then
`systemctl restart ai-tracker`.)

### Step 6 — Rollback (if the new version misbehaves)

The old release is untouched and the pre-upgrade backup exists:

```bash
/opt/ai-tracker/releases/0.2.0/scripts/stop.sh
ln -sfn /opt/ai-tracker/releases/0.1.0 /opt/ai-tracker/current
cd /opt/ai-tracker/current
# if a schema migration had already been applied to the REAL DB, restore the
# pre-upgrade snapshot so the old code sees the schema it expects:
./scripts/restore_db.sh backups/tracker-<pre-upgrade>.db.gz
./scripts/start.sh
```

> Keep the previous release dir AND the pre-upgrade backup until the new version
> has run clean for a few days.

---

## Checklist

- [ ] `backup_db.sh` run and copied off-box
- [ ] new bundle installed side-by-side (old one still intact)
- [ ] new version verified on `:8100` against a COPY of real data
- [ ] schema change? additive migration written, tested on staging copy
- [ ] switched `current` symlink + repointed canonical DB + real port
- [ ] old release + pre-upgrade backup retained for rollback
