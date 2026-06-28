# README_CLAUDE — internal maintainer notes for the air-gap bundle

Audience: a future agent/maintainer of `deployment/`. How the bundle is built,
why it's shaped this way, the exact LLM code path, version pins, and gotchas.

## Source-of-truth principle

The bundle is built **without modifying any file under `src/`**. It composes on
top of the app:
- `deployment/bundle/serve.py` imports the existing `app` object from
  `src/backend/app.py` and adds a static mount. It does NOT edit app.py.
- Everything else is packaging (wheels, built FE, scripts, docs).

Anything that would require an actual source edit is written to
`RECOMMENDATIONS.md` for Omer to approve — never applied here.

## Layout

```
deployment/
  make_bundle.sh          # builds dist/ai-tracker-airgap-v<VERSION>.zip (reads root VERSION)
  bundle/                 # TEMPLATE files copied verbatim into the zip
    serve.py              # single-process UI+API entrypoint (composition, no src edit)
    env.example           # the 4 TRACKER_LLM_* vars + HOST/PORT
    VERSION
    scripts/{install,start,stop,backup_db,restore_db}.sh
    systemd/ai-tracker.service.template
  README_HUMAN.md         # operator guide  (also copied into the zip)
  README_CLAUDE.md        # this file       (NOT shipped in the zip)
  DB_LIFECYCLE.md         # backup/restore  (also copied into the zip)
  UPGRADING.md            # version upgrades (also copied into the zip)
  RECOMMENDATIONS.md      # source changes we did NOT make + known gaps
  dist/                   # gitignored build output (the zip)
```

Zip internal layout (`ai-tracker-airgap/`):
```
app/        backend source (rsync of src/backend minus DB/tests/caches/seed.py) + serve.py
web/        vite production build (static)
wheels/     vendored .whl files for the TARGET platform
scripts/    install/start/stop/backup_db/restore_db
systemd/    unit template
env.example, requirements.lock.txt, VERSION
README_HUMAN.md, DB_LIFECYCLE.md, UPGRADING.md
```

## How to (re)build

```bash
cd deployment
./make_bundle.sh                 # default target: Rocky Linux 9.4 / x86_64 / cp311
                                 #   (platforms: "manylinux_2_28_x86_64 manylinux2014_x86_64")
                                 #   version + zip name read from repo-root VERSION
# other target (TARGET_PLATFORM is a SPACE-SEPARATED list of pip --platform tags):
TARGET_PLATFORM="manylinux2014_aarch64" TARGET_PYVER=312 ./make_bundle.sh
```

`make_bundle.sh` reads the repo-root `VERSION` file, stamps `bundle/VERSION` from
it, and emits `dist/ai-tracker-airgap-v<VERSION>.zip`. Older versioned zips in
`dist/` are kept (rollback); only the same-version zip is overwritten. The zip's
internal top dir stays unversioned (`ai-tracker-airgap/`) so unzip/install steps
are stable across releases.

Requires (on the build machine, which HAS internet): `pip`, `npx`/node with
`src/frontend/node_modules` present, `zip`, and ideally `rsync`. The script:
1. rsyncs backend (excludes `tracker.db*`, `__pycache__`, `.pytest_cache`,
   `tests/`, `seed.py`, `run.sh`, `pyproject.toml`),
2. drops in `serve.py`,
3. `npx vite build --outDir <stage>/web --emptyOutDir` (does NOT touch
   `src/frontend/dist` or the running dev servers — vite dev serves from memory),
4. `pip download --only-binary=:all: --platform … [--platform …] --python-version … --implementation cp`
   (one `--platform` flag per tag in `TARGET_PLATFORM`), then verifies the
   wheelhouse is binary-only and target-compatible (no sdists; compiled wheels
   are manylinux x86_64 / cp311),
5. derives `requirements.lock.txt` from the wheel filenames,
6. copies scripts/docs, zips to `dist/`.

It never runs git, never touches the live DB, never binds :8000/:5173.

## Version pins (keep in sync with the app)

`make_bundle.sh` PINS (top-level; transitive auto-resolved by pip download):
```
fastapi==0.121.2  uvicorn==0.34.3  openai==2.8.1  anthropic==0.71.0  pydantic==2.12.5
```
These match the versions the project is developed against (verified via
`importlib.metadata`). The project's `src/backend/pyproject.toml` lists
`uvicorn[standard]`, but the bundle deliberately vendors **plain `uvicorn`**
(no uvloop/httptools/websockets) — the app doesn't need the extras, and plain
uvicorn means the only compiled wheels are `pydantic-core` and `jiter`, both of
which publish manylinux wheels. This maximizes cross-platform portability of the
wheelhouse. If you ever need the standard extras, add `uvicorn[standard]` to
PINS and re-verify all the extra compiled wheels exist for the target.

