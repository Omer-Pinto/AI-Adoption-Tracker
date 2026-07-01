-- AI Adoption Tracker — SQLite schema (spec §5).
--
-- Two kinds of tables: "what it is now" (team, domain, task, artifact,
-- action_item) and "history" (report, task_history, artifact_history). Both are
-- written when a report is saved. Current-state rows are kept directly (never
-- rebuilt by replay), so reads are trivial.
--
-- 1:1 champion-per-team: a team HAS exactly one champion, folded onto the team
-- row (champion_name / champion_start_date). There is no separate champion
-- table; everything keys by team_id.
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
-- A group, plus its single champion (the point person for the team's adoption),
-- folded onto the row. `champion_name` is required; `champion_start_date` is
-- optional (when they took it on).
CREATE TABLE IF NOT EXISTS team (
    id                   INTEGER PRIMARY KEY,
    name                 TEXT NOT NULL,
    champion_name        TEXT NOT NULL,
    champion_start_date  TEXT             -- nullable: when the champion started
);

-- ── domain ──────────────────────────────────────────────────────────────────
-- An area of work for a team; tasks and artifacts attach here.
CREATE TABLE IF NOT EXISTS domain (
    id           INTEGER PRIMARY KEY,
    team_id      INTEGER NOT NULL REFERENCES team(id),
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
-- One record per team meeting (covers all that team's domains). No domain_id
-- (per-team). Full report_json (incl. raw_notes) kept as audit + backfill safety
-- net in addition to the fanned-out rows. A team has at most one report per
-- meeting date.
CREATE TABLE IF NOT EXISTS report (
    id             INTEGER PRIMARY KEY,
    team_id        INTEGER NOT NULL REFERENCES team(id),
    meeting_date   TEXT NOT NULL,
    report_json    TEXT NOT NULL,   -- the full structured report (JSON text)
    schema_version INTEGER NOT NULL,
    UNIQUE(team_id, meeting_date)
);

-- ── task (current state) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task (
    id         INTEGER PRIMARY KEY,
    domain_id  INTEGER NOT NULL REFERENCES domain(id),
    name       TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN (
        'planned', 'in-progress', 'finished_successfully',
        'finished_with_issues', 'blocked', 'abandoned', 'wont_fix'
    )),
    owner      TEXT,
    started_on TEXT,
    due_date   TEXT
);

-- ── task_history (the weekly journey) ─────────────────────────────────────────
-- One row per task per meeting it is discussed. No domain_id (reached via task).
--
-- The journal is SELF-SUFFICIENT: current-state (task.status/owner/started_on/
-- due_date) is derived PURELY from these columns, never by scraping report_json.
-- That lets a manual edit (source='manual', report_id NULL — no owning report)
-- participate in the recompute identically to a report-driven row.
--   * owner    — the owner named at this meeting (NULL = not named here);
--                current-state owner = the latest row that named one.
--   * due_date — the user-picked target date recorded at this meeting (NULL =
--                none). It is a FREE user date (like an action item's due date),
--                NOT gated by terminal status; current-state due_date = the
--                latest row's due_date.
--   * source   — 'report' (fanned out from a report) or 'manual' (a direct
--                current-state edit, journaled so the story does not lie).
-- report_id is NULLABLE: a manual entry has no owning report.
CREATE TABLE IF NOT EXISTS task_history (
    id                INTEGER PRIMARY KEY,
    task_id           INTEGER NOT NULL REFERENCES task(id),
    report_id         INTEGER REFERENCES report(id),     -- nullable: manual = NULL
    meeting_date      TEXT NOT NULL,
    status_at_meeting TEXT NOT NULL CHECK (status_at_meeting IN (
        'planned', 'in-progress', 'finished_successfully',
        'finished_with_issues', 'blocked', 'abandoned', 'wont_fix'
    )),
    owner             TEXT,                              -- owner named at this meeting
    due_date          TEXT,                              -- target date picked here
    change_note       TEXT,
    source            TEXT NOT NULL DEFAULT 'report'
        CHECK (source IN ('report', 'manual'))
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
-- No domain_id (reached via artifact). An event log: current-state lives on the
-- `artifact` row, so this table just records change_kind + change_note + source.
--   * source    — 'report' (fanned out) or 'manual' (a direct entity edit).
-- report_id is NULLABLE: a manual entry has no owning report.
CREATE TABLE IF NOT EXISTS artifact_history (
    id           INTEGER PRIMARY KEY,
    artifact_id  INTEGER NOT NULL REFERENCES artifact(id),
    report_id    INTEGER REFERENCES report(id),     -- nullable: manual = NULL
    meeting_date TEXT NOT NULL,
    change_kind  TEXT NOT NULL CHECK (change_kind IN (
        'added', 'updated', 'retired', 'moved'
    )),
    change_note  TEXT,
    source       TEXT NOT NULL DEFAULT 'report'
        CHECK (source IN ('report', 'manual'))
);

-- ── action_item ───────────────────────────────────────────────────────────────
-- The AI Lead's OWN to-do (A1+A2). An action item is EXCLUSIVELY the AI Lead's,
-- so there is NO owner column (the owner is always, implicitly, the AI Lead). It
-- is created once from a report's "AI Lead to…" lines on save, or added
-- standalone on the AI-Lead board; thereafter it supports full in-place CRUD
-- (text, status, due_date, note, team, delete) for EVERY item. Action items are
-- create-once — replay/edit of a report never re-folds them. An action item is
-- tagged to a TEAM (nullable), NOT a domain: a report-derived item inherits the
-- report's team; a standalone item carries whatever team the user picks (NULL =
-- the "General"/gutter). `note` is a free-text annotation.
CREATE TABLE IF NOT EXISTS action_item (
    id        INTEGER PRIMARY KEY,
    report_id INTEGER REFERENCES report(id),    -- nullable: standalone AI-Lead item = NULL
    team_id   INTEGER REFERENCES team(id),      -- nullable: NULL = the General/gutter
    text      TEXT NOT NULL,
    note      TEXT,                              -- nullable: free-text annotation
    due_date  TEXT,
    status    TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
        'planned', 'in-progress', 'finished_successfully',
        'finished_with_issues', 'blocked', 'abandoned', 'wont_fix'
    ))
);

-- ── ai_lead_item ──────────────────────────────────────────────────────────────
-- The AI Lead's personal toolkit: meta-skills (cross-team Claude Code skills)
-- and Claude Code enhancements they maintain. STANDALONE — no team/domain/report
-- coupling, no history; created/edited/deleted only from the AI-Lead page.
CREATE TABLE IF NOT EXISTS ai_lead_item (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    category    TEXT NOT NULL CHECK (category IN ('meta_skill', 'cc_enhancement'))
);
