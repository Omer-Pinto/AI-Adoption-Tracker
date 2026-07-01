"""Search API — autocomplete value endpoint for the `key:value` chip bar.

The DSL filtering itself is not its own HTTP route: ``filter_tasks`` /
``filter_artifacts`` (in the ``search`` package) are imported and called by
Agent 1B's ``/api/tasks`` and ``/api/artifacts`` list endpoints. This router
only exposes the chip bar's value suggestions (api_contract §4).

Router prefix is ``/api/search`` (frozen in Wave 0), so the endpoint resolves
to ``GET /api/search/values?key=...``.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user, readable_team_ids
from db import get_connection
from search.autocomplete import build_values

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("/values", summary="Autocomplete values for a search DSL key")
def search_values(
    key: Annotated[str, Query(description="DSL key: team|domain|type|tag|status|date")],
    user=Depends(get_current_user),
) -> dict:
    """Return the candidate values for one DSL key as a tagged result.

    Response shape (api_contract §4)::

        {"key": str, "kind": "enum"|"free"|"date", "values": [{"value","label"}]}

    Read-scope (Wave 18): for a scoped read-only user the team/domain/tag value
    lists are filtered to their readable teams (via ``readable_team_ids``) so the
    autocomplete never leaks the names of out-of-scope teams, domains or tags.
    Admin / ``read_all`` (scope ``None``) get the full lists. The non-team-
    identifying keys (``status``, ``type``, ``date``) are unaffected.

    Raises:
        HTTPException: 422 when *key* is not one of the six DSL keys.
    """
    conn = get_connection()
    try:
        allowed = readable_team_ids(conn, user)
        return build_values(conn, key, allowed)
    except KeyError:
        raise HTTPException(status_code=422, detail=f"Unknown search key: {key}")
    finally:
        conn.close()
