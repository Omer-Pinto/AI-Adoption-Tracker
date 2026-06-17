"""Reports API — draft (notes -> structured), confirm/save fan-out, edit + replay.

Wave-0 stub: exposes an empty `router` so app.py can pre-wire the include.
Endpoints are implemented by Wave-1 Agent 1C. Do NOT edit app.py to add routes.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/reports", tags=["reports"])
