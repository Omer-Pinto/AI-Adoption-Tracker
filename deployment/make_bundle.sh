#!/usr/bin/env bash
# =============================================================================
# Build the AI Adoption Tracker AIR-GAP bundle.
#
# Run this on a machine WITH internet (and node_modules installed in
# src/frontend). It produces a single self-contained zip that installs and runs
# with NO network on the target box.
#
# Output: deployment/dist/ai-tracker-airgap-v<VERSION>.zip   (dist/ is gitignored)
# <VERSION> is read from the repo-root VERSION file (canonical project version).
#
# What it does (nothing here touches the running dev servers or the live DB):
#   1. Stage the backend source (app.py, db.py, models.py, schema.sql, routers,
#      llm/, reports/, search/) — EXCLUDING tracker.db*, tests, caches, and the
#      dangerous DEV-only seed.py.
#   2. Drop in serve.py (the single-process UI+API entrypoint).
#   3. Build the frontend (vite build) into web/  — static, no Node at runtime.
#   4. Vendor a Python wheelhouse for the TARGET platform (pip download).
#   5. Generate requirements.lock.txt from the vendored wheels.
#   6. Copy scripts, systemd template, env.example, docs, VERSION.
#   7. Zip it.
#
# IMPORTANT — target platform (DEFAULT: Rocky Linux 9.4 / x86_64 / CPython 3.11):
#   Wheels with C extensions (pydantic-core, jiter) are platform+python
#   specific. Rocky Linux 9.4 is the RHEL 9 family (glibc 2.34, x86_64). Both
#   manylinux_2_28 (RHEL 8 baseline, glibc 2.28) AND manylinux2014 (glibc 2.17)
#   wheels install and run cleanly there, so TARGET_PLATFORM defaults to BOTH
#   tags (space-separated) and pip picks whichever each dep actually publishes.
#   The app targets Python 3.11 (available on Rocky 9 via AppStream:
#   `dnf install -y python3.11 python3.11-pip`); the system python3 is 3.9.
#   If your box differs, override (TARGET_PLATFORM may be a space-separated list):
#       TARGET_PLATFORM="manylinux2014_aarch64" TARGET_PYVER=312 ./make_bundle.sh
#   The cleanest guarantee is to run this ON a machine matching the target's
#   OS/arch/python.
# =============================================================================
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
BACKEND_SRC="$REPO_ROOT/src/backend"
FRONTEND_SRC="$REPO_ROOT/src/frontend"
BUNDLE_TEMPLATE="$DEPLOY_DIR/bundle"

# --- Tunables ---------------------------------------------------------------
# DEFAULT target: Rocky Linux 9.4 (RHEL 9, glibc 2.34) / x86_64 / CPython 3.11.
# TARGET_PLATFORM is a SPACE-SEPARATED list of pip --platform tags; each is
# passed as its own --platform flag so every dep can resolve to whichever
# binary wheel it actually publishes (manylinux_2_28 OR manylinux2014). Both
# run on Rocky 9.4's glibc 2.34. Overridable.
TARGET_PLATFORM="${TARGET_PLATFORM:-manylinux_2_28_x86_64 manylinux2014_x86_64}"
TARGET_PYVER="${TARGET_PYVER:-311}"
PIP_IMPL="${PIP_IMPL:-cp}"   # cp = CPython
NAME="ai-tracker-airgap"

# Canonical project version comes from the repo-root VERSION file (single line).
# The release skill bumps it; the bundle name + stamped VERSION track it.
if [[ ! -f "$REPO_ROOT/VERSION" ]]; then
  echo "ERROR: repo-root VERSION file not found at $REPO_ROOT/VERSION" >&2
  exit 1
fi
VERSION="$(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"
if [[ -z "$VERSION" ]]; then
  echo "ERROR: $REPO_ROOT/VERSION is empty" >&2
  exit 1
fi

# Pinned top-level deps (transitive resolved automatically by pip download).
# Versions match what the project is developed against.
PINS=(
  "fastapi==0.121.2"
  "uvicorn==0.34.3"
  "openai==2.8.1"
  "anthropic==0.71.0"
  "pydantic==2.12.5"
)

