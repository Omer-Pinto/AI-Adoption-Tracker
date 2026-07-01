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
import math
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

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

# ── session expiry (Wave 17.1) ───────────────────────────────────────────────
# A session dies when EITHER limit is exceeded (whichever hits first): idle since
# last use, or absolute age since birth. resolve_session enforces both and slides
# the idle window forward on each valid use.
SESSION_IDLE_SECONDS = 8 * 3600        # kill after 8h of inactivity (sliding)
SESSION_ABSOLUTE_SECONDS = 24 * 3600   # hard cap: 24h since login, even if active

# ── login lockout (Wave 17.1) ────────────────────────────────────────────────
LOGIN_MAX_FAILS = 5                    # consecutive failures before a lockout
LOGIN_LOCKOUT_SECONDS = 15 * 60        # lockout duration once the limit is hit


# ── time helpers (single source of "now" + robust ISO parsing) ───────────────

def _utcnow() -> datetime:
    """Current time as a tz-aware UTC datetime (the one source of ``now``)."""
    return datetime.now(timezone.utc)


def _parse_ts(value: str) -> datetime:
    """Parse a stored ISO-8601 timestamp back to a tz-aware UTC datetime.

    Handles the ``datetime.isoformat()`` output written by this module (which
    carries a ``+00:00`` offset); a naive value (no offset) is assumed UTC so a
    hand-inserted row never throws off the comparison.
    """
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


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
    now = _utcnow().isoformat()
    conn.execute(
        "INSERT INTO session (token, user_id, created_at, last_used_at) "
        "VALUES (?, (SELECT id FROM user WHERE username = ?), ?, ?)",
        (token, username, now, now),
    )
    conn.commit()
    return token


def resolve_session(conn: sqlite3.Connection, token: str):
    """Return the active user row for ``token``, or None.

    None when the token is unknown, its user no longer exists, the user is
    inactive, or the session has expired. Expiry (Wave 17.1): the session dies if
    it is older than ``SESSION_ABSOLUTE_SECONDS`` (since ``created_at``) OR idle
    longer than ``SESSION_IDLE_SECONDS`` (since ``last_used_at``) — whichever hits
    first; the row is deleted and None returned (the caller maps None → 401). On a
    still-valid session ``last_used_at`` slides forward to now (sliding idle window).
    """
    row = conn.execute(
        "SELECT u.*, s.created_at AS session_created_at, "
        "       s.last_used_at AS session_last_used_at "
        "FROM session s JOIN user u ON u.id = s.user_id "
        "WHERE s.token = ?",
        (token,),
    ).fetchone()
    if row is None or not row["is_active"]:
        return None
    now = _utcnow()
    created = _parse_ts(row["session_created_at"])
    last_used = _parse_ts(row["session_last_used_at"])
    if (
        (now - created).total_seconds() >= SESSION_ABSOLUTE_SECONDS
        or (now - last_used).total_seconds() >= SESSION_IDLE_SECONDS
    ):
        conn.execute("DELETE FROM session WHERE token = ?", (token,))
        conn.commit()
        return None
    conn.execute(
        "UPDATE session SET last_used_at = ? WHERE token = ?",
        (now.isoformat(), token),
    )
    conn.commit()
    return row


def delete_session(conn: sqlite3.Connection, token: str) -> None:
    """Drop a session token (logout). No-op if the token is unknown."""
    conn.execute("DELETE FROM session WHERE token = ?", (token,))
    conn.commit()


# ── login lockout (Wave 17.1 — brute-force throttle, per submitted username) ──
# Keyed on the SUBMITTED username (an accepted DoS tradeoff for an internal LAN
# tool — a caller can lock out a known username; this is not internet-facing).

def login_locked(conn: sqlite3.Connection, username: str) -> int:
    """Remaining lockout seconds for ``username`` (0 if not currently locked).

    Compares the stored ``locked_until`` to now; a positive return means the
    login route should reject with 429 before touching credentials.
    """
    row = conn.execute(
        "SELECT locked_until FROM login_attempt WHERE username = ?", (username,)
    ).fetchone()
    if row is None or row["locked_until"] is None:
        return 0
    remaining = (_parse_ts(row["locked_until"]) - _utcnow()).total_seconds()
    return max(0, math.ceil(remaining))


def record_login_failure(conn: sqlite3.Connection, username: str) -> None:
    """Count one failed login for ``username``; trip the lockout at the limit.

    Upserts an incrementing ``fail_count``. When it reaches ``LOGIN_MAX_FAILS`` we
    set ``locked_until = now + LOGIN_LOCKOUT_SECONDS`` and reset ``fail_count`` to
    0 so the window after the lockout starts fresh.
    """
    conn.execute(
        "INSERT INTO login_attempt (username, fail_count, locked_until) "
        "VALUES (?, 1, NULL) "
        "ON CONFLICT(username) DO UPDATE SET fail_count = fail_count + 1",
        (username,),
    )
    row = conn.execute(
        "SELECT fail_count FROM login_attempt WHERE username = ?", (username,)
    ).fetchone()
    if row["fail_count"] >= LOGIN_MAX_FAILS:
        locked_until = (
            _utcnow() + timedelta(seconds=LOGIN_LOCKOUT_SECONDS)
        ).isoformat()
        conn.execute(
            "UPDATE login_attempt SET fail_count = 0, locked_until = ? "
            "WHERE username = ?",
            (locked_until, username),
        )
    conn.commit()


def clear_login_attempts(conn: sqlite3.Connection, username: str) -> None:
    """Wipe the failure counter for ``username`` (called on a successful login)."""
    conn.execute("DELETE FROM login_attempt WHERE username = ?", (username,))
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
