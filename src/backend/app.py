"""AI Adoption Tracker — FastAPI application entrypoint.

Offline / air-gapped backend. This file freezes the router wiring: the four
feature route modules are pre-included here in Wave 0 so that Wave-1 agents
only fill their own router and never touch app.py.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import init_db
from routes import management, reports, search, views

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


app = FastAPI(title="AI Adoption Tracker", version="0.1.0", lifespan=lifespan)

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
    return {"status": "ok"}
