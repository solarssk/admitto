# Claude Code — Admitto

@AGENTS.md

Rules below are **Claude Code–specific** (planning gate, session workflow). Shared project rules live in `AGENTS.md`.

---

## 1. Plan before coding

**Read first. Propose a plan. Get alignment before writing a line.**

- Read the relevant packages and existing patterns — do not assume, verify.
- State what you will change, in which files, in what order, and why.
- If the task spans more than ~3 packages or needs a DB migration + UI + tests, propose a split and get confirmation before starting.
- Ask only when a decision blocks implementation or creates real risk.

**The test:** Could a reviewer predict every file in your diff from your plan? If not, the plan isn't specific enough.

---

## 2. Simplicity first

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No error handling for scenarios that cannot happen.
- If you wrote 300 lines and 100 would do — rewrite it.

**The test:** Would a senior engineer say this is overcomplicated? If yes, simplify.

---

## 3. Surgical changes

**Touch only what you must. Clean up only your own mess.**

- Do not "improve" adjacent code while fixing something else.
- Match existing style; mention unrelated dead code in the PR — do not delete it.
- Remove only imports/variables **your** changes made unused.

**The test:** Every changed line should trace directly to the task.

---

## 4. Split when it pays off

Split when parts are independently testable, a sub-task produces an artifact others need, or the diff would exceed ~500 lines across packages.

Do **not** split when sub-tasks are tightly coupled.

```text
1. Domain logic + migration  →  verify: unit tests pass
2. API routes                →  verify: integration tests pass
3. Frontend UI               →  verify: manual smoke
```

---

## 5. Compounding engineering

When Claude makes a mistake in this repo: **update `AGENTS.md`** (project-wide) or this file (Claude-only workflow). Prefer `AGENTS.md` for gotchas that any agent should follow.
