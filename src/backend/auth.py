"""Authentication + authorization core (Wave 17 — RBAC).

Stdlib-only (no passlib / bcrypt / jwt): password hashing is ``hashlib.pbkdf2_hmac``
with a per-user random salt, and sessions are opaque random bearer tokens stored
in the ``session`` table. This module holds three things:

  1. Password primitives — ``hash_password`` / ``verify_password`` over a
     self-describing ``pbkdf2_sha256$<iters>$<salt_hex>$<hash_hex>`` string.
  2. Session primitives — ``create_session`` / ``resolve_session`` /
     ``delete_session`` over the ``session`` table.
  3. FastAPI dependencies + read-scope helpers — ``get_current_user`` (401),
     ``require_admin`` (403), and the plain helpers ``can_read_team`` /
     ``readable_team_ids`` that the later guard wave calls to enforce read-scope.

The RBAC model (locked): one admin (``is_admin=1``) reads+edits everything and is
untouchable; every other user is read-only with a read-scope — ``read_all=1`` (all
teams, incl. future) or a specific ``user_team`` set. Only admin writes anything
(enforced later via ``require_admin``).
"""

import hashlib
import hmac
import secrets
import sqlite3
from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException

from db import get_connection
from models import User

# ── password hashing (pbkdf2_sha256, stdlib) ─────────────────────────────────
# Format: "pbkdf2_sha256$<iters>$<salt_hex>$<hash_hex>". Iterations and salt are
# stored inline so a future bump to _PBKDF2_ITERS still verifies old hashes.
_PBKDF2_ALGO = "sha256"
_PBKDF2_PREFIX = "pbkdf2_sha256"
_PBKDF2_ITERS = 240_000          # OWASP-2023 floor for pbkdf2-sha256; see uncertainties
_SALT_BYTES = 16
_TOKEN_BYTES = 32                # secrets.token_urlsafe(32) → ~43-char token


def hash_password(password: str) -> str:
    """Hash ``password`` with a fresh random salt; return the storable string."""
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(
        _PBKDF2_ALGO, password.encode("utf-8"), salt, _PBKDF2_ITERS
    )
    return f"{_PBKDF2_PREFIX}${_PBKDF2_ITERS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check of ``password`` against a stored pbkdf2 string.

    A malformed stored value verifies to False rather than raising (a corrupt row
    must not 500 the login path).
    """
    parts = stored.split("$")
    if len(parts) != 4 or parts[0] != _PBKDF2_PREFIX:
        return False
    _, iters_s, salt_hex, hash_hex = parts
    try:
        iters = int(iters_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac(
        _PBKDF2_ALGO, password.encode("utf-8"), salt, iters
    )
    return hmac.compare_digest(candidate, expected)


# ── provisioning default password ────────────────────────────────────────────

def default_password(username: str) -> str:
    """The provisioning default password for ``username`` (e.g. ``noa`` → ``noa_noa_123``)."""
    return f"{username}_{username}_123"


# ── session tokens (opaque bearer, stored server-side) ───────────────────────

def create_session(conn: sqlite3.Connection, username: str) -> str:
    """Mint + persist a new session token for ``username``; return the token.

    The session is keyed on the user's immutable ``id`` (resolved from the
    just-authenticated ``username``), not the mutable username — so renaming a
    user in the admin portal never invalidates or errors their live sessions.
    """
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    created_at = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO session (token, user_id, created_at) "
        "VALUES (?, (SELECT id FROM user WHERE username = ?), ?)",
        (token, username, created_at),
    )
    conn.commit()
    return token


def resolve_session(conn: sqlite3.Connection, token: str):
    """Return the active user row for ``token``, or None.

    None when the token is unknown, its user no longer exists, or the user is
    inactive. There is no time-based expiry (see uncertainties).
    """
    row = conn.execute(
        "SELECT u.* FROM session s JOIN user u ON u.id = s.user_id "
        "WHERE s.token = ?",
        (token,),
    ).fetchone()
    if row is None or not row["is_active"]:
        return None
    return row


def delete_session(conn: sqlite3.Connection, token: str) -> None:
    """Drop a session token (logout). No-op if the token is unknown."""
    conn.execute("DELETE FROM session WHERE token = ?", (token,))
    conn.commit()


# ── user serialization (never exposes password_hash) ─────────────────────────

def serialize_user(conn: sqlite3.Connection, row) -> User:
    """Build the public ``User`` model from a user row + its ``user_team`` scope."""
    teams = [
        r["team_id"]
        for r in conn.execute(
            "SELECT team_id FROM user_team WHERE user_id = ?", (row["id"],)
        ).fetchall()
    ]
    return User(
        id=row["id"],
        username=row["username"],
        is_admin=bool(row["is_admin"]),
        read_all=bool(row["read_all"]),
        is_active=bool(row["is_active"]),
        teams=teams,
    )


# ── read-scope helpers (plain functions the later guard wave calls) ──────────

def readable_team_ids(conn: sqlite3.Connection, user) -> set[int] | None:
    """The set of team ids ``user`` may read, or None meaning "all teams".

    Admin and ``read_all`` users return None (unrestricted — the caller must NOT
    filter). A scoped user returns exactly their ``user_team`` set.
    """
    if user["is_admin"] or user["read_all"]:
        return None
    rows = conn.execute(
        "SELECT team_id FROM user_team WHERE user_id = ?", (user["id"],)
    ).fetchall()
    return {r["team_id"] for r in rows}


def can_read_team(conn: sqlite3.Connection, user, team_id: int) -> bool:
    """Whether ``user`` may read ``team_id`` (admin / read_all → always True)."""
    allowed = readable_team_ids(conn, user)
    return allowed is None or team_id in allowed


def filter_readable_team_ids(
    conn: sqlite3.Connection, user, team_ids: list[int]
) -> list[int]:
    """Filter ``team_ids`` down to what ``user`` may read (order preserved)."""
    allowed = readable_team_ids(conn, user)
    if allowed is None:
        return list(team_ids)
    return [tid for tid in team_ids if tid in allowed]


# ── FastAPI dependencies (the stable seam a later wave consumes) ─────────────

def _bearer_token(authorization: str | None) -> str | None:
    """Extract the bearer token from an ``Authorization`` header value, or None."""
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def get_current_user(authorization: str | None = Header(default=None)):
    """Resolve the caller's user row from ``Authorization: Bearer <token>``.

    Returns the sqlite Row (usable like a dict / mapping). Raises 401 when the
    header is missing/malformed, the token is unknown, or the user is inactive.
    """
    token = _bearer_token(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = get_connection()
    try:
        user = resolve_session(conn, token)
    finally:
        conn.close()
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


def require_admin(user=Depends(get_current_user)):
    """Depend on an authenticated ADMIN; raise 403 for any read-only user."""
    if not user["is_admin"]:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user
