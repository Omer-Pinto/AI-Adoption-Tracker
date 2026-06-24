-- AI Adoption Tracker — SQLite schema (spec §5).
--
-- Two kinds of tables: "what it is now" (team, champion, domain, task,
-- artifact, action_item) and "history" (report, task_history,
-- artifact_history). Both are written when a report is saved. Current-state
-- rows are kept directly (never rebuilt by replay), so reads are trivial.
--
-- Connection-level pragmas (WAL journaling + foreign-key enforcement) are set
-- per connection in db.py, NOT here — `journal_mode = WAL` is a persistent
-- per-database setting but `foreign_keys` is per-connection and off by default.
--
-- Conventions:
--   * ids: INTEGER PRIMARY KEY (SQLite rowid alias).
--   * dates: stored as ISO-8601 TEXT ("YYYY-MM-DD").
--   * booleans: INTEGER 0/1 (SQLite has no native bool).
--   * report_json / tags: TEXT holding JSON.
-- No extra indexes (spec: "no extra indexes").

-- ── team ──────────────────────────────────────────────────────────────────
-- A group. Holds the one-time Claude Code maturity starting-point snapshot.
CREATE TABLE IF NOT EXISTS team (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    cc_baseline   TEXT,          -- raw starting-point description (free text)
    baseline_date TEXT           -- ISO-8601 date the baseline was captured
);

-- ── champion ──────────────────────────────────────────────────────────────
-- Point person for a team's adoption. May start and later leave.
CREATE TABLE IF NOT EXISTS champion (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    team_id    INTEGER NOT NULL REFERENCES team(id),
    start_date TEXT,
    end_date   TEXT               -- nullable: null = still active
);

-- ── domain ──────────────────────────────────────────────────────────────────
-- An area of work for a team; tasks and artifacts attach here.
CREATE TABLE IF NOT EXISTS domain (
    id           INTEGER PRIMARY KEY,
    team_id      INTEGER NOT NULL REFERENCES team(id),
    champion_id  INTEGER NOT NULL REFERENCES champion(id),
    name         TEXT NOT NULL,
    description  TEXT,
    priority     TEXT              -- priority vs other domains (free text)
);

-- ── domain_link (symmetric cross-domain relation, may span teams) ─────────────
-- A undirected link between two domains. Stored once per unordered pair
-- (a < b); a domain's cross-domains = every row mentioning it, in either slot.
CREATE TABLE IF NOT EXISTS domain_link (
    domain_a INTEGER NOT NULL REFERENCES domain(id) ON DELETE CASCADE,
    domain_b INTEGER NOT NULL REFERENCES domain(id) ON DELETE CASCADE,
    PRIMARY KEY (domain_a, domain_b),
    CHECK (domain_a < domain_b)
);

-- ── report ──────────────────────────────────────────────────────────────────
-- One record per champion meeting (covers all that champion's domains). No
-- domain_id (per-champion). Full report_json (incl. raw_notes) kept as audit +
-- backfill safety net in addition to the fanned-out rows.
CREATE TABLE IF NOT EXISTS report (
    id             INTEGER PRIMARY KEY,
    champion_id    INTEGER NOT NULL REFERENCES champion(id),
    meeting_date   TEXT NOT NULL,
    report_json    TEXT NOT NULL,   -- the full structured report (JSON text)
    schema_version INTEGER NOT NULL,
    UNIQUE(champion_id, meeting_date)
);

-- ── task (current state) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task (
    id         INTEGER PRIMARY KEY,
    domain_id  INTEGER NOT NULL REFERENCES domain(id),
    name       TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN (
        'planned', 'in-progress', 'finished_successfully',
        'finished_with_issues', 'blocked', 'abandoned'
    )),
    owner      TEXT,
    started_on TEXT,
    ended_on   TEXT
);

-- ── task_history (the weekly journey) ─────────────────────────────────────────
-- One row per task per meeting it is discussed. No domain_id (reached via task).
CREATE TABLE IF NOT EXISTS task_history (
    id                INTEGER PRIMARY KEY,
    task_id           INTEGER NOT NULL REFERENCES task(id),
    report_id         INTEGER NOT NULL REFERENCES report(id),
    meeting_date      TEXT NOT NULL,
    status_at_meeting TEXT NOT NULL CHECK (status_at_meeting IN (
        'planned', 'in-progress', 'finished_successfully',
        'finished_with_issues', 'blocked', 'abandoned'
    )),
    change_note       TEXT
);

-- ── artifact (current state) ──────────────────────────────────────────────────
-- Belongs to a team; optionally to a domain (domain_id null = team-wide).
CREATE TABLE IF NOT EXISTS artifact (
    id        INTEGER PRIMARY KEY,
    team_id   INTEGER NOT NULL REFERENCES team(id),
    domain_id INTEGER REFERENCES domain(id),    -- nullable: null = team-wide
    name      TEXT NOT NULL,
    type      TEXT NOT NULL CHECK (type IN ('agent', 'skill', 'hook', 'context')),
    tags      TEXT,                              -- JSON array of tag strings
    summary   TEXT                               -- short human description
);

-- ── artifact_history (one row only when it changes) ───────────────────────────
-- No domain_id (reached via artifact).
CREATE TABLE IF NOT EXISTS artifact_history (
    id           INTEGER PRIMARY KEY,
    artifact_id  INTEGER NOT NULL REFERENCES artifact(id),
    report_id    INTEGER NOT NULL REFERENCES report(id),
    meeting_date TEXT NOT NULL,
    change_kind  TEXT NOT NULL CHECK (change_kind IN (
        'added', 'updated', 'retired', 'moved'
    )),
    change_note  TEXT
);

-- ── action_item ───────────────────────────────────────────────────────────────
-- Smaller, optional to-do from a meeting. Optionally tied to a domain.
CREATE TABLE IF NOT EXISTS action_item (
    id        INTEGER PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES report(id),
    domain_id INTEGER REFERENCES domain(id),    -- nullable
    text      TEXT NOT NULL,
    owner     TEXT,
    due_date  TEXT,
    resolved  INTEGER NOT NULL DEFAULT 0         -- 0/1 boolean
);
