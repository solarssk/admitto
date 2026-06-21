# Admitto — Claude Code Guidelines

## Versioning

Milestones follow semver logic:

* v0.x — development iterations, expected bugs and refactors
* v1.0 — first stable MVP: event-ready, tested, handed to operator
* v1.x+ — post-event features

**Product version** (what we tag and ship): `CHANGELOG.md` + git tag `v0.x.y` + root `package.json` `"version"`. Workspace packages stay at `0.0.1` — see [VERSIONING.md](VERSIONING.md).

**Active milestone:** v0.4.5+ — settings and session management; wallet passes → v0.5.

Repo: https://github.com/solarssk/admitto

## Planning before implementing

Before writing any code for a non-trivial task:

1. Read the relevant packages and existing patterns — do not assume, verify.
2. Propose a plan: what changes, in which files, in what order, and why.
3. For features that span more than ~3 packages or require a DB migration plus UI plus tests, propose splitting into sub-tasks (separate PRs or agents). Get alignment before starting.
4. Ask only when a decision blocks implementation or creates real risk. Do not ask about details you can decide yourself.

## Agent split guidelines

Split work into parallel or sequential agents when:

* The task crosses package boundaries and parts are independent (e.g. backend domain logic vs. frontend UI vs. tests).
* A sub-task produces an artifact another agent needs (e.g. API contract before UI).
* The total change would exceed a single reviewable PR (~400–600 lines diff is a soft ceiling).

Do **not** split when the context is small and sequential — overhead outweighs the benefit.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `security`  
Scope: package or app name — `auth`, `web`, `admin`, `db`, `tickets`, `mailer`, `import`, `crypto`, `ui`, `infra`, `ci`

Examples:
```
feat(auth): add trusted-device cookie revocation on MFA reset
fix(web): clamp check-in history limit to 1–100
chore(deps): bump undici 6.26.0 → 6.27.0
docs(changelog): standardize to Keep a Changelog 1.1.0
```

Breaking changes: add `!` after the scope and describe in the body.

## Branch naming

```
feature/<short-slug>
fix/<short-slug>
chore/<short-slug>
docs/<short-slug>
```

## Changelog

`CHANGELOG.md` follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

**When working on a feature PR:** add entries to the `[Unreleased]` section as you implement — not as a final step. Use the typed sections: `Added`, `Changed`, `Fixed`, `Security`, `Removed`, `Deprecated`. Keep entries user/operator-facing, not internal implementation detail.

**At release time:** move `[Unreleased]` entries to a new `## [0.x.y] - YYYY-MM-DD` section, update the comparison links at the bottom. See [VERSIONING.md](VERSIONING.md) for the full release checklist.

## Tests

Run the full test suite before committing:

```bash
npm test
```

If tests fail, fix them before committing — do not leave a broken test suite with a TODO. If a test cannot be fixed in the current PR scope, explain explicitly in the PR description under "What stays / known limitations".

Integration tests require a live Postgres database. Use `npm run db:test-setup` once per environment (see root `README.md`).

## Pull Requests

Every PR description must follow the repository template in `.github/pull_request_template.md`.

Required rules:

* keep the exact section structure:
  * `Description`
  * `How to test`
  * `What stays / known limitations`
  * `Checklist`
* do not replace those sections with custom headings
* if a checklist item does not apply, keep it and explain why instead of deleting it
* if tests were not run, say so plainly in both `How to test` and the checklist
* every PR must have labels before it is handed off for review
* every PR should be assigned to the intended milestone when that milestone already exists

Minimum PR metadata expectation:

* one `type:*` label
* at least one relevant `area:*` label
* a `prio:*` label when priority is clear from roadmap or security scope
* `security` for auth, secrets, access control, personal-data handling, or other security-sensitive changes