# --- Staging ----------------------------------------------------------------
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ROOT="$STAGE/$NAME"
mkdir -p "$ROOT/app" "$ROOT/web" "$ROOT/wheels" "$ROOT/scripts" "$ROOT/systemd"

echo "==> [1/7] Staging backend source"
# Copy backend, excluding the live DB, caches, tests, and DEV-only seed.py.
RSYNC_EXCLUDES=(
  --exclude 'tracker.db' --exclude 'tracker.db-wal' --exclude 'tracker.db-shm'
  --exclude 'tracker.db.bak' --exclude '*.db'
  --exclude '__pycache__/' --exclude '*.pyc'
  --exclude '.pytest_cache/' --exclude 'tests/'
  --exclude 'seed.py' --exclude 'run.sh' --exclude 'pyproject.toml'
)
if command -v rsync >/dev/null 2>&1; then
  rsync -a "${RSYNC_EXCLUDES[@]}" "$BACKEND_SRC/" "$ROOT/app/"
else
  # Fallback without rsync: copy then prune.
  cp -R "$BACKEND_SRC/." "$ROOT/app/"
  rm -f  "$ROOT/app/tracker.db" "$ROOT/app/tracker.db-wal" "$ROOT/app/tracker.db-shm" \
         "$ROOT/app/tracker.db.bak" "$ROOT/app/seed.py" "$ROOT/app/run.sh" \
         "$ROOT/app/pyproject.toml"
  find "$ROOT/app" -name '__pycache__' -type d -prune -exec rm -rf {} +
  find "$ROOT/app" -name '*.pyc' -delete
  rm -rf "$ROOT/app/.pytest_cache" "$ROOT/app/tests"
fi

echo "==> [2/7] Adding serve.py entrypoint"
cp "$BUNDLE_TEMPLATE/serve.py" "$ROOT/app/serve.py"

echo "==> [3/7] Building frontend (vite build -> web/)"
if [[ ! -d "$FRONTEND_SRC/node_modules" ]]; then
  echo "ERROR: $FRONTEND_SRC/node_modules missing. Run 'npm install' there first." >&2
  exit 1
fi
( cd "$FRONTEND_SRC" && npx vite build --outDir "$ROOT/web" --emptyOutDir )

echo "==> [4/7] Vendoring Python wheelhouse"
echo "    target: platform=[$TARGET_PLATFORM] python=$TARGET_PYVER impl=$PIP_IMPL"
# Expand the space-separated TARGET_PLATFORM list into repeated --platform flags.
PLATFORM_ARGS=()
for _p in $TARGET_PLATFORM; do PLATFORM_ARGS+=(--platform "$_p"); done
# --only-binary=:all: forbids sdists outright: if any dep lacks a compatible
# binary wheel for the target, pip fails here LOUDLY (air-gap can't compile).
pip download --only-binary=:all: \
  "${PLATFORM_ARGS[@]}" \
  --python-version "$TARGET_PYVER" \
  --implementation "$PIP_IMPL" \
  "${PINS[@]}" \
  -d "$ROOT/wheels"

echo "==> [4b/7] Verifying wheelhouse is binary-only and target-compatible"
python3 - "$ROOT/wheels" "$TARGET_PYVER" <<'PY'
import sys, pathlib
wheels_dir = pathlib.Path(sys.argv[1])
pyver = sys.argv[2]  # e.g. "311"
all_files = sorted(p.name for p in wheels_dir.iterdir() if p.is_file())
non_whl = [f for f in all_files if not f.endswith(".whl")]
if non_whl:
    sys.exit(f"ERROR: non-wheel artifacts (sdists?) in wheelhouse: {non_whl}")
bad = []
compiled = []
for f in all_files:
    # <name>-<ver>-<pytag>-<abitag>-<platformtag>.whl
    tags = f[:-4].split("-")
    plat = tags[-1]
    abi = tags[-2]
    if plat == "any":
        continue  # pure-python wheel: runs anywhere
    compiled.append(f)
    # Binary wheel must be x86_64 manylinux and built for our cp<pyver>.
    if "x86_64" not in plat or "manylinux" not in plat:
        bad.append(f"{f}  (platform tag '{plat}' not manylinux x86_64)")
    elif f"cp{pyver}" not in abi and "abi3" not in abi:
        bad.append(f"{f}  (abi tag '{abi}' not cp{pyver}/abi3)")
