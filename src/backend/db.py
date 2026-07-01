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
    (A1+A2: no owner, a nullable `report_id`, plus `note`). The DB is recreated
    fresh from it (no legacy tables to migrate), so no in-code migration is run.
    """
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn = get_connection()
    conn.executescript(schema_sql)
    conn.commit()
    conn.close()
