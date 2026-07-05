# AGENTS.md — Admitto

Instructions for AI agents in this repository (Cursor, Claude Code, Codex, Copilot, and others).

Repo: https://github.com/solarssk/admitto  
**Active milestone:** see the open GitHub milestone and `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) — this file does not track it to avoid drift.  
**Product version:** git tag `v0.x.y` + root `package.json` + [CHANGELOG.md](CHANGELOG.md) — see [VERSIONING.md](VERSIONING.md).

## Project

Admitto is a self-hostable **internal event access gateway**: attendee import (CSV/XLSX, agency UUIDs), QR tickets, M365 mail, check-in for operators, admin tooling. Tabler-based staff SPA; OIDC-ready auth.

**Out of scope for MVP:** payments, public registration UI inside Admitto (first-event intake is MS Forms → `/api/ingest` in v0.5), full CRM, drag-and-drop mail builder, native `.pkpass` (PassCreator first).

## Working style

- Act as a senior full-stack engineer; prefer small, reviewable PRs.
- Make strong recommendations; ask only when a decision blocks implementation or creates real risk.
- After each step: what changed, how to test, what remains.
- Touch only what the task requires; match existing conventions.

## Security

- **Never** commit secrets, tokens, API keys, or real personal data.
- Use `.env.example` for required configuration; synthetic `@example.com` in seeds/samples.
- QR/token payloads must be non-guessable; avoid PII in QR unless explicitly required.
- Separate admin / operator / superadmin responsibilities; no unnecessary PII in logs.
- Check-in must prevent duplicate QR use; design for short retention after events.
- Add `security` label on PRs touching auth, access control, secrets, or personal data.

## Tests

```bash
npm test
```

Integration tests need Postgres — run `npm run db:test-setup` once per environment. For coverage reports (same tests + LCOV, matches CI):

```bash
npm run coverage
```

Do not commit with a broken suite unless the PR explicitly documents why.

## Commits and branches

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <description>`

**Types:** `feat` `fix` `chore` `docs` `refactor` `test` `perf` `security`  
**Scopes:** `auth` `web` `admin` `db` `tickets` `mailer` `import` `crypto` `ui` `infra` `ci`

**Branches:** `feature/<slug>` · `fix/<slug>` · `chore/<slug>` · `docs/<slug>`

Breaking changes: `!` after scope + description in commit body.

## Pull requests

Follow [.github/pull_request_template.md](.github/pull_request_template.md) exactly:

`Description` · `How to test` · `What stays / known limitations` · `Checklist`

`Description` covers **business context** (the real operator/admin/attendee problem, plain
language, no jargon) and **technical changes** (what changed in the code, by area) as separate
paragraphs — not blended. Describe the diff that actually shipped, not the original plan.

Before handoff: assignee @solarssk, current milestone when it exists, labels — one `type:*`, at least one `area:*`, `prio:*` when obvious.

## Changelog and releases

[CHANGELOG.md](CHANGELOG.md) follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

**During feature work:** add operator-facing bullets under `[Unreleased]` as you implement (`Added`, `Changed`, `Fixed`, `Security`, …). Not a final-step chore.

**Closing a milestone (`v0.x.y`):** follow [VERSIONING.md](VERSIONING.md) end-to-end. In short:

1. Move `[Unreleased]` → `## [0.x.y] - YYYY-MM-DD`; update comparison links.
2. Bump root `package.json` `"version"`.
3. **Before** the release commit: `python3 scripts/generate-release-notes.py 0.x.y "tagline"` then `python3 scripts/sync-release-docs.py` (and `npm install --package-lock-only` so `package-lock.json` matches).
4. One release commit: `CHANGELOG.md`, `package.json`, `package-lock.json`, synced docs, `.github/release-notes/v0.x.y.md`, `.github/release-notes/v0.x.y.title` (commit subject exactly `release: v0.x.y`).
5. **Merge the release PR** — Actions creates tag, GitHub Release (`v0.x.y — tagline`), triggers `publish-container`, and closes the milestone.

Local `./scripts/release-tag.sh` is emergency-only (signed tag). Do **not** use the deprecated v0.3.x emoji GitHub Release template.

## Admin SPA feedback (toast vs inline)

