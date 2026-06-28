"""AI Adoption Tracker — FastAPI application entrypoint.

Offline / air-gapped backend. This file freezes the router wiring: the four
feature route modules are pre-included here in Wave 0 so that Wave-1 agents
only fill their own router and never touch app.py.
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import init_db
from routes import management, reports, search, views


def _resolve_version() -> str:
    """The running product version, shown in the UI so it's clear which build is live.

    Resolves (first hit wins): the TRACKER_APP_VERSION env var; a `VERSION` file
    shipped next to the backend (the air-gap bundle places one in `app/`); the
    repo-root `VERSION` (dev). Falls back to "0.0.0-dev".
    """
    env = os.environ.get("TRACKER_APP_VERSION")
    if env and env.strip():
        return env.strip()
    here = Path(__file__).resolve()
    for candidate in (here.parent / "VERSION", here.parents[2] / "VERSION"):
        try:
            text = candidate.read_text(encoding="utf-8").strip()
            if text:
                return text
        except OSError:
            continue
    return "0.0.0-dev"


APP_VERSION = _resolve_version()

# Vite dev server origin. Single-user local tool, so we allow the default Vite
# dev origin only. Adjust here if the frontend dev port changes.
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="AI Adoption Tracker", version=APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pre-wired router includes (frozen in Wave 0; Wave-1 fills the routers).
app.include_router(management.router)
app.include_router(views.router)
app.include_router(reports.router)
app.include_router(search.router)


@app.get("/api/health", tags=["health"])
def health() -> dict:
    return {"status": "ok", "version": APP_VERSION}
