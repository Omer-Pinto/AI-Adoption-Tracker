"""Search API — `key:value` DSL filtering + autocomplete value endpoints.

Wave-0 stub: exposes an empty `router` so app.py can pre-wire the include.
The DSL parser/compiler module (src/backend/search/) is copied in by the
orchestrator (task 0.4) and adapted by Wave-1 Agent 1D, which also fills this
router. Do NOT create the search module here; do NOT edit app.py to add routes.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/search", tags=["search"])
