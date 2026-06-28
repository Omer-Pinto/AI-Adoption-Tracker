# RECOMMENDATIONS — source changes NOT made, and known production gaps

Per the working rules, the bundle works with the code **as-is** and I did **not**
edit any `src/` file. Below are changes I recommend Omer consider, with
rationale, plus an honest list of gaps for true production. None are applied.

---

## A. Recommended source changes (each optional; bundle works without them)

### A1. Make the DB path configurable (env override) — RECOMMENDED
**File:** `src/backend/db.py`
**Now:** `DB_PATH = BACKEND_DIR / "tracker.db"` (hard-coded inside the code dir).
**Why it matters:** in prod the DB lives *inside the release dir* (`app/tracker.db`).
For clean upgrades you want one canonical DB **outside** any release so swapping
versions doesn't move the data. Today UPGRADING.md works around this with a
symlink; an env override is cleaner and removes a footgun.
**Suggested change:**
```python
import os
DB_PATH = Path(os.environ.get("TRACKER_DB_PATH", BACKEND_DIR / "tracker.db"))
```
Then prod sets `TRACKER_DB_PATH=/opt/ai-tracker/data/tracker.db`. Fully backward
compatible (same default). If approved, `serve.py`/`start.sh`/the systemd unit
and the backup scripts should read the same var.

### A2. Serve the built frontend from FastAPI directly — OPTIONAL
**File:** `src/backend/app.py`
**Now:** app.py serves only `/api`; the bundle adds static serving via
`serve.py` (which imports `app` and mounts the SPA) — **no source change needed,
already works.** If Omer would rather have it first-class in the app:
```python
# at the END of app.py, after the routers:
import os
from fastapi.staticfiles import StaticFiles
_web = os.environ.get("TRACKER_WEB_DIR")
if _web:
    app.mount("/", StaticFiles(directory=_web, html=True), name="web")
```
Caveat: `StaticFiles(html=True)` does **not** do SPA deep-link fallback (a
refresh on `/teams/5` 404s). `serve.py` handles that fallback, so the bundle's
approach is actually more correct for an SPA. Recommendation: **keep serving via
`serve.py`**; only fold it into app.py if you want to drop the separate
entrypoint, and if so port the SPA-fallback logic too.

### A3. Add a "never delete in prod" guard / migrations folder — RECOMMENDED
**Files:** `src/backend/seed.py` (the DEV reset) and a new `migrations/` dir.
**Why:** `seed.py` deletes `tracker.db`. It's excluded from the bundle, but the
habit is dangerous. Two improvements:
- Make `seed.py` refuse to run unless an explicit `SEED_RESET=1` **and** a
  `TRACKER_ALLOW_DESTRUCTIVE=1` are set, so it can never wipe a prod DB by
  accident.
- Introduce a real **migrations framework** (a `migrations/NNNN_*.sql` folder
  applied in order, tracked in a `schema_migrations` table). Today schema
  evolution relies on `CREATE TABLE IF NOT EXISTS` in `schema.sql`, which
  silently does **nothing** for *altered* tables (new columns on existing
  tables are NOT added). That's fine for additive new tables but will miss
  column additions on upgrade. A migrations folder makes cross-version upgrades
  deterministic (see UPGRADING.md). Until then, document additive `ALTER`s
  per release.

### A4. Bind/host & CORS for prod — MINOR
**File:** `src/backend/app.py`
`ALLOWED_ORIGINS` is the Vite dev origins only. In the bundle the UI and API are
**same-origin**, so CORS never triggers — no change needed. Only if you later
split origins would you add the prod origin here.

---

## B. Known gaps for true production (honest picture)

1. **No authentication / authorization.** Anyone who can reach `:8080` has full
   read/write. Mitigate with network controls (bind `127.0.0.1` + SSH tunnel, or
   firewall to a trusted subnet, or front with an authenticating reverse proxy).
   The bundle does not add auth.
2. **SQLite single-writer concurrency.** Fine for one champion/AI-lead using it.
   WAL allows concurrent reads + one writer, but it is not built for many
   simultaneous writers. For multi-user concurrent writing you'd move to a
   client/server DB — out of scope here.
3. **No HTTPS.** Plain HTTP on the LAN. If you need TLS, terminate it at a
   reverse proxy (nginx/caddy) in front — but that adds a component to the
   air-gap box.
4. **vLLM structured-output compatibility is unverified.** The OpenAI path uses
   strict `response_format=<pydantic>` (json_schema) and the Anthropic path uses
   forced tool use. Whether your specific local model/server honors these is
   model-dependent — verify with a real draft after wiring (an ai-engineer is
   slated to audit the SDK↔vLLM wiring). Failure mode is a clean HTTP 502, not a
   crash.
5. **Wheelhouse is platform-locked.** Built for one OS/arch/python (default
   linux x86_64 / cp311). Wrong target ⇒ `install.sh` fails loudly. Rebuild with
   `TARGET_PLATFORM`/`TARGET_PYVER` or on a matching machine.
6. **No automated migration tooling yet** (see A3) — cross-version schema
   changes are a documented manual procedure, not automated.
7. **Backups are local by default.** `backup_db.sh` writes to `backups/` on the
   same box; you must copy them off-box for disaster resilience (DB_LIFECYCLE.md
   says so, but it isn't automated here).
8. **No log rotation.** `logs/ai-tracker.log` grows unbounded under start.sh.
   Under systemd, journald handles it; for start.sh add `logrotate` if needed.
9. **`pip` assumed present on the box.** `install.sh` uses the interpreter's
   bundled `ensurepip`/`pip`; if the target python has neither, vendor `pip`,
   `setuptools`, `wheel` into `wheels/` and bootstrap. Most distro pythons have
   pip.
