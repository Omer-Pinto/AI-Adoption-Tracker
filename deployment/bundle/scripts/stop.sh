#!/usr/bin/env bash
# Stop the AI Adoption Tracker started by start.sh.
set -euo pipefail

BUNDLE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="$BUNDLE_ROOT/run/ai-tracker.pid"

if [[ ! -f "$PIDFILE" ]]; then
  echo "Not running (no pidfile)."
  exit 0
fi

PID="$(cat "$PIDFILE")"
if ! kill -0 "$PID" 2>/dev/null; then
  echo "Stale pidfile; process $PID not running. Cleaning up."
  rm -f "$PIDFILE"
  exit 0
fi

echo "==> Stopping pid $PID"
kill "$PID"
for _ in $(seq 1 20); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
if kill -0 "$PID" 2>/dev/null; then
  echo "    did not exit gracefully; sending SIGKILL"
  kill -9 "$PID" 2>/dev/null || true
fi
rm -f "$PIDFILE"
echo "Stopped."
