#!/usr/bin/env bash
# Launch the AI Adoption Tracker backend.
# Runs from this directory so the flat-layout modules (app, db, models) import cleanly.
set -euo pipefail
cd "$(dirname "$0")"
exec uvicorn app:app --reload --host 127.0.0.1 --port 8000
