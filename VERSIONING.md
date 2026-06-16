# Versioning

Admitto uses **one product version** for releases. Internal workspace packages are not versioned independently.

## Source of truth (product)

| What | Where |
|------|--------|
| **Release number** | Git tag `v0.x.y` on `main` |
| **Human-readable history** | [`CHANGELOG.md`](CHANGELOG.md) |
| **Tracked in repo** | Root [`package.json`](package.json) `"version"` — bumped when cutting a release |

GitHub **milestones** (`v0.3.6`, `v0.4.0`, …) group PRs toward the next tag; milestone title matches the upcoming product version.

## Workspace packages (`0.0.1`)

Every `packages/*` and `apps/web` `package.json` keeps `"version": "0.0.1"`. That is intentional:

- packages are `private: true` and linked with `"@admitto/foo": "*"`
- they are not published to npm
- only the **monorepo product version** matters for operators and release notes

Do not bump per-package versions unless we start publishing libraries separately.

## Cutting a release

1. Move `CHANGELOG.md` items from `Unreleased` → `## v0.x.y — date`
2. Set root `package.json` `"version"` to `0.x.y` (no `v` prefix)
3. Commit, tag `v0.x.y`, push tag
4. Close the matching GitHub milestone

**Container image:** pushing git tag `v0.x.y` also publishes `ghcr.io/solarssk/admitto:0.x.y` (see `deploy/README.md`).

Runtime (`/healthz`, Docker labels) does not expose version yet — by design until we need operator-facing build info.