Staff UI uses `useToast()` from `@admitto/ui` (`ToastProvider` in the admin shell). Pick the surface by how long the user needs the message and whether it blocks the current task.

| Pattern | When | Examples |
|--------|------|----------|
| **Toast** | Transient outcome of an action the user just took; does not need a retry control | Save/test success, mutation API errors, import finished, wizard step saved |
| **Inline / `EmptyState`** | Initial page load failed or data is missing until the user retries | Attendees/Requirements load error with **Retry** |
| **`ConfirmDialog`** | Destructive or irreversible confirmation | Delete attendee, archive event — do not also toast the same message |
| **In-context inline** | Error is tied to a modal, form field, or overlay that already has focus | Check-in camera overlay (no-match → overlay message, not toast behind overlay); form field validation |

Toasts dedupe identical `message + variant`, cap at five, and sit below the check-in overlay (`--z-toast` &lt; `--z-overlay`). Prefer `renderWithToast()` in admin tests when asserting toast behavior.

## Compounding rules

When an agent repeats a mistake, add a precise rule here (or in a scoped `.cursor/rules/*.mdc` file). One line per gotcha; cut rules that no longer prevent real errors.

**Do not create new top-level `.md` documentation files in this repo.** This repo's doc set is
fixed: `README.md`, `CHANGELOG.md`, `SECURITY.md`, `VERSIONING.md`, `DATA-PROTECTION.md`,
`AGENTS.md`, `CLAUDE.md`, plus package-level `README.md` files and `docs/*` referenced from them.
If something doesn't fit an existing file, add a section to the closest one instead of starting a
new file. Avoid hardcoding "current milestone/version" callouts in prose here — point to
`CHANGELOG.md`'s `[Unreleased]` section or the open GitHub milestone instead, so this file can't
drift out of date.

## Claude Code

Claude-specific workflow (plan gate, split guidelines): [CLAUDE.md](CLAUDE.md).

## Cursor Cloud specific instructions

Notes for Cursor Cloud agents. The startup update script only runs `npm install`; everything
below is intentionally **not** in that script (services, env, one-off setup) and persists in the
VM snapshot. Standard build/run/test commands live in [README.md](README.md).

- **Node 24 required** (`engines`). nvm's default is set to 24, so fresh login shells use it. If
  `node -v` prints 22, run `nvm use 24` — the `/exec-daemon/node` shim is v22 and can precede nvm
  on `PATH` in non-login shells.
- **Postgres + Redis are native (no Docker).** Docker is not installed here; Postgres 16 and
  Redis 7 are installed via apt and are **not** auto-started. Start them each session:
  `sudo pg_ctlcluster 16 main start` and `sudo redis-server /etc/redis/redis.conf --daemonize yes`.
  Role/creds `admitto`/`admitto`, database `admitto`, and the `admitto_*_test` databases are
  already created + migrated + seeded in the snapshot. `infra/docker-compose.yml` is unused — the
  test-db scripts fall back to local `psql`/`createdb`.
- **Local env files (gitignored):** `packages/db/.env` and `apps/web/.env` hold the dev
  `DATABASE_URL`, a generated `ENCRYPTION_KEY`, and `REDIS_URL=redis://localhost:6379`. Recreate
  from the matching `.env.example` if missing.
- **Tests:** `npm test`. `apps/web` integration tests start a Testcontainers Redis unless
  `REDIS_URL` is set; since Docker is absent, `export REDIS_URL=redis://localhost:6379` before
  `npm test` so they use the native Redis.
- **Run the app:** `npm run build -w @admitto/admin` once, then `npm run dev -w @admitto/web`
  serves the SPA at http://localhost:3000 (`/admin` after login). For SPA hot-reload also run
  `npm run dev -w @admitto/admin` (Vite :5173, proxies API to :3000).
- **First login needs MFA:** admin/superadmin roles must enroll TOTP on first login. Bootstrap a
  new superadmin with `npm run auth:bootstrap -- --email you@example.com` (password read from
  stdin); you will be prompted to enrol TOTP on first login. To clear an existing account's TOTP
  (e.g. the snapshot's pre-seeded account), run
  `npm run cli -w @admitto/auth -- reset-mfa --email you@example.com`.