if bad:
    sys.exit("ERROR: wheels incompatible with the Rocky 9.4 / cp%s target:\n  %s"
             % (pyver, "\n  ".join(bad)))
print(f"    ok: {len(all_files)} wheels, all binary-only "
      f"({len(compiled)} compiled: {', '.join(compiled) or 'none'})")
PY

echo "==> [5/7] Generating requirements.lock.txt from wheelhouse"
python3 - "$ROOT/wheels" "$ROOT/requirements.lock.txt" <<'PY'
import sys, pathlib, re
wheels = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
pins = []
for w in sorted(wheels.glob("*.whl")):
    # <name>-<version>-<pytag>-<abitag>-<platformtag>.whl
    name, version = w.name.split("-")[0], w.name.split("-")[1]
    pins.append(f"{name.replace('_','-')}=={version}")
out.write_text(
    "# Generated by make_bundle.sh from the vendored wheelhouse. Pinned.\n"
    + "\n".join(sorted(set(pins), key=str.lower)) + "\n"
)
print(f"    wrote {out.name} ({len(set(pins))} pins)")
PY

echo "==> [6/7] Copying scripts, systemd, docs, env, VERSION"
cp "$BUNDLE_TEMPLATE/scripts/"*.sh "$ROOT/scripts/"
chmod +x "$ROOT/scripts/"*.sh
cp "$BUNDLE_TEMPLATE/systemd/ai-tracker.service.template" "$ROOT/systemd/"
cp "$BUNDLE_TEMPLATE/env.example" "$ROOT/env.example"
# Stamp the template VERSION from the canonical repo-root VERSION (keep in sync),
# then ship it inside the bundle.
printf '%s\n' "$VERSION" > "$BUNDLE_TEMPLATE/VERSION"
cp "$BUNDLE_TEMPLATE/VERSION" "$ROOT/VERSION"
# Also place it next to the backend so app.py's _resolve_version() finds it as a
# sibling (app/VERSION) at runtime — this is what drives the version in the UI.
cp "$BUNDLE_TEMPLATE/VERSION" "$ROOT/app/VERSION"
# Operator-facing docs travel inside the bundle.
cp "$DEPLOY_DIR/README_HUMAN.md"  "$ROOT/README_HUMAN.md"
cp "$DEPLOY_DIR/DB_LIFECYCLE.md"  "$ROOT/DB_LIFECYCLE.md"
cp "$DEPLOY_DIR/UPGRADING.md"     "$ROOT/UPGRADING.md"

echo "==> [7/7] Zipping bundle"
mkdir -p "$DEPLOY_DIR/dist"
# Versioned name so older releases stay in dist/ for rollback. Only the
# same-version zip is overwritten; prior versions are left untouched.
OUT="$DEPLOY_DIR/dist/$NAME-v$VERSION.zip"
rm -f "$OUT"
# The internal top dir stays unversioned ("ai-tracker-airgap/") so the unzip /
# install / UPGRADING instructions are stable across versions.
( cd "$STAGE" && zip -rq "$OUT" "$NAME" )

echo
echo "Bundle built: $OUT"
echo "  size:    $(du -h "$OUT" | cut -f1)"
echo "  wheels:  $(ls "$ROOT/wheels" | wc -l | tr -d ' ')"
echo "  version: $(cat "$ROOT/VERSION")"
echo "  target:  Rocky Linux 9.4 / x86_64 / cp$TARGET_PYVER  (platforms: $TARGET_PLATFORM)"
echo
echo "Ship the zip to the air-gap box, then:"
echo "  unzip $NAME-v$VERSION.zip && cd $NAME"
echo "  ./scripts/install.sh"
echo "  cp env.example env && edit env"
echo "  ./scripts/start.sh"