Transitive set at time of writing (23 wheels): annotated-doc, annotated-types,
anthropic, anyio, certifi, click, distro, docstring-parser, fastapi, h11,
httpcore, httpx, idna, jiter, openai, pydantic, pydantic-core, sniffio,
starlette, tqdm, typing-extensions, typing-inspection, uvicorn.

## Target platform — the #1 gotcha

`pydantic-core` and `jiter` ship platform+pyversion-specific wheels. The
DEFAULT build targets **Rocky Linux 9.4 / x86_64 / CPython 3.11**. Both ship as
`manylinux_2_17_x86_64.manylinux2014_x86_64` (glibc 2.17) wheels, which run on
Rocky 9.4's glibc 2.34; `TARGET_PLATFORM` lists `manylinux_2_28_x86_64` first
(preferred if a dep ever ships it) and `manylinux2014_x86_64` as the fallback,
and pip picks whichever each dep actually publishes. If the air-gap box is
different (arch or python minor version), set `TARGET_PLATFORM`/`TARGET_PYVER`,
or — most reliably — run `make_bundle.sh` on a machine matching the target. A
mismatch surfaces as `pip install` on the box failing to find a compatible
wheel. `install.sh` uses `--no-index` so it can NEVER silently reach the
internet to paper over a mismatch — it just fails loudly. Good.

## The LLM config code path (critical — an ai-engineer audits this next)

All LLM wiring is in `src/backend/llm/interface.py`. Env var names (exact):
```
TRACKER_LLM_PROVIDER   "openai" | "anthropic"     (required)
TRACKER_LLM_API_KEY    credential                 (required, must be non-empty)
TRACKER_LLM_MODEL      model name                 (required)
TRACKER_LLM_ENDPOINT   base URL override          (OPTIONAL; blank => SDK hosted default)
TRACKER_LLM_TIMEOUT    seconds                     (optional, default 120)
```
- `_load_config()` validates provider ∈ {openai, anthropic} and that key/model
  are non-empty; missing/blank → `LLMNotConfiguredError` → HTTP 503.
- `_optional_base_url()` returns the endpoint or `None`.
- OpenAI path (`_draft_openai`/`_extract_openai`): `OpenAI(api_key=…,
  base_url=…, timeout=…)` then `client.chat.completions.parse(model=…,
  messages=…, response_format=<PydanticModel>)`. Structured output via the SDK's
  native strict-schema parsing. `base_url` is passed straight to the SDK — for
  vLLM this is the `…/v1` root; the SDK appends `/chat/completions`.
- Anthropic path (`_draft_anthropic`/`_extract_anthropic`):
  `anthropic.Anthropic(api_key=…, base_url=…, timeout=…)` then
  `client.messages.create(…, tools=[{name, input_schema:
  Model.model_json_schema()}], tool_choice={"type":"tool","name":…})`. Reads the
  `tool_use` block's `.input`, validates against the Pydantic model.
  `max_tokens=4096` hard-coded. `base_url` passed straight to the SDK; it
  appends `/v1/messages`.

**vLLM compatibility caveats to flag (the deployment can't fully verify these
without the actual model):**
- OpenAI dialect: the code uses `chat.completions.parse` with
  `response_format=<pydantic>` → this asks the server for **strict structured
  outputs / json_schema response_format**. Not every vLLM build/model supports
  strict json_schema. If the local model/server doesn't, drafting will 502.
  vLLM's guided-decoding (outlines/xgrammar) generally supports json_schema, but
  confirm for the served model.
- Anthropic dialect: requires an Anthropic-compatible `/v1/messages` endpoint
  **with tool use / forced tool_choice**. vLLM's *native* server is OpenAI-shaped,
  not Anthropic — so `provider=anthropic` only works behind an Anthropic-shaped
  proxy that supports forced tool use. For a plain vLLM box, prefer
  `provider=openai`.

## How the frontend is served offline

`src/frontend/src/api.ts` uses `API_BASE = '/api'` (relative) and `fetch`.
Because `serve.py` serves the built UI and the API from the **same origin/port**,
relative `/api` resolves to the backend with no proxy and no CORS. The vite
build emits absolute `/assets/...` URLs (base `/`), which also resolve at the
origin root. `serve.py`'s catch-all returns the real static file if present,
else `index.html` (SPA fallback for client-side routes like `/teams/5`), while
`/api/*` is matched first by the routers registered in app.py.

## Things deliberately excluded from the bundle
- `tracker.db*` (Omer's data — never ship it),
- `seed.py` (DEV-only; it DELETES the DB),
- `tests/`, `__pycache__`, `.pytest_cache`, `pyproject.toml`, `run.sh`.

## Smoke-tested during authoring
- cross-platform wheel download (manylinux2014_x86_64 / cp311): 23 wheels, ok.
- `npx vite build` to a staging outDir: ok, didn't disturb :5173/:8000.
- (Not run here) full end-to-end on a Linux box — see RECOMMENDATIONS "validate
  on the real target".
