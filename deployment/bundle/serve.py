"""Production / air-gap single-process entrypoint.

This module is part of the DEPLOYMENT BUNDLE — it is NOT in the application
source tree and does not modify any source file. It composes on top of the
existing FastAPI app:

  * It imports the existing ``app`` object from ``app.py`` (unchanged). Importing
    it triggers app.py's lifespan, which runs ``init_db()`` — so the SQLite DB
    is created from ``schema.sql`` on first start (idempotent: ``CREATE TABLE IF
    NOT EXISTS``; an existing prod DB is never wiped).
  * It then mounts the pre-built React/Vite static frontend (``web/``) on the
    SAME origin as the API, so the frontend's relative ``/api`` calls resolve to
    this process with no reverse proxy and no Node runtime. Fully offline.

Run from the bundle's ``app/`` directory:

    uvicorn serve:app --host 0.0.0.0 --port 8080

Because the API routers are registered (in app.py) BEFORE the catch-all static
route added here, ``/api/...`` always resolves to the API; everything else is
served from ``web/`` (real file if it exists, else ``index.html`` for SPA
client-side routing).

Environment overrides:
    TRACKER_WEB_DIR   Absolute path to the built frontend. Default: ``../web``
                      relative to this file (i.e. the bundle's ``web/`` dir).
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException
from starlette.responses import FileResponse

# Importing the existing, UNMODIFIED FastAPI application. This also wires its
# lifespan (init_db on startup). We extend the same instance below.
from app import app

_HERE = Path(__file__).resolve().parent
WEB_DIR = Path(os.environ.get("TRACKER_WEB_DIR", str(_HERE.parent / "web"))).resolve()
_INDEX = WEB_DIR / "index.html"


@app.get("/{full_path:path}", include_in_schema=False)
def _spa(full_path: str) -> FileResponse:
    """Serve the built SPA: a real static file if present, else index.html.

    API routes (registered in app.py before this catch-all) take precedence, so
    they are never shadowed. Unknown ``/api/...`` paths still 404 here rather
    than silently returning the SPA shell.
    """
    if full_path.startswith("api/") or full_path == "api":
        raise HTTPException(status_code=404, detail="Not Found")

    if full_path:
        candidate = (WEB_DIR / full_path).resolve()
        # Guard against path traversal: candidate must stay inside WEB_DIR.
        if str(candidate).startswith(str(WEB_DIR)) and candidate.is_file():
            return FileResponse(candidate)

    if not _INDEX.is_file():
        raise HTTPException(
            status_code=500,
            detail=f"Frontend build not found at {WEB_DIR}. Set TRACKER_WEB_DIR.",
        )
    return FileResponse(_INDEX)
