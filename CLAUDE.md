# Admitto — Claude Code Guidelines

Repo: https://github.com/solarssk/admitto  
Active milestone: **v0.4.5+** — settings and session management; wallet passes → v0.5.  
Product version: git tag `v0.x.y` + root `package.json` + `CHANGELOG.md` — see [VERSIONING.md](VERSIONING.md).

---

## 1. Plan before coding

**Read first. Propose a plan. Get alignment before writing a line.**

- Read the relevant packages and existing patterns — do not assume, verify.
- State what you will change, in which files, in what order, and why.
- If the task spans more than ~3 packages or needs a DB migration + UI + tests, propose a split into sub-tasks and get confirmation before starting.
- Ask only when a decision blocks implementation or creates real risk. Decide small things yourself.

**The test:** Could a reviewer predict every file in your diff from your plan? If not, the plan isn't specific enough.

---

## 2. Simplicity first

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No error handling for scenarios that cannot happen.
- No backwards-compatibility shims unless explicitly required.
- If you wrote 300 lines and 100 would do — rewrite it.

**The test:** Would a senior engineer say this is overcomplicated? If yes, simplify.

---

## 3. Surgical changes

**Touch only what you must. Clean up only your own mess.**

- Do not "improve" adjacent code, comments, or formatting while fixing something else.
- Do not refactor code that is not broken.
- Match existing style even if you would do it differently.
- If you notice unrelated dead code, mention it in the PR — do not delete it.
- Remove only the imports and variables that **your** changes made unused.

**The test:** Every changed line should trace directly to the task. If it doesn't, revert it.

---

## 4. Split when it pays off

**A 600-line diff across 5 packages is not one task — it's three.**

Split into sequential or parallel sub-tasks when:
- Parts are independently testable and do not break the build between steps.
- A sub-task produces an artifact (schema, API contract, types) that another depends on.
- The total diff would exceed ~500 lines across multiple packages.

Do **not** split when sub-tasks are tightly coupled or coordination overhead exceeds implementation time.

When splitting, state the plan explicitly and get alignment before starting:
```text
1. Domain logic + migration  →  verify: unit tests pass
2. API routes                →  verify: integration tests pass, no regression
3. Frontend UI               →  verify: manual smoke, existing UI unchanged
```

---

## 5. Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <description>`

**Types:** `feat` `fix` `chore` `docs` `refactor` `test` `perf` `security`  
**Scopes:** `auth` `web` `admin` `db` `tickets` `mailer` `import` `crypto` `ui` `infra` `ci`

```text
feat(auth): add trusted-device cookie revocation on MFA reset
fix(web): clamp check-in history limit to 1–100
chore(deps): bump undici 6.26.0 → 6.27.0
```

Breaking changes: add `!` after scope and describe in the commit body.

---

## 6. Branch naming

```text
feature/<short-slug>    fix/<short-slug>
chore/<short-slug>      docs/<short-slug>
```

---

## 7. Changelog

`CHANGELOG.md` follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

Add entries to `[Unreleased]` **as you implement** — not as a final step. Use typed sections: `Added`, `Changed`, `Fixed`, `Security`, `Removed`, `Deprecated`. Write for operators, not implementation internals.

At release time: move `[Unreleased]` to `## [0.x.y] - YYYY-MM-DD` and update the comparison links at the bottom. Full checklist: [VERSIONING.md](VERSIONING.md).

---

## 8. Tests

Run the full suite before committing:

```bash
npm test
```

If tests fail, fix them — do not leave a broken suite with a TODO. If a fix is out of scope for the current PR, say so explicitly in "What stays / known limitations".

Integration tests need a live Postgres instance. Run `npm run db:test-setup` once per environment.

---

## 9. Pull Requests

Every PR must follow `.github/pull_request_template.md` — keep its four sections exactly:  
`Description` · `How to test` · `What stays / known limitations` · `Checklist`

Required labels before handoff:
- one `type:*` label
- at least one `area:*` label
- `prio:*` when priority is clear from roadmap or security scope
- `security` for auth, secrets, access control, or personal data handling

Assign to the current milestone when it exists. Assign to @solarssk.
