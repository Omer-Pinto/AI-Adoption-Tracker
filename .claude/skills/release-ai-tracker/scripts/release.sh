#!/usr/bin/env bash
# Cut a release of the AI Adoption Tracker: bump VERSION, rebundle the air-gap
# zip, and write a release note. Deterministic so the skill doesn't hand-roll it.
#
# Usage:
#   release.sh --type new|update --bump major|minor|patch [--version X.Y.Z]
#
# --version (explicit) wins over --bump. --type only shapes the release note
# (FRESH INSTALL vs UPGRADE), not the number.
set -euo pipefail

TYPE="" ; BUMP="" ; EXPLICIT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)    TYPE="${2:-}"; shift 2;;
    --bump)    BUMP="${2:-}"; shift 2;;
    --version) EXPLICIT="${2:-}"; shift 2;;
    *) echo "ERROR: unknown argument '$1'" >&2; exit 2;;
  esac
done

case "$TYPE" in
  new|update) ;;
  *) echo "ERROR: --type must be 'new' or 'update' (got '${TYPE:-<empty>}')" >&2; exit 2;;
esac

REPO="$(git rev-parse --show-toplevel)"
VFILE="$REPO/VERSION"
[[ -f "$VFILE" ]] || { echo "ERROR: no VERSION file at $VFILE" >&2; exit 1; }
CUR="$(tr -d '[:space:]' < "$VFILE")"
[[ "$CUR" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERROR: current VERSION '$CUR' is not X.Y.Z" >&2; exit 1; }

if [[ -n "$EXPLICIT" ]]; then
  NEW="$EXPLICIT"
else
  case "$BUMP" in
    major|minor|patch) ;;
    *) echo "ERROR: --bump must be major|minor|patch when --version is omitted" >&2; exit 2;;
  esac
  IFS=. read -r MA MI PA <<< "$CUR"
  case "$BUMP" in
    major) NEW="$((MA+1)).0.0";;
    minor) NEW="${MA}.$((MI+1)).0";;
    patch) NEW="${MA}.${MI}.$((PA+1))";;
  esac
fi

[[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERROR: computed version '$NEW' is not X.Y.Z" >&2; exit 2; }

echo "==> Release: $CUR -> $NEW (type=$TYPE)"
printf '%s\n' "$NEW" > "$VFILE"

echo "==> Rebundling air-gap zip (deployment/make_bundle.sh) ..."
"$REPO/deployment/make_bundle.sh"

DIST="$REPO/deployment/dist"
ZIP="ai-tracker-airgap-v$NEW.zip"
NOTE="$DIST/RELEASE-v$NEW.txt"

if [[ ! -f "$DIST/$ZIP" ]]; then
  echo "ERROR: expected $DIST/$ZIP was not produced — bundle failed; not writing a release note." >&2
  exit 1
fi

if [[ "$TYPE" == "new" ]]; then
  KIND="FRESH INSTALL"
  GUIDE=$'This is a first-time / standalone install. Follow README_HUMAN.md inside\nthe zip, section 1 (Install) onward. There is no prior data to preserve.'
else
  KIND="UPGRADE"
  GUIDE=$'This is an upgrade of an existing deployment. Follow UPGRADING.md inside\nthe zip: BACK UP the database first, install side-by-side, run on the staging\nport to verify, then switch the live instance (and roll back to the prior\nversioned zip if anything is wrong). NEVER delete tracker.db.'
fi

cat > "$NOTE" <<EOF
AI Adoption Tracker — Release v$NEW
====================================
Type:    $KIND
Bundle:  $ZIP   (in this folder)
Bumped:  $CUR -> $NEW

$GUIDE

Copy BOTH this file and $ZIP to the air-gap box.
Inside the zip, README_HUMAN.md is the only file you must read to operate it.
EOF

echo ""
echo "Release v$NEW ready:"
echo "  zip:  $DIST/$ZIP"
echo "  note: $NOTE"
echo ""
echo "Next: review, then commit the bump ->  git add VERSION && git commit -m \"Release v$NEW\""
