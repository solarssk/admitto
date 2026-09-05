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

Admitto is currently a single-maintainer project (see
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)): @solarssk reviews and merges every PR, including their
own, once CI is green - there's no one else to hand it to yet. "Please don't merge your own PR"
applies once a second maintainer has write access to the repository.

Branches aren't auto-deleted on merge (`delete_branch_on_merge` is off): this repo uses native
GitHub stacked PRs, where a later branch's base is an earlier, still-open PR's branch, so branches
routinely need to outlive their own PR's merge.

**Required conversation resolution (2026-09-04):** `main` requires every review thread to be
resolved before merge. Paired deliberately with the fact that no bot on this repo comments
automatically on every PR - CodeRabbit is disabled by default, and the Codex/PR-Agent integrations
(`.github/workflows/pr-agent.yml`) only run on an explicit `/review`, `/describe`, `/improve`,
`/ask` comment or `@codex review` mention - so a thread only appears when someone deliberately
asked for one. **Replying to a thread does not resolve it** - found by testing this directly:
PR #1239's two Codex review threads were replied to and their fixes merged, but stayed
`isResolved: false` because a reply is not the same GitHub action as clicking **Resolve
conversation**. If that button is ever unavailable or misbehaves (the original reason this repo
was cautious about enabling this setting at all), resolve via GraphQL instead of the REST API -
GitHub's REST API has no resolve-thread endpoint:

```bash
# Find thread IDs (PRRT_...) for a PR:
gh api graphql -f query='query { repository(owner:"solarssk", name:"admitto") {
  pullRequest(number: N) { reviewThreads(first: 50) { nodes { id isResolved } } } } }'

# Resolve one:
gh api graphql -f query='mutation { resolveReviewThread(input:{threadId:"PRRT_..."}) {
  thread { isResolved } } }'
```

## Questions

Open a GitHub issue, or reach **@solarssk**.
