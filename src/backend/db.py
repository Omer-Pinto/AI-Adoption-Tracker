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
    """Apply schema.sql to the database. Idempotent — safe to run on every startup."""
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn = get_connection()
    conn.executescript(schema_sql)
    conn.commit()
    _migrate_action_item_report_id_nullable(conn)
    conn.close()


def _migrate_action_item_report_id_nullable(conn: sqlite3.Connection) -> None:
    """Additive Wave-15 migration: make `action_item.report_id` nullable.

    `init_db()` applies schema.sql with `CREATE TABLE IF NOT EXISTS`, so editing
    the schema does NOT alter an `action_item` table that already exists. A live
    `tracker.db` created before Wave 15 still has `report_id INTEGER NOT NULL`;
    this is the additive, NON-DESTRUCTIVE migration the deployment `UPGRADING.md`
    describes. It detects the stale NOT NULL flag and, if present, rebuilds the
    table in place preserving ALL existing rows (nothing FKs to action_item, so
    the rename is safe; NULL FKs are exempt from enforcement, so foreign_keys can
    stay ON). Never drops rows.
    """
    cols = conn.execute("PRAGMA table_info(action_item)").fetchall()
    report_id_col = next((c for c in cols if c["name"] == "report_id"), None)
    # `notnull` == 1 means the stale pre-Wave-15 NOT NULL constraint is still set.
    if report_id_col is None or report_id_col["notnull"] == 0:
        return

    conn.executescript(
        """
        BEGIN;
        CREATE TABLE action_item_new (
            id        INTEGER PRIMARY KEY,
            report_id INTEGER REFERENCES report(id),    -- nullable: standalone AI-Lead item = NULL
            domain_id INTEGER REFERENCES domain(id),    -- nullable
            text      TEXT NOT NULL,
            owner     TEXT,
            due_date  TEXT,
            status    TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                'planned', 'in-progress', 'finished_successfully',
                'finished_with_issues', 'blocked', 'abandoned', 'wont_fix'
            ))
        );
        INSERT INTO action_item_new (id, report_id, domain_id, text, owner, due_date, status)
            SELECT id, report_id, domain_id, text, owner, due_date, status FROM action_item;
        DROP TABLE action_item;
        ALTER TABLE action_item_new RENAME TO action_item;
        COMMIT;
        """
    )
