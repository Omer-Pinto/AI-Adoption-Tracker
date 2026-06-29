"""Shared domain-read helpers used by management and views routes.

Factored out because both routes need the same enriched Domain response:
  - team_name joined from the `team` table
  - cross_domains resolved from the symmetric `domain_link` table

Neither of these is a route concern; they are pure DB read helpers.
"""

from __future__ import annotations

import sqlite3

from models import Domain, DomainRef


def fetch_cross_domains(conn: sqlite3.Connection, domain_id: int) -> list[DomainRef]:
    """Return a DomainRef list for every domain linked to `domain_id`.

    The link is symmetric and stored once per unordered pair (domain_a <
    domain_b). We query both slots so that the result is the same regardless
    of which slot stores `domain_id`.
    """
    rows = conn.execute(
        """
        SELECT d.id, d.name, d.team_id, t.name AS team_name
        FROM domain_link dl
        JOIN domain d ON d.id = CASE
            WHEN dl.domain_a = ? THEN dl.domain_b
            ELSE dl.domain_a
        END
        JOIN team t ON t.id = d.team_id
        WHERE dl.domain_a = ? OR dl.domain_b = ?
        ORDER BY d.id
        """,
        (domain_id, domain_id, domain_id),
    ).fetchall()
    return [
        DomainRef(
            id=r["id"],
            name=r["name"],
            team_id=r["team_id"],
            team_name=r["team_name"],
        )
        for r in rows
    ]


def build_domain(conn: sqlite3.Connection, domain_id: int) -> Domain | None:
    """Build the full enriched Domain model for one domain id.

    Returns None when no domain with that id exists (caller raises 404).
    Joins team for team_name; resolves cross_domains via domain_link.
    """
    row = conn.execute(
        """
        SELECT d.id, d.team_id, t.name AS team_name,
               d.name, d.description, d.priority
        FROM domain d
        JOIN team t ON t.id = d.team_id
        WHERE d.id = ?
        """,
        (domain_id,),
    ).fetchone()
    if row is None:
        return None
    return Domain(
        id=row["id"],
        team_id=row["team_id"],
        team_name=row["team_name"],
        name=row["name"],
        description=row["description"],
        priority=row["priority"],
        cross_domains=fetch_cross_domains(conn, domain_id),
    )


def build_domains_for_query(
    conn: sqlite3.Connection,
    clauses: list[str],
    params: list,
) -> list[Domain]:
    """Fetch all domain ids matching optional WHERE clauses, then enrich each.

    `clauses` are SQL fragments (e.g. ``["d.team_id = ?"]``); `params` are the
    corresponding bind values. An empty clauses list returns all domains.
    """
    sql = "SELECT d.id FROM domain d"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY d.id"
    rows = conn.execute(sql, params).fetchall()
    return [d for r in rows if (d := build_domain(conn, r["id"])) is not None]
