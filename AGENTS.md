# AGENTS.md — Admitto

Instructions for AI agents in this repository (Cursor, Claude Code, Codex, Copilot, and others).

Repo: https://github.com/solarssk/admitto  
**Active milestone:** v0.5 — wallet passes (PassCreator). Product line **v0.4.7** closes settings/overview/requirements/import hardening.  
**Product version:** git tag `v0.x.y` + root `package.json` + [CHANGELOG.md](CHANGELOG.md) — see [VERSIONING.md](VERSIONING.md).

## Project

Admitto is a self-hostable **internal event access gateway**: attendee import (CSV/XLSX, agency UUIDs), QR tickets, M365 mail, check-in for operators, admin tooling. Tabler-based staff SPA; OIDC-ready auth.

**Out of scope for MVP:** payments, public registration UI inside Admitto (first-event intake is MS Forms → `/api/ingest` in v0.6), full CRM, drag-and-drop mail builder, native `.pkpass` (PassCreator first).

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

Integration tests need Postgres — run `npm run db:test-setup` once per environment. Do not commit with a broken suite unless the PR explicitly documents why.

## Commits and branches

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <description>`

**Types:** `feat` `fix` `chore` `docs` `refactor` `test` `perf` `security`  
**Scopes:** `auth` `web` `admin` `db` `tickets` `mailer` `import` `crypto` `ui` `infra` `ci`

**Branches:** `feature/<slug>` · `fix/<slug>` · `chore/<slug>` · `docs/<slug>`

Breaking changes: `!` after scope + description in commit body.

## Pull requests

Follow [.github/pull_request_template.md](.github/pull_request_template.md) exactly:

`Description` · `How to test` · `What stays / known limitations` · `Checklist`

Before handoff: assignee @solarssk, current milestone when it exists, labels — one `type:*`, at least one `area:*`, `prio:*` when obvious.

## Changelog and releases

[CHANGELOG.md](CHANGELOG.md) follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

**During feature work:** add operator-facing bullets under `[Unreleased]` as you implement (`Added`, `Changed`, `Fixed`, `Security`, …). Not a final-step chore.

**Closing a milestone (`v0.x.y`):** follow [VERSIONING.md](VERSIONING.md) end-to-end. In short:

1. Move `[Unreleased]` → `## [0.x.y] - YYYY-MM-DD`; update comparison links.
2. Bump root `package.json` `"version"`.
3. **Before** the release commit: `python3 scripts/generate-release-notes.py 0.x.y` then `python3 scripts/sync-release-docs.py` (and `npm install --package-lock-only` so `package-lock.json` matches).
4. One release commit: `CHANGELOG.md`, `package.json`, `package-lock.json`, synced docs, `.github/release-notes/v0.x.y.md` (commit subject `release: v0.x.y`).
5. **Merge the release PR** — Actions creates tag, GitHub Release, and closes the milestone; `publish-container` pushes the image on tag.

Local `./scripts/release-tag.sh` is emergency-only (signed tag). Do **not** use the deprecated v0.3.x emoji GitHub Release template.

## Compounding rules

When an agent repeats a mistake, add a precise rule here (or in a scoped `.cursor/rules/*.mdc` file). One line per gotcha; cut rules that no longer prevent real errors.

## Claude Code

Claude-specific workflow (plan gate, split guidelines): [CLAUDE.md](CLAUDE.md).
