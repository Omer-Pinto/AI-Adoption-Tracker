#!/usr/bin/env bash
# Start the AI Adoption Tracker — backend + frontend in one command.
#
# Usage:
#   ./scripts/dev.sh
#
# Prerequisites:
#   - Python env with fastapi + uvicorn installed (see src/backend/pyproject.toml)
#   - Node dependencies installed: cd src/frontend && npm install
#
# Stop: press Ctrl-C once; both processes share the same process group so the
# shell trap below kills them together.  If you killed only the shell, run:
#   kill $(lsof -ti:8000) $(lsof -ti:5173) 2>/dev/null || true

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/src/backend"
FRONTEND_DIR="$REPO_ROOT/src/frontend"

# Trap Ctrl-C: kill the whole process group so both child processes exit.
trap 'echo; echo "[dev] stopping..."; kill 0' INT TERM EXIT

echo "[dev] starting backend  (http://127.0.0.1:8000) ..."
cd "$BACKEND_DIR"
uvicorn app:app --reload --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

echo "[dev] starting frontend (http://localhost:5173) ..."
cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!

echo "[dev] both processes running — press Ctrl-C to stop"
echo "[dev]   backend  PID=$BACKEND_PID"
echo "[dev]   frontend PID=$FRONTEND_PID"

# Wait for all background jobs to finish; trap above handles Ctrl-C cleanup.
wait
