"""Management API — teams, champions, domains CRUD.

Implements API contract §1 (Agent 1A). CRUD for the three management entities,
each a list with Add/Edit (spec §7). Plain parameterized SQL via
`get_connection()`; one connection opened/committed/closed per request.

Response shapes are the entity models from `models.py` (`Team`, `Champion`,
`Domain`). The request models referenced by the contract (`TeamCreate`/etc.) do
not live in `models.py`, so they are defined locally here:
  * `*Create` — the entity fields minus `id`; required vs optional mirrors the
    entity model's nullability (NOT NULL columns required, nullable optional).
  * `*Update` — every field optional (partial PATCH; only provided fields are
    written, using `model_dump(exclude_unset=True)`).

Domain cross-links are stored in `domain_link(domain_a, domain_b)` as
unordered pairs (domain_a < domain_b). The `cross_domain_ids` field on
DomainCreate/DomainUpdate reconciles this domain's links to exactly the
supplied set (add missing pairs, remove stale ones).
"""

import sqlite3

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

import llm.interface as llm
from db import get_connection
from domain_helpers import build_domain, build_domains_for_query
from models import Champion, Domain, Team
from reports.engine import _ensure_context_creation_domain, _ensure_general_domain

router = APIRouter(prefix="/api", tags=["management"])


# ── request models (contract §1; not in models.py) ──────────────────────────

class TeamCreate(BaseModel):
    name: str


class TeamUpdate(BaseModel):
    name: str | None = None


class ChampionCreate(BaseModel):
    name: str
    team_id: int
    start_date: str | None = None
    end_date: str | None = None


class ChampionUpdate(BaseModel):
    name: str | None = None
    team_id: int | None = None
    start_date: str | None = None
    end_date: str | None = None


class DomainCreate(BaseModel):
    team_id: int
    champion_id: int
    name: str
    description: str | None = None
    priority: str | None = None
    cross_domain_ids: list[int] = []


class DomainUpdate(BaseModel):
    team_id: int | None = None
    champion_id: int | None = None
    name: str | None = None
    description: str | None = None
    priority: str | None = None
    cross_domain_ids: list[int] | None = None


# ── constants ────────────────────────────────────────────────────────────────
# System-provided domains the user may never delete (FROZEN CONTRACT, Wave 12).
_GENERAL_DOMAIN_NAME = "General"
_UNDELETABLE_DOMAIN_NAMES = {"general", "context creation"}


# ── helpers ──────────────────────────────────────────────────────────────────

def _ensure_general_domain(
    conn: sqlite3.Connection, champion_id: int, team_id: int
) -> int:
    """Find (or create) this champion's 'General' catch-all domain; return its id.

    Mirrors the report engine's catch-all bucket so a domain-delete can reassign
    orphaned tasks/artifacts. Plain-SQL to match this module's style (management
    never reaches into the engine)."""
    for row in conn.execute(
        "SELECT id, name FROM domain WHERE champion_id = ?", (champion_id,)
    ).fetchall():
        if row["name"].strip().lower() == _GENERAL_DOMAIN_NAME.lower():
            return row["id"]
    cur = conn.execute(
        "INSERT INTO domain (team_id, champion_id, name, description) VALUES (?, ?, ?, ?)",
        (team_id, champion_id, _GENERAL_DOMAIN_NAME,
         "Catch-all for items not yet assigned to a specific domain."),
    )
    return cur.lastrowid


def _insert(conn: sqlite3.Connection, table: str, data: dict) -> int:
    """INSERT `data` into `table`; return the new row id."""
    cols = list(data.keys())
    placeholders = ", ".join("?" for _ in cols)
    columns = ", ".join(cols)
    cur = conn.execute(
        f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
        [data[c] for c in cols],
    )
    return cur.lastrowid


def _update(conn: sqlite3.Connection, table: str, row_id: int, data: dict) -> None:
    """UPDATE only the provided columns of `table` row `row_id`."""
    assignments = ", ".join(f"{c} = ?" for c in data)
    conn.execute(
        f"UPDATE {table} SET {assignments} WHERE id = ?",
        [*data.values(), row_id],
    )


def _fetch(conn: sqlite3.Connection, table: str, row_id: int):
    return conn.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)).fetchone()


