# Contributing to Admitto

Thanks for your interest in Admitto. This document covers the practical steps for
proposing a change. Full project conventions (branch/commit rules, PR structure,
testing gates, release process) live in [AGENTS.md](../AGENTS.md); this file is a
quick-start on top of it, not a replacement.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- For anything beyond a small fix, open an issue first to discuss the approach.
  This avoids wasted work on changes that don't fit the project's scope.
- Search existing issues before opening a new one; someone may already be on it.
- Found a security vulnerability? Do **not** open a public issue. Follow
  [SECURITY.md](../SECURITY.md) instead.

## Ways to contribute

| Type | Where to start |
|------|-----------------|
| Bug report | Open a [Bug report](https://github.com/solarssk/admitto/issues/new?template=bug.yml) issue. Include the product version, reproduction steps, and expected vs. actual behaviour. Strip secrets, tokens, and attendee personal data from any logs first. |
| Feature request / task | Open a [Task](https://github.com/solarssk/admitto/issues/new?template=task.yml) issue with goal, scope, and acceptance criteria. |
| Code change | Fork or branch, then open a pull request (see below). |
| Documentation | User-facing docs live in [`docs/wiki/`](../docs/wiki/) (published to the GitHub Wiki on merge, not editable there directly). Everything else follows the fixed doc set described in [AGENTS.md](../AGENTS.md). |

## Development setup

Local dev setup, prerequisites, and test commands are documented once, in the
[README Quick start](../README.md#quick-start). Follow that section end to end
before opening a PR.

## Making a change

1. Branch from `main`:

   | Prefix | Use for |
   |--------|---------|
   | `feature/<slug>` | New functionality |
   | `fix/<slug>` | Bug fixes |
   | `chore/<slug>` | Maintenance, deps, tooling |
   | `docs/<slug>` | Documentation only |

2. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   `<type>(<scope>): <description>`. Types and scopes are listed in
   [AGENTS.md](../AGENTS.md#commits-and-branches); check there rather than guessing,
   since the list occasionally grows.

3. Run the full test suite for every workspace you touched (`npm test -w @admitto/<pkg>`),
   plus `npm run build` / typecheck where applicable. A partial `vitest` run isn't enough
   to catch everything CI does; details are in [AGENTS.md](../AGENTS.md#compounding-rules).
   Don't open a PR on a red suite; if you must, say so explicitly and why.

4. Match the style already used in the file or package you're editing. ESLint and
   TypeScript run in CI, so fix anything they flag before requesting review.

## Using AI coding tools

AI-assisted contributions are welcome. This project uses them internally too (see
[AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md), the instructions this repo already
ships for coding agents). If you use one to help write a PR, the same bar applies as to any
other contribution: you're responsible for what you submit, not the tool.

A few practices that keep AI-assisted PRs useful instead of noisy ("AI slop"):

- **Read and understand every line before submitting.** Don't paste agent output you haven't
  verified against the actual codebase.
- **Run it, don't guess.** Build, typecheck, and the real test suite (see
  [Making a change](#making-a-change) above). "Looks correct" isn't a substitute for a
  passing run.
- **Keep the diff scoped to the issue.** Agents tend to "improve" adjacent code, add
  speculative abstractions, or rewrite whole files. Resist that: the minimum change that
  solves the stated problem, matching existing style.
- **Don't invent.** No fabricated APIs, made-up test coverage, invented changelog entries, or
  confident claims about behaviour you haven't actually checked.
- **Write commits and PR text like a human would.** Describe what changed and why, with no
  tool-generated boilerplate or trailers.

This isn't AI-specific gatekeeping. It's the same discipline [CLAUDE.md](../CLAUDE.md)
already asks of agent sessions on this repo, applied evenly to human and AI-assisted work
alike.

## Opening a pull request

Use the repository's [PR template](pull_request_template.md) and keep the section
headings as they are:

- **Description**: business context and technical changes, as separate paragraphs.
- **How to test**: concrete verification steps (or state plainly that tests weren't run, and why).
- **What stays / known limitations**: anything intentionally deferred.
- **Documentation impact**: check exactly one box; CI verifies this against the actual diff.
- **Checklist**: secrets, personal data, tests, migrations.

A maintainer will review, request changes if needed, and merge once CI is green and the
PR is approved. Please don't merge your own PR.

## Questions

Open a GitHub issue, or reach **@solarssk**.
