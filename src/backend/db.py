"""SQLite connection helper.

Single local database file (offline / air-gapped). On startup we apply
`schema.sql` once — it is written with `CREATE TABLE IF NOT EXISTS`, so it is
idempotent. Every connection enables WAL journaling and foreign-key enforcement
(SQLite defaults foreign keys OFF per-connection, so it must be set each time).
"""

import sqlite3
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
DB_PATH = BACKEND_DIR / "tracker.db"
SCHEMA_PATH = BACKEND_DIR / "schema.sql"


def get_connection() -> sqlite3.Connection:
    """Open a connection with WAL + foreign keys enabled and row access by name."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    """Apply schema.sql to the database. Idempotent — safe to run on every startup.

    `schema.sql` (`CREATE TABLE IF NOT EXISTS`) is the single source of truth for
    the shape of every table, including `action_item` (A1+A2: no owner, nullable
    `report_id`, plus `note`). Pre-MVP: there is NO legacy DB to migrate — a fresh
    or deleted DB is (re)created straight from schema.sql with the current shape.
    """
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn = get_connection()
    conn.executescript(schema_sql)
    conn.commit()
    seed_base_users(conn)
    conn.close()


# ── auth provisioning (Wave 17 — RBAC) ────────────────────────────────────────
# The base login users and the per-team champion-user provisioning. `auth` is
# imported lazily inside these helpers to avoid a module-level import cycle
# (auth.py imports get_connection from this module).

def seed_base_users(conn: sqlite3.Connection) -> None:
    """Ensure the two base login users exist. Idempotent (skips existing rows).

    Seeds ``admin``/``admin`` (is_admin=1, the untouchable admin) and
    ``manager``/``manager_manager_123`` (read_all=1, a read-only all-teams user).
    """
    from auth import default_password, hash_password

    base_users = (
        ("admin", "admin", 1, 0),
        ("manager", default_password("manager"), 0, 1),
    )
    for username, password, is_admin, read_all in base_users:
        if conn.execute(
            "SELECT id FROM user WHERE username = ?", (username,)
        ).fetchone() is not None:
            continue
        conn.execute(
            "INSERT INTO user (username, password_hash, is_admin, read_all, is_active) "
            "VALUES (?, ?, ?, ?, 1)",
            (username, hash_password(password), is_admin, read_all),
        )
    conn.commit()


def provision_team_user(conn: sqlite3.Connection, team) -> None:
    """Create a read-only login for a team's champion, scoped to that one team.

    Username = the champion name lowercased with spaces stripped ("Noa" → "noa");
    default password = ``<username>_<username>_123``; read-scope = this team only
    (a ``user_team`` row, read_all=0). A username collision with a DIFFERENT
    team's champion appends ``-<team_id>``. Idempotent: if this team's champion
    user already exists (base or suffixed name), it is a no-op.

    Forward-only — the later wave calls this on team-create. ``team`` is a mapping
    with at least ``id`` and ``champion_name`` (e.g. a sqlite Row).
    """
    from auth import default_password, hash_password

    team_id = team["id"]
    base = team["champion_name"].lower().replace(" ", "")
    username = base

    existing = conn.execute(
        "SELECT id FROM user WHERE username = ?", (base,)
    ).fetchone()
    if existing is not None:
        already_scoped = conn.execute(
            "SELECT 1 FROM user_team WHERE user_id = ? AND team_id = ?",
            (existing["id"], team_id),
        ).fetchone()
        if already_scoped is not None:
            return  # this team's champion already provisioned — no-op
        # Collision with a different champion of the same name → suffix by team.
        username = f"{base}-{team_id}"
        if conn.execute(
            "SELECT id FROM user WHERE username = ?", (username,)
        ).fetchone() is not None:
            return  # already provisioned under the suffixed name

    cur = conn.execute(
        "INSERT INTO user (username, password_hash, is_admin, read_all, is_active) "
        "VALUES (?, ?, 0, 0, 1)",
        (username, hash_password(default_password(username))),
    )
    conn.execute(
        "INSERT INTO user_team (user_id, team_id) VALUES (?, ?)",
        (cur.lastrowid, team_id),
    )
    conn.commit()
