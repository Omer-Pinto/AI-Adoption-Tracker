# AI Adoption Tracker — Air-Gap Install & Operation (for Omer)

This is the operator guide for running the tracker on an on-prem box with **no
internet**. Everything it needs is inside `ai-tracker-airgap.zip`: the backend,
the pre-built web UI, and all Python dependencies as offline wheels. The only
thing you provide is a locally-served LLM (vLLM) and one API key.

The whole app runs as **one process on one port** (default `8080`) that serves
both the web UI and the `/api` backend. No Node, no reverse proxy, no CDN.

---

## 0. Prerequisites on the air-gap box

- **Python 3.11** (with `venv`/`pip` — standard on most distros). If your box
  has a different Python (e.g. 3.12), the bundle must be built for it — see
  README_CLAUDE.md "Target platform".
- **`sqlite3` CLI** — used by the backup script. `which sqlite3` should work.
- **`unzip`**, **`gzip`** — standard.
- A reachable **vLLM** server on the LAN (OpenAI- or Anthropic-compatible).

---

## 1. Install (one time)

```bash
unzip ai-tracker-airgap.zip
cd ai-tracker-airgap
./scripts/install.sh          # creates .venv, installs vendored wheels — NO network
```

`install.sh` is safe to re-run and never touches your data.

---

## 2. Configure the LLM (and port)

```bash
cp env.example env
chmod 600 env
nano env
```

You set **exactly four** LLM variables (the real names read by the backend in
`llm/interface.py`). They differ slightly by provider:

| Variable | What to set | OpenAI dialect | Anthropic dialect |
|---|---|---|---|
| `TRACKER_LLM_PROVIDER` | wire format | `openai` | `anthropic` |
| `TRACKER_LLM_ENDPOINT` | vLLM base URL, **no trailing slash** | `http://gpu-host:8000/v1` | `http://gpu-host:8000` |
| `TRACKER_LLM_API_KEY` | credential (sent as `Authorization: Bearer` for openai, `x-api-key` for anthropic) | your vLLM key, or any non-empty string | same |
| `TRACKER_LLM_MODEL` | model name **exactly** as vLLM serves it | e.g. `mistralai/Mistral-7B-Instruct-v0.3` | e.g. `claude-…` served name |

Notes that matter:
- **`ENDPOINT` is a base URL only.** The SDK appends the path itself
  (`/chat/completions` for openai, `/v1/messages` for anthropic). For a vLLM
  OpenAI server the base URL normally ends in `/v1`.
- **On an air-gap box `ENDPOINT` is effectively REQUIRED.** It is technically
  optional in code, but if you leave it blank while the other three vars are
  set, the SDK falls back to its *public* default (`api.openai.com` /
  `api.anthropic.com`), which is unreachable here — you'll get a confusing
  **502** (connection failure), NOT a clean 503. Always set it.
- **`API_KEY` must be non-empty even if vLLM has no auth** — use any string
  (e.g. `local`). A blank value makes the draft endpoint return 503.
- Optional `TRACKER_LLM_TIMEOUT` (seconds, default 120) — raise it for slow
  hardware.
- **Which dialect does your vLLM speak?** vLLM's standard server is
  **OpenAI-compatible** → use `provider=openai`. Only pick `anthropic` if you
  put an Anthropic-compatible front-end (or a proxy like LiteLLM in Anthropic
  mode) in front of it.

Server vars in the same file:
- `HOST` — `0.0.0.0` (reachable from the LAN) or `127.0.0.1` (local only).
- `PORT` — the single UI+API port (default `8080`).

> The LLM is only needed for **drafting reports** and **extracting domains**.
> Everything else (teams, domains, tasks, artifacts, editing saved reports,
> search) works even with no LLM configured.

---

## 3. Start / stop

```bash
./scripts/start.sh     # background; logs -> logs/ai-tracker.log
./scripts/stop.sh
```

Then open **`http://<box-ip>:8080`** in a browser on the LAN.

For an always-on service, use the systemd template instead — see
`systemd/ai-tracker.service.template` (it supervises the process and restarts on
failure). Don't run both start.sh and systemd at once.

---

## 4. Verify it works

```bash
curl -s http://localhost:8080/api/health         # -> {"status":"ok"}
curl -sI http://localhost:8080/ | head -1        # -> HTTP/1.1 200 OK  (the UI)
```

Then in the browser, create a team + champion + a domain, paste meeting notes,
and click draft. If drafting returns an error:
- **503** = LLM not configured → a required var (`PROVIDER`/`API_KEY`/`MODEL`)
  is missing or blank → check the four `TRACKER_LLM_*` vars in `env`, restart.
- **502** = LLM configured but the call failed. Read `logs/ai-tracker.log`; the
  wrapped error tells you which of the three it is:
  - *connection refused / timeout / DNS* → `ENDPOINT` wrong or unreachable
    (also the symptom of a **blank** ENDPOINT — see §2). Test:
    `curl $TRACKER_LLM_ENDPOINT/models` for an OpenAI vLLM.
  - *HTTP 401* → `API_KEY` wrong.
  - *HTTP 404 "model not found"* → `MODEL` ≠ your vLLM `--served-model-name`.
  - *everything reachable but still 502* → your vLLM build/model may not support
    **strict json-schema structured outputs**; upgrade vLLM or enable guided
    decoding (the app requires structured output to parse the report).

---

## 5. Your data — back it up

The database is a single file: **`app/tracker.db`** (plus `-wal`/`-shm`
sidecars while running). It accumulates forever and is the whole point of the
tool. **Read `DB_LIFECYCLE.md`** and set up the backup cron:

```bash
./scripts/backup_db.sh          # safe hot snapshot incl. WAL -> backups/*.db.gz
```

To ship a new version of the product without losing data, follow
`UPGRADING.md` (backup → staging port → verify → switch/rollback). **Never**
delete `tracker.db` in production.

---

## Ports summary

| Port | What |
|---|---|
| `8080` (this bundle, configurable) | UI **and** `/api` — the only port users hit |
| `8100` (suggested) | staging instance during upgrades (see UPGRADING.md) |
| your vLLM port (e.g. `8000`) | the LLM server you run separately |