def _assert_champion_belongs_to_team(
    conn: sqlite3.Connection, champion_id: int, team_id: int
) -> None:
    """Raise 422 if the champion's team_id does not match `team_id`.

    Call AFTER the individual FK existence checks so callers already know both
    the champion and team rows exist.
    """
    row = conn.execute(
        "SELECT team_id FROM champion WHERE id = ?", (champion_id,)
    ).fetchone()
    if row is None:
        # Shouldn't happen — caller already checked — but be defensive.
        raise HTTPException(status_code=404, detail="Champion not found")
    if row["team_id"] != team_id:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Champion {champion_id} belongs to team {row['team_id']}, "
                f"not team {team_id}. A domain's champion must belong to the "
                "same team as the domain."
            ),
        )


def _reconcile_links(
    conn: sqlite3.Connection, domain_id: int, target_ids: list[int]
) -> None:
    """Reconcile domain_link rows for `domain_id` to exactly `target_ids`.

    Adds rows for pairs not yet present; removes rows for pairs whose other
    side is no longer in the target set. Each pair is stored once as
    (min(a,b), max(a,b)).  Validates that every id in `target_ids` exists.
    Cross-team links are allowed.
    """
    # Validate all target ids exist.
    for other_id in target_ids:
        if conn.execute("SELECT id FROM domain WHERE id = ?", (other_id,)).fetchone() is None:
            raise HTTPException(
                status_code=422,
                detail=f"cross_domain_ids references unknown domain id {other_id}",
            )

    target_set = set(target_ids)

    # Current linked ids (from either slot).
    current_rows = conn.execute(
        "SELECT domain_a, domain_b FROM domain_link WHERE domain_a = ? OR domain_b = ?",
        (domain_id, domain_id),
    ).fetchall()
    current_set: set[int] = set()
    for r in current_rows:
        other = r["domain_b"] if r["domain_a"] == domain_id else r["domain_a"]
        current_set.add(other)

    # Add missing pairs.
    to_add = target_set - current_set
    for other_id in to_add:
        a, b = min(domain_id, other_id), max(domain_id, other_id)
        conn.execute("INSERT OR IGNORE INTO domain_link (domain_a, domain_b) VALUES (?, ?)", (a, b))

    # Remove stale pairs.
    to_remove = current_set - target_set
    for other_id in to_remove:
        a, b = min(domain_id, other_id), max(domain_id, other_id)
        conn.execute(
            "DELETE FROM domain_link WHERE domain_a = ? AND domain_b = ?", (a, b)
        )


# ── teams ────────────────────────────────────────────────────────────────────

@router.get("/teams", response_model=list[Team])
def list_teams() -> list[Team]:
    conn = get_connection()
    rows = conn.execute("SELECT * FROM team").fetchall()
    conn.close()
    return [Team(**dict(r)) for r in rows]


@router.get("/teams/{team_id}", response_model=Team)
def get_team(team_id: int) -> Team:
    conn = get_connection()
    row = _fetch(conn, "team", team_id)
    conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return Team(**dict(row))


@router.post("/teams", response_model=Team, status_code=status.HTTP_201_CREATED)
def create_team(body: TeamCreate) -> Team:
    conn = get_connection()
    new_id = _insert(conn, "team", body.model_dump())
    conn.commit()
    row = _fetch(conn, "team", new_id)
    conn.close()
    return Team(**dict(row))


@router.patch("/teams/{team_id}", response_model=Team)
def update_team(team_id: int, body: TeamUpdate) -> Team:
    conn = get_connection()
    if _fetch(conn, "team", team_id) is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Team not found")
    changes = body.model_dump(exclude_unset=True)
    for field in ("name",):
        if field in changes and changes[field] is None:
            conn.close()
            raise HTTPException(status_code=422, detail=f"{field} cannot be null")
    if changes:
        _update(conn, "team", team_id, changes)
        conn.commit()
    row = _fetch(conn, "team", team_id)
    conn.close()
    return Team(**dict(row))


# ── champions ────────────────────────────────────────────────────────────────

@router.get("/champions", response_model=list[Champion])
def list_champions(team_id: int | None = Query(default=None)) -> list[Champion]:
    conn = get_connection()
    if team_id is None:
        rows = conn.execute("SELECT * FROM champion").fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM champion WHERE team_id = ?", (team_id,)
        ).fetchall()
    conn.close()
    return [Champion(**dict(r)) for r in rows]


