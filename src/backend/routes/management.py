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
"""

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from db import get_connection
from models import Champion, Domain, Team

router = APIRouter(prefix="/api", tags=["management"])


# ── request models (contract §1; not in models.py) ──────────────────────────

class TeamCreate(BaseModel):
    name: str
    cc_baseline: str | None = None
    baseline_date: str | None = None


class TeamUpdate(BaseModel):
    name: str | None = None
    cc_baseline: str | None = None
    baseline_date: str | None = None


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
    scope: str | None = None
    priority: int | None = None
    cross_domain: str | None = None


class DomainUpdate(BaseModel):
    team_id: int | None = None
    champion_id: int | None = None
    name: str | None = None
    description: str | None = None
    scope: str | None = None
    priority: int | None = None
    cross_domain: str | None = None


# ── helpers ──────────────────────────────────────────────────────────────────

def _insert(conn, table: str, data: dict) -> int:
    """INSERT `data` into `table`; return the new row id."""
    cols = list(data.keys())
    placeholders = ", ".join("?" for _ in cols)
    columns = ", ".join(cols)
    cur = conn.execute(
        f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
        [data[c] for c in cols],
    )
    return cur.lastrowid


def _update(conn, table: str, row_id: int, data: dict) -> None:
    """UPDATE only the provided columns of `table` row `row_id`."""
    assignments = ", ".join(f"{c} = ?" for c in data)
    conn.execute(
        f"UPDATE {table} SET {assignments} WHERE id = ?",
        [*data.values(), row_id],
    )


def _fetch(conn, table: str, row_id: int):
    return conn.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)).fetchone()


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


# ── domains ──────────────────────────────────────────────────────────────────

@router.get("/domains", response_model=list[Domain])
def list_domains(
    team_id: int | None = Query(default=None),
    champion_id: int | None = Query(default=None),
) -> list[Domain]:
    conn = get_connection()
    clauses = []
    params: list[int] = []
    if team_id is not None:
        clauses.append("team_id = ?")
        params.append(team_id)
    if champion_id is not None:
        clauses.append("champion_id = ?")
        params.append(champion_id)
    sql = "SELECT * FROM domain"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [Domain(**dict(r)) for r in rows]


@router.get("/domains/{domain_id}", response_model=Domain)
def get_domain(domain_id: int) -> Domain:
    conn = get_connection()
    row = _fetch(conn, "domain", domain_id)
    conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="Domain not found")
    return Domain(**dict(row))


@router.post("/domains", response_model=Domain, status_code=status.HTTP_201_CREATED)
def create_domain(body: DomainCreate) -> Domain:
    conn = get_connection()
    if _fetch(conn, "team", body.team_id) is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Team not found")
    if _fetch(conn, "champion", body.champion_id) is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Champion not found")
    new_id = _insert(conn, "domain", body.model_dump())
    conn.commit()
    row = _fetch(conn, "domain", new_id)
    conn.close()
    return Domain(**dict(row))


@router.patch("/domains/{domain_id}", response_model=Domain)
def update_domain(domain_id: int, body: DomainUpdate) -> Domain:
    conn = get_connection()
    if _fetch(conn, "domain", domain_id) is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Domain not found")
    changes = body.model_dump(exclude_unset=True)
    for field in ("name", "team_id", "champion_id"):
        if field in changes and changes[field] is None:
            conn.close()
            raise HTTPException(status_code=422, detail=f"{field} cannot be null")
    if "team_id" in changes and _fetch(conn, "team", changes["team_id"]) is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Team not found")
    if "champion_id" in changes and _fetch(conn, "champion", changes["champion_id"]) is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Champion not found")
    if changes:
        _update(conn, "domain", domain_id, changes)
        conn.commit()
    row = _fetch(conn, "domain", domain_id)
    conn.close()
    return Domain(**dict(row))
