"""Admin user-portal API — manage read-only users (Wave 17, RBAC).

EVERY endpoint requires the admin (``Depends(require_admin)``). Users managed here
are the read-only accounts; the single admin is UNTOUCHABLE — it is never listed,
created, edited, deleted, or reset (targeting the admin row → 404, as if invisible).
A password hash is NEVER returned. Read-scope is ``read_all`` (all teams) XOR a
specific ``teams`` set (``user_team`` rows); a ``read_all`` user stores no team rows.

Router prefix is ``/api/users``.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from auth import default_password, hash_password, require_admin, serialize_user
from db import get_connection
from models import ResetPasswordRequest, User, UserCreate, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"], dependencies=[Depends(require_admin)])


# ── helpers ──────────────────────────────────────────────────────────────────

def _get_manageable_user(conn: sqlite3.Connection, user_id: int):
    """Fetch a NON-admin user row, or 404. The admin row is treated as absent so
    it can never be listed/edited/deleted/reset through the portal."""
    row = conn.execute("SELECT * FROM user WHERE id = ?", (user_id,)).fetchone()
    if row is None or row["is_admin"]:
        raise HTTPException(status_code=404, detail="User not found")
    return row


def _validate_teams(conn: sqlite3.Connection, team_ids: list[int]) -> None:
    for team_id in team_ids:
        if conn.execute("SELECT id FROM team WHERE id = ?", (team_id,)).fetchone() is None:
            raise HTTPException(
                status_code=422, detail=f"teams references unknown team id {team_id}"
            )


def _set_user_teams(conn: sqlite3.Connection, user_id: int, team_ids: list[int]) -> None:
    """Replace a user's read-scope team set with exactly ``team_ids``."""
    conn.execute("DELETE FROM user_team WHERE user_id = ?", (user_id,))
    for team_id in team_ids:
        conn.execute(
            "INSERT INTO user_team (user_id, team_id) VALUES (?, ?)", (user_id, team_id)
        )


# ── endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[User])
def list_users() -> list[User]:
    """List every managed user (admin excluded)."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM user WHERE is_admin = 0 ORDER BY username"
        ).fetchall()
        return [serialize_user(conn, r) for r in rows]
    finally:
        conn.close()


@router.post("", response_model=User, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate) -> User:
    """Create a read-only user. ``read_all`` users store no team rows; otherwise
    the ``teams`` set is the read-scope. 409 if the username is taken."""
    conn = get_connection()
    try:
        if conn.execute(
            "SELECT id FROM user WHERE username = ?", (body.username,)
        ).fetchone() is not None:
            raise HTTPException(status_code=409, detail="Username already exists")
        teams = [] if body.read_all else body.teams
        _validate_teams(conn, teams)
        cur = conn.execute(
            "INSERT INTO user (username, password_hash, is_admin, read_all, is_active) "
            "VALUES (?, ?, 0, ?, ?)",
            (
                body.username,
                hash_password(body.password),
                int(body.read_all),
                int(body.is_active),
            ),
        )
        user_id = cur.lastrowid
        _set_user_teams(conn, user_id, teams)
        conn.commit()
        row = conn.execute("SELECT * FROM user WHERE id = ?", (user_id,)).fetchone()
        return serialize_user(conn, row)
    finally:
        conn.close()


@router.patch("/{user_id}", response_model=User)
def update_user(user_id: int, body: UserUpdate) -> User:
    """Edit a managed user (partial). Setting ``read_all`` true clears any team
    scope; passing ``teams`` replaces the set (only when not read_all)."""
    conn = get_connection()
    try:
        existing = _get_manageable_user(conn, user_id)
        changes = body.model_dump(exclude_unset=True)
        teams = changes.pop("teams", None)

        if "username" in changes:
            if changes["username"] is None:
                raise HTTPException(status_code=422, detail="username cannot be null")
            clash = conn.execute(
                "SELECT id FROM user WHERE username = ? AND id != ?",
                (changes["username"], user_id),
            ).fetchone()
            if clash is not None:
                raise HTTPException(status_code=409, detail="Username already exists")

        # Resolve the effective read_all after this patch (to decide team scope).
        read_all_after = changes.get("read_all", bool(existing["read_all"]))

        cols = {k: (int(v) if k in ("read_all", "is_active") else v) for k, v in changes.items()}
        if cols:
            assignments = ", ".join(f"{c} = ?" for c in cols)
            conn.execute(
                f"UPDATE user SET {assignments} WHERE id = ?",
                [*cols.values(), user_id],
            )

        if read_all_after:
            _set_user_teams(conn, user_id, [])       # read_all ⇒ no specific scope
        elif teams is not None:
            _validate_teams(conn, teams)
            _set_user_teams(conn, user_id, teams)

        conn.commit()
        row = conn.execute("SELECT * FROM user WHERE id = ?", (user_id,)).fetchone()
        return serialize_user(conn, row)
    finally:
        conn.close()


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int) -> None:
    """Delete a managed user; their ``user_team`` rows and sessions cascade."""
    conn = get_connection()
    try:
        _get_manageable_user(conn, user_id)
        conn.execute("DELETE FROM user WHERE id = ?", (user_id,))
        conn.commit()
    finally:
        conn.close()


@router.post("/{user_id}/reset-password", response_model=User)
def reset_password(user_id: int, body: ResetPasswordRequest) -> User:
    """Reset a managed user's password to a supplied value, or the provisioning
    default (``<username>_<username>_123``) when none is given."""
    conn = get_connection()
    try:
        existing = _get_manageable_user(conn, user_id)
        new_password = body.new_password or default_password(existing["username"])
        conn.execute(
            "UPDATE user SET password_hash = ? WHERE id = ?",
            (hash_password(new_password), user_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM user WHERE id = ?", (user_id,)).fetchone()
        return serialize_user(conn, row)
    finally:
        conn.close()