@router.get("/champions/{champion_id}", response_model=Champion)
def get_champion(champion_id: int) -> Champion:
    conn = get_connection()
    row = _fetch(conn, "champion", champion_id)
    conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="Champion not found")
    return Champion(**dict(row))


@router.post("/champions", response_model=Champion, status_code=status.HTTP_201_CREATED)
def create_champion(body: ChampionCreate) -> Champion:
    conn = get_connection()
    if _fetch(conn, "team", body.team_id) is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Team not found")
    new_id = _insert(conn, "champion", body.model_dump())
    conn.commit()
    row = _fetch(conn, "champion", new_id)
    conn.close()
    return Champion(**dict(row))


@router.patch("/champions/{champion_id}", response_model=Champion)
def update_champion(champion_id: int, body: ChampionUpdate) -> Champion:
    conn = get_connection()
    if _fetch(conn, "champion", champion_id) is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Champion not found")
    changes = body.model_dump(exclude_unset=True)
    for field in ("name", "team_id"):
        if field in changes and changes[field] is None:
            conn.close()
            raise HTTPException(status_code=422, detail=f"{field} cannot be null")
    if "team_id" in changes and _fetch(conn, "team", changes["team_id"]) is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Team not found")
    if changes:
        _update(conn, "champion", champion_id, changes)
        conn.commit()
    row = _fetch(conn, "champion", champion_id)
    conn.close()
    return Champion(**dict(row))


@router.delete("/champions/{champion_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_champion(champion_id: int) -> None:
    """Delete a champion and its (now-empty) domains.

    Guards meeting history: if the champion has ANY reports, refuse with 409 —
    deleting would destroy the fanned-out timeline. A champion with no reports has
    no tasks/artifacts (both are report-driven), so its domains are empty and are
    removed alongside it (domain_link rows cascade). 404 if the champion is
    unknown."""
    conn = get_connection()
    try:
        if _fetch(conn, "champion", champion_id) is None:
            raise HTTPException(status_code=404, detail="Champion not found")
        report_count = conn.execute(
            "SELECT COUNT(*) AS n FROM report WHERE champion_id = ?", (champion_id,)
        ).fetchone()["n"]
        if report_count:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Champion {champion_id} has {report_count} report(s); "
                    "delete is blocked to preserve meeting history."
                ),
            )
        conn.execute("DELETE FROM domain WHERE champion_id = ?", (champion_id,))
        conn.execute("DELETE FROM champion WHERE id = ?", (champion_id,))
        conn.commit()
    finally:
        conn.close()


# ── domains ──────────────────────────────────────────────────────────────────

class DomainExtractRequest(BaseModel):
    """Body for POST /api/domains/extract."""
    text: str


@router.post("/domains/extract", tags=["management"])
def extract_domains(body: DomainExtractRequest) -> dict:
    """Extract domain proposals from free text via the LLM.

    Calls the configured LLM provider to identify technology/work domains
    mentioned in the supplied text. Returns a list of proposals; nothing is
    saved to the database.

    Response shape: ``{ "domains": [ { "name": str, "description": str|null,
    "priority": int|null } ] }``
    """
    try:
        return llm.extract_domains(body.text)
    except llm.LLMNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except llm.LLMRequestError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/domains", response_model=list[Domain])
def list_domains(
    team_id: int | None = Query(default=None),
    champion_id: int | None = Query(default=None),
) -> list[Domain]:
    conn = get_connection()
    try:
        clauses: list[str] = []
        params: list[int] = []
        if team_id is not None:
            clauses.append("d.team_id = ?")
            params.append(team_id)
        if champion_id is not None:
            clauses.append("d.champion_id = ?")
            params.append(champion_id)
        return build_domains_for_query(conn, clauses, params)
    finally:
        conn.close()


@router.get("/domains/{domain_id}", response_model=Domain)
def get_domain(domain_id: int) -> Domain:
    conn = get_connection()
    try:
        domain = build_domain(conn, domain_id)
        if domain is None:
            raise HTTPException(status_code=404, detail="Domain not found")
        return domain
    finally:
        conn.close()


