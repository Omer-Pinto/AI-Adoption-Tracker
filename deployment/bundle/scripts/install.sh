#!/usr/bin/env bash
# Offline installer for the AI Adoption Tracker air-gap bundle.
# Creates a Python venv and installs the vendored wheels WITHOUT touching the
# network. Safe to re-run (idempotent): it never touches the database.
set -euo pipefail

BUNDLE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$BUNDLE_ROOT/.venv"
WHEELS="$BUNDLE_ROOT/wheels"
LOCK="$BUNDLE_ROOT/requirements.lock.txt"

PYTHON_BIN="${PYTHON_BIN:-python3}"

echo "==> AI Adoption Tracker — offline install"
echo "    bundle : $BUNDLE_ROOT"
echo "    python : $($PYTHON_BIN --version 2>&1)"

if [[ ! -d "$WHEELS" ]]; then
  echo "ERROR: wheels/ not found at $WHEELS" >&2
  exit 1
fi

# Create the venv if missing. --without-pip then bootstrap from the vendored
# wheelhouse is overkill; the interpreter's bundled ensurepip is offline-safe.
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "==> Creating virtualenv at $VENV"
  "$PYTHON_BIN" -m venv "$VENV"
fi

# Install ONLY from the local wheelhouse. --no-index forbids any network access.
echo "==> Installing dependencies from local wheelhouse (no network)"
"$VENV/bin/python" -m pip install --no-index --find-links "$WHEELS" \
  --upgrade pip >/dev/null 2>&1 || true   # best-effort pip upgrade if a wheel is present
"$VENV/bin/python" -m pip install --no-index --find-links "$WHEELS" -r "$LOCK"

echo "==> Verifying imports"
"$VENV/bin/python" - <<'PY'
import fastapi, uvicorn, openai, anthropic, pydantic
print("    ok:",
      "fastapi", fastapi.__version__,
      "| uvicorn", uvicorn.__version__,
      "| openai", openai.__version__,
      "| anthropic", anthropic.__version__,
      "| pydantic", pydantic.VERSION)
PY

echo
echo "Install complete."
echo "Next:  cp env.example env  &&  edit env  &&  ./scripts/start.sh"
