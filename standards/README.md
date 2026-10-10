# Standards

Detailed, area-specific rules for people and agents working in this repository. [AGENTS.md](../AGENTS.md) holds what applies to every change (security, tests, commits, pull requests, releases) and points here for the rest. These files are read on demand: open the one that matches what you are changing.

These files steer agents, so they are reviewed like code. A change here goes through a normal pull request with the AI review, never the docs-only shortcut.

## Index

| Working on | Read |
|---|---|
| Anything in `apps/admin` (staff SPA) | [admin-spa/README.md](admin-spa/README.md) |
| CI workflows, SonarCloud, ESLint, Vitest, workspace packages, `process.env` | [ci-and-tooling.md](ci-and-tooling.md) |
| Dockerfile, `deploy/`, the entrypoint, GeoIP data, a new runtime package | [infra-and-deploy.md](infra-and-deploy.md) |
| Markdown documents, the Wiki, a pull request body | [docs-and-wiki.md](docs-and-wiki.md) |
| A Cursor Cloud VM, or a local Postgres and Redis | [cursor-cloud-setup.md](cursor-cloud-setup.md) |

## Where a new rule goes

Add a rule when an agent or a reviewer has repeated the same mistake. Put it in exactly one place:

1. **It protects security, personal data or data integrity, or ignoring it fails silently for every change** -> one line in the matching section of [AGENTS.md](../AGENTS.md), with the detail here.
2. **It applies to one area** -> the standards file of that area. Add a row to the "silent failures" table in [AGENTS.md](../AGENTS.md) only if breaking it passes tests and fails later.
3. **It is the story of one incident** -> the pull request or [docs/dev](../docs/dev/README.md), not here. Keep only the rule it taught.

One rule, one place: link to it, do not copy it. A rule in two files will drift, and the copy that is out of date still looks authoritative.

## Size budgets

`npm run docs:check` fails when a file goes over its budget or a link breaks (`scripts/check-agent-docs.mjs`).

| File | Budget | Why |
|---|---|---|
| `AGENTS.md` | 20 000 bytes | Some tools cut a root instruction file at 32 KiB, silently, together with the nested files they load after it |
| `apps/*/AGENTS.md`, `packages/*/AGENTS.md` | 10 000 bytes | Loaded next to the root file when working in that folder |
| `CLAUDE.md` (each) | 4 000 bytes | It imports `AGENTS.md` |
| each file here | 24 000 bytes | Split by topic before it gets there |

When a file nears its budget, split it by topic. Do not raise the budget.

## Writing a rule

- Say what to do and why in one or two sentences, then name the file, test or command that proves it.
- Write the rule, not the incident. Move the story to [docs/dev](../docs/dev/README.md).
- Prefer a test that fails on drift over a paragraph asking people to remember (see "Reusable technique" in [admin-spa/ui-gotchas.md](admin-spa/ui-gotchas.md)).
- Use emphasis for the few rules that must not be missed. If everything is bold, nothing is.
- Link to these files with a normal Markdown link. Do not `@import` them: an import loads the whole file into every session and defeats the split.
