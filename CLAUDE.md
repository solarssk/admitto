# Admitto — Claude Code Guidelines

## Versioning

Milestones follow semver logic:

* v0.x — development iterations, expected bugs and refactors
* v1.0 — first stable MVP: event-ready, tested, handed to operator
* v1.x+ — post-event features

**Product version** (what we tag and ship): `CHANGELOG.md` + git tag `v0.x.y` + root `package.json` `"version"`. Workspace packages stay at `0.0.1` — see [VERSIONING.md](VERSIONING.md).

**Active milestone:** v0.3.6 — production Docker deployment (Dockerfile, `deploy/` compose, reverse proxy; ADR 0018).

Repo: https://github.com/solarssk/admitto

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
