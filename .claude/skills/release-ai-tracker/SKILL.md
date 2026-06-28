---
name: release-ai-tracker
description: >-
  Cut a release of the AI Adoption Tracker — bump the project version, rebuild
  the air-gap deployment zip, and write a release note. Use this whenever Omer
  wants to ship/cut/make a release, bump the version (major/minor/patch),
  re-bundle the air-gap zip, prepare a new version for the air-gap system, or
  produce a fresh-install vs upgrade build. Trigger even if he just says
  "release 1.1.0" or "rebundle for air-gap" without naming this skill.
---

# release-ai-tracker

Cuts a versioned release: bumps the canonical `VERSION`, regenerates the
versioned air-gap zip via `deployment/make_bundle.sh`, and writes a release
note that tells the operator whether this build is a fresh install or an
upgrade. The running version is shown in the app UI (sidebar footer) and at
`GET /api/health`, so the bump is what makes "which build is live" truthful.

## Parameters

Parse these from the user's request (e.g. `/release-ai-tracker type=update bump=minor`
or "cut a fresh 1.0.0 release"):

| Param | Required | Values | Meaning |
|-------|----------|--------|---------|
| `type` | **yes** | `new` \| `update` | `new` → release note says **FRESH INSTALL** (points at README_HUMAN install steps). `update` → **UPGRADE** (points at UPGRADING.md: back up → staging → switch/rollback). Affects only the note, not the number. |
| `bump` | **yes** (unless `version` given) | `major` \| `minor` \| `patch` | How to bump the current version. `major`=X+1.0.0, `minor`=X.Y+1.0, `patch`=X.Y.Z+1. |
| `version` | optional | `X.Y.Z` | Explicit version, overrides `bump`. Use this for the first real release (`type=new version=1.0.0`) so the number is exact, not computed. |

If a required param is missing, ask for it — don't guess. If `type=new` and no
explicit `version` while the current version is still `0.x`, suggest
`version=1.0.0` and confirm before proceeding (a first release is a deliberate
choice, not a mechanical bump).

## Procedure

1. Read the current version: `cat VERSION` (repo root).
2. Work out the new version from the params (explicit `version` wins; else apply
   `bump`). **State "current X → new Y (type=…)" and confirm with the user before
   writing** — a release is significant and the number is hard to walk back once
   bundled.
3. Run the bundled script, which does the bump + rebundle + note atomically:
   ```bash
   .claude/skills/release-ai-tracker/scripts/release.sh --type <type> --bump <bump> [--version X.Y.Z]
   ```
   It writes the new `VERSION`, runs `deployment/make_bundle.sh` (which reads
   `VERSION`, stamps the bundle, and emits `deployment/dist/ai-tracker-airgap-v<new>.zip`
   — prior versioned zips are kept for rollback), and writes
   `deployment/dist/RELEASE-v<new>.txt`.
4. Report the two artifact paths (zip + note) and the new version.
5. Offer to commit the version bump: `git add VERSION && git commit -m "Release v<new>"`.
   The zip lives under the gitignored `deployment/dist/`, so it is never
   committed — the operator copies the zip + the `RELEASE-*.txt` to the air-gap box.

## Notes

- **Never delete prior zips** in `deployment/dist/` — older versions are the
  rollback path that UPGRADING.md depends on. The script only overwrites the
  same-version file.
- **Never touch `src/backend/tracker.db`** — releases don't go near data.
- The script is the source of truth for the mechanics; SKILL.md just frames the
  params and the confirm-before-bump safety. If `make_bundle.sh` fails (e.g. a
  dependency has no Rocky-compatible wheel), surface the error — do not paper
  over it; a half-built bundle must not ship.
