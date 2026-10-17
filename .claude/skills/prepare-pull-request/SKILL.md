---
name: prepare-pull-request
description: Use when you are about to push a branch, open a pull request or write or edit a pull request body in this repository. Gives the handoff checklist - the checks to run for the packages you changed, the exact pull request body sections and the one checked Documentation impact line, the CHANGELOG entry, and the labels, assignee and milestone. Does not repeat the rules; it points to the files that hold them.
---

# Prepare a pull request

The rules live in the linked files; this page only orders the steps. If a link and this page disagree, the linked file wins.

## 1. Before you push

1. Run the full test suite of every workspace you changed, then the build and typecheck CI runs for the TypeScript you changed (`npm run build`, or `npm run build -w <package>` for one workspace; `apps/web` and `apps/admin` are the usual `tsc` surprises), then `npm run lint` at the root. A subset run does not authorize a push. Details and the `tsc`-only gotchas: [AGENTS.md, Tests](../../../AGENTS.md#tests).
2. If you touched Markdown, an agent instruction file, `standards/` or `docs/wiki/`, run `npm run docs:check`.
3. Run the gate again after your last change in the session.

## 2. CHANGELOG

When the change is operator-facing (a feature, a fix or a security change someone running Admitto would notice), add a bullet under `[Unreleased]` as part of the change, not at the end: one line in the imperative, about 25 words at most, ending with a link to the pull request (add the link once the pull request has a number). Chores, tests, CI and agent-instruction changes get none. Rules and the release steps: [AGENTS.md, Changelog and releases](../../../AGENTS.md#changelog-and-releases).

## 3. The pull request body

Use the headings of [.github/pull_request_template.md](../../../.github/pull_request_template.md) exactly: Description (business context and technical changes as separate paragraphs, describing the diff that shipped), How to test, What stays / known limitations, Documentation impact, Checklist.

`Documentation impact` keeps both option lines from the template and checks exactly one of them (delete neither): `Wiki updated` when `docs/wiki/` changed, otherwise `No Wiki update needed - <specific reason>`. A Checklist bullet that mentions the Wiki does not count. Why CI is strict about this: [standards/docs-and-wiki.md](../../../standards/docs-and-wiki.md).

Describe behaviour, never personal data: use synthetic `@example.com` addresses, no real names, no secrets, no model name.

## 4. Handoff

- Assignee `solarssk`, the current milestone if one exists, one `type:*` label, at least one `area:*` label, `prio:*` when obvious, and `security` when the change touches auth, access control, secrets or personal data. Format: [AGENTS.md, Pull requests](../../../AGENTS.md#pull-requests).
- A change to `AGENTS.md`, `CLAUDE.md`, `standards/`, `.claude/` or `.cursor/` is code for review purposes, not documentation; keep such a pull request small. Why: [AGENTS.md, Instruction files](../../../AGENTS.md#instruction-files).
- Say what you ran and whether it passed. If you did not run something, say so.