@router.post("/domains", response_model=Domain, status_code=status.HTTP_201_CREATED)
def create_domain(body: DomainCreate) -> Domain:
    conn = get_connection()
    try:
        if _fetch(conn, "team", body.team_id) is None:
            raise HTTPException(status_code=404, detail="Team not found")
        if _fetch(conn, "champion", body.champion_id) is None:
            raise HTTPException(status_code=404, detail="Champion not found")
        _assert_champion_belongs_to_team(conn, body.champion_id, body.team_id)
        domain_data = {
            "team_id": body.team_id,
            "champion_id": body.champion_id,
            "name": body.name,
            "description": body.description,
            "priority": body.priority,
        }
        new_id = _insert(conn, "domain", domain_data)
        _reconcile_links(conn, new_id, body.cross_domain_ids)
        # Once a champion has a real domain, ensure their two constant domains
        # exist. Both helpers are idempotent (case-insensitive name lookup), so
        # they create 'General' / 'Context creation' only the first time and
        # never duplicate them on subsequent domain creations.
        _ensure_general_domain(conn, body.champion_id, body.team_id)
        _ensure_context_creation_domain(conn, body.champion_id, body.team_id)
        conn.commit()
        return build_domain(conn, new_id)
    finally:
        conn.close()


@router.patch("/domains/{domain_id}", response_model=Domain)
def update_domain(domain_id: int, body: DomainUpdate) -> Domain:
    conn = get_connection()
    try:
        existing_row = _fetch(conn, "domain", domain_id)
        if existing_row is None:
            raise HTTPException(status_code=404, detail="Domain not found")
        changes = body.model_dump(exclude_unset=True)
        # Pop cross_domain_ids before building the SQL update dict.
        cross_domain_ids: list[int] | None = changes.pop("cross_domain_ids", None)
        for field in ("name", "team_id", "champion_id"):
            if field in changes and changes[field] is None:
                raise HTTPException(status_code=422, detail=f"{field} cannot be null")
        if "team_id" in changes and _fetch(conn, "team", changes["team_id"]) is None:
            raise HTTPException(status_code=404, detail="Team not found")
        if "champion_id" in changes and _fetch(conn, "champion", changes["champion_id"]) is None:
            raise HTTPException(status_code=404, detail="Champion not found")
        # Cross-team guard: if either team_id or champion_id is being changed,
        # ensure the effective (post-patch) champion belongs to the effective team.
        if "team_id" in changes or "champion_id" in changes:
            effective_team_id = changes.get("team_id", existing_row["team_id"])
            effective_champion_id = changes.get("champion_id", existing_row["champion_id"])
            _assert_champion_belongs_to_team(conn, effective_champion_id, effective_team_id)
        if changes:
            _update(conn, "domain", domain_id, changes)
        if cross_domain_ids is not None:
            _reconcile_links(conn, domain_id, cross_domain_ids)
        conn.commit()
        return build_domain(conn, domain_id)
    finally:
        conn.close()


@router.delete("/domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_domain(domain_id: int) -> None:
    """Delete a domain, reassigning its tasks & artifacts to the champion's
    'General' catch-all first.

    Blocks (409) deleting the system-provided constant domains 'General' and
    'Context creation'. Tasks (NOT NULL domain_id) and artifacts in the deleted
    domain are re-parented to 'General' (ensured) so nothing is orphaned; the
    domain's cross-links cascade. 404 if the domain is unknown."""
    conn = get_connection()
    try:
        row = _fetch(conn, "domain", domain_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Domain not found")
        if row["name"].strip().lower() in _UNDELETABLE_DOMAIN_NAMES:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Domain {row['name']!r} is a system domain and cannot be "
                    "deleted."
                ),
            )
        general_id = _ensure_general_domain(
            conn, row["champion_id"], row["team_id"]
        )
        conn.execute(
            "UPDATE task SET domain_id = ? WHERE domain_id = ?",
            (general_id, domain_id),
        )
        conn.execute(
            "UPDATE artifact SET domain_id = ? WHERE domain_id = ?",
            (general_id, domain_id),
        )
        conn.execute(
            "UPDATE action_item SET domain_id = ? WHERE domain_id = ?",
            (general_id, domain_id),
        )
        conn.execute("DELETE FROM domain WHERE id = ?", (domain_id,))
        conn.commit()
    finally:
        conn.close()
