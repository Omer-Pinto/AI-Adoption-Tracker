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

    `schema.sql` is the single source of truth for the shape of `action_item`
    (A1+A2: no owner, a nullable `report_id`, plus `note`). Because schema.sql is
    written with `CREATE TABLE IF NOT EXISTS`, it creates the new shape on a fresh
    DB but does NOT alter an already-existing table — so an in-place A1+A2
    migration is applied for pre-A1+A2 databases (see `_migrate_action_item`).
    """
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn = get_connection()
    conn.executescript(schema_sql)
    _migrate_action_item(conn)
    conn.commit()
    conn.close()


def _migrate_action_item(conn: sqlite3.Connection) -> None:
    """A1+A2 in-place migration for a pre-A1+A2 `action_item` table.

    Idempotent and data-preserving: on a fresh DB (schema.sql already made the
    new shape) both branches are no-ops; on an existing pre-A1+A2 DB it drops the
    `owner` column (every action item is now the AI Lead's — DECIDED: just drop
    owner, no conversion to tasks) and adds the nullable `note` column. All other
    rows/tables are untouched.
    """
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(action_item)")}
    if "owner" in cols:
        conn.execute("ALTER TABLE action_item DROP COLUMN owner")
    if "note" not in cols:
        conn.execute("ALTER TABLE action_item ADD COLUMN note TEXT")
