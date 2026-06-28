#!/usr/bin/env bash
# Start the AI Adoption Tracker (single process: UI + /api on one port).
# Runs in the background, writes a pidfile, and logs to logs/.
set -euo pipefail

BUNDLE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$BUNDLE_ROOT/.venv"
APP_DIR="$BUNDLE_ROOT/app"
WEB_DIR="$BUNDLE_ROOT/web"
ENV_FILE="${TRACKER_ENV_FILE:-$BUNDLE_ROOT/env}"
RUN_DIR="$BUNDLE_ROOT/run"
LOG_DIR="$BUNDLE_ROOT/logs"
PIDFILE="$RUN_DIR/ai-tracker.pid"

mkdir -p "$RUN_DIR" "$LOG_DIR"

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "ERROR: venv missing. Run ./scripts/install.sh first." >&2
  exit 1
fi

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Already running (pid $(cat "$PIDFILE"))." >&2
  exit 0
fi

# Load operator config (LLM vars + HOST/PORT). 'set -a' exports everything.
if [[ -f "$ENV_FILE" ]]; then
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
else
  echo "WARNING: $ENV_FILE not found — starting without LLM config." >&2
  echo "         (report drafting will return 503 until you create it.)" >&2
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8080}"
export TRACKER_WEB_DIR="${TRACKER_WEB_DIR:-$WEB_DIR}"

echo "==> Starting on http://$HOST:$PORT  (data: $APP_DIR/tracker.db)"
cd "$APP_DIR"
nohup "$VENV/bin/python" -m uvicorn serve:app \
  --host "$HOST" --port "$PORT" \
  >>"$LOG_DIR/ai-tracker.log" 2>&1 &
echo $! >"$PIDFILE"

sleep 1
if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Started (pid $(cat "$PIDFILE")). Logs: $LOG_DIR/ai-tracker.log"
else
  echo "ERROR: process exited immediately. See $LOG_DIR/ai-tracker.log" >&2
  exit 1
fi
