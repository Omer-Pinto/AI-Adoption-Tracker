"""Auth API — login / logout / me / change-password (Wave 17, RBAC).

Session-token auth over the ``session`` table (see ``auth.py``). ``POST /login`` is
the ONLY public endpoint; the other three require a valid bearer token via
``Depends(get_current_user)``. Nothing here returns a password hash.

Router prefix is ``/api/auth``.
"""

from fastapi import APIRouter, Depends, Header, HTTPException

from auth import (
    _bearer_token,
    create_session,
    delete_session,
    get_current_user,
    hash_password,
    serialize_user,
    verify_password,
)
from db import get_connection
from models import ChangePasswordRequest, LoginRequest, LoginResponse, User

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest) -> LoginResponse:
    """Verify credentials and mint a session. 401 on any failure (no user enum)."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM user WHERE username = ?", (body.username,)
        ).fetchone()
        if (
            row is None
            or not row["is_active"]
            or not verify_password(body.password, row["password_hash"])
        ):
            raise HTTPException(status_code=401, detail="Invalid username or password")
        token = create_session(conn, row["username"])
        return LoginResponse(token=token, user=serialize_user(conn, row))
    finally:
        conn.close()


@router.post("/logout", status_code=204)
def logout(
    _user=Depends(get_current_user),
    authorization: str | None = Header(default=None),
) -> None:
    """Delete the caller's current session token (idempotent)."""
    token = _bearer_token(authorization)
    conn = get_connection()
    try:
        delete_session(conn, token)
    finally:
        conn.close()


@router.get("/me", response_model=User)
def me(user=Depends(get_current_user)) -> User:
    """Return the authenticated caller's own user row (no password hash)."""
    conn = get_connection()
    try:
        return serialize_user(conn, user)
    finally:
        conn.close()


@router.post("/change-password", status_code=204)
def change_password(
    body: ChangePasswordRequest, user=Depends(get_current_user)
) -> None:
    """Change the CURRENT user's own password (verifies the old one first)."""
    if not verify_password(body.old_password, user["password_hash"]):
        raise HTTPException(status_code=403, detail="Current password is incorrect")
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE user SET password_hash = ? WHERE id = ?",
            (hash_password(body.new_password), user["id"]),
        )
        conn.commit()
    finally:
        conn.close()
