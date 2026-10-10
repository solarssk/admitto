# CI, tests and tooling gotchas

Read when a change touches CI workflows, SonarCloud, ESLint, Vitest, workspace packages or `process.env` reads.

---

**SonarCloud runs CI-based analysis only** - the `sonarcloud` job in `.github/workflows/ci.yml`, authenticated with a `SONAR_TOKEN` secret, reading `sonar-project.properties`. Automatic Analysis (the GitHub App) is off, and its config file, `.sonarcloud.properties`, has been removed - don't recreate it, and don't assume Automatic-Analysis semantics (e.g. that `sonar-project.properties` is ignored) anywhere in this repo. `sonar-project.properties`'s own comments document its `sonar.tests`/`sonar.exclusions`/coverage-exclusion gotchas (wildcards unsupported, source/test path overlap fails the whole scan, `*.config.ts`/backfill-script coverage exclusions) directly above each property - read those before editing it, not this file. See [docs/dev/sonarcloud-ci-coverage-migration.md](../docs/dev/sonarcloud-ci-coverage-migration.md) for the sourced history of why Automatic Analysis couldn't stay (it cannot ingest coverage, full stop - not a config gap, a removed product capability) and the migration this repo went through.

**No production installs of unreleased feature work.** Admitto has no customer/staging deploy of WIP branches or unreleased milestone features until a tagged stable release ships. Do **not** invent “legacy cleanup”, migration backfills, or compatibility shims for code that only ever existed on a PR branch. If a review says delete dead “older builds” cleanup, delete it.

**New `process.env.X` reads must be registered in `deploy/env-catalog.json`, then regenerated.**
CI's `wiki-docs` job runs `npm run docs:check`, which includes `generate-env-dictionary.mjs
--check` - it scans source for env var references and fails the build if one isn't listed in the
catalog (or under its `scanIgnore`). Add a catalog entry (`name`, `group`, `boot`, `consumers`,
`secret`, `ui`, `summary` - copy the shape of a sibling entry), then run `npm run docs:env` to
regenerate `deploy/ENV.md` and commit both files together; the check also fails if `ENV.md` is
stale relative to the catalog even when the catalog entry itself is present.

**A new AdminJob drain file mirroring an existing sibling (e.g. wallet_push → wallet_message)
will likely trip SonarCloud's new-code duplication gate (max 3%).** Structural copies like
`resolveEventWalletProvider` or the stale-job reclaim loop read as near-verbatim duplicates by
line/token comparison even when deliberately parallel by design. Extract genuinely shared pieces
into their own small module (see `resolve-event-wallet-provider.ts`,
`reclaim-stale-admin-jobs-by-type.ts`) rather than leaving two inline copies - check the SonarCloud
PR dashboard (`new_duplicated_lines_density` condition) before assuming a passing local build means
this gate will pass too, since duplication isn't caught by `tsc`/vitest.

**New workspace package (any kind, not just runtime): `.github/workflows/ci.yml`'s `test-rest` job's "Run coverage" step is also an explicit `-w @admitto/<name>` allowlist, not a glob.** A package left off it never runs `vitest run --coverage` in CI, so it silently contributes zero lines to both the Codecov upload and the SonarCloud CI-based scan's `coverage-rest` artifact. Its real, passing local test suite then shows up as 0% "Coverage on New Code" on every PR touching it, which looks exactly like SonarCloud Automatic Analysis's well-known inability to ingest coverage at all (`docs/dev/sonarcloud-ci-coverage-migration.md`), but is a completely different, unrelated cause.

Why: root-caused on `packages/notifications`'s first PR (#1272), where the package had 54 real tests and 95%+ local coverage, but `new_coverage` still showed 0% because `-w @admitto/notifications` was simply missing from that one `npm run coverage` command line.

Confirm locally first (`npm run coverage -w @admitto/<name>` should produce `packages/<name>/coverage/lcov.info`), then add the workspace flag to the list.

**GitHub Actions' `concurrency.queue: max` is not usable in this repo yet.** It's a real, current
GitHub Actions feature (confirmed against GitHub's own docs) that lets more than one run wait
`pending` in a concurrency group instead of the default `queue: single`, which is the actual fix
for a workflow like `release.yml` where `cancel-in-progress: false` alone doesn't stop a second
rapid push from bumping the first push's already-queued run out of the group before it starts. But
`actionlint` 1.7.12 - the exact version this repo's `actionlint` CI job pins (`.github/workflows/ci.yml`)
- doesn't recognize `queue` as a valid key under `concurrency` and fails with "unexpected key
\"queue\"" (a hard syntax-check failure, not a warning); confirmed against actionlint's own latest
GitHub release, no newer version exists yet. Don't re-attempt this without first running
`actionlint` (`actionlint -version` should print `1.7.12` to match the pin) against the changed
workflow file and confirming it accepts `queue` as a key.

**Renaming a Vitest project (`test.name`):** grep `package.json` scripts and CI workflows for
`--project <old-name>` first - the filter is an anchored exact match, so a stale reference fails
at startup ("No projects matched the filter").

**Integration tests sharing a package's `*_test` database run one file at a time** (their configs
set `fileParallelism: false`), so cross-file failures there are leftover-state pollution, not
concurrency races - fix them with cleanup in the polluting file, not with `sequence.concurrent`
(that option only affects tests within one file).

**`eslint-disable-next-line` only covers the literal next line.** When the reason needs 2-3 lines
of prose, put the plain `//` explanation lines first and the `eslint-disable-next-line` comment
itself last, directly above the code it's suppressing for - reversing that order (or splitting
the explanation across lines *after* the directive) silences nothing, since "next line" then
points at another comment instead of the real target. Grep for `eslint-disable-next-line` mid a
multi-line comment block if a lint warning appears on a line that already has one right above it.

**SonarCloud's `NOSONAR` marker must be the first thing in its own comment on the flagged line**,
e.g. `code // NOSONAR - reason` or `// NOSONAR - reason` as a whole standalone comment. Appending
` // NOSONAR - reason` after an *already-open* `//` comment (e.g. after an existing `// TODO: …`)
does not suppress anything - the whole line is one comment token to the parser either way, but
Sonar's own marker only registers when NOSONAR leads it. Confirmed by re-checking the PR's issue
list after pushing, not by assumption - the same file's own `role="presentation"` suppression a
few lines away (NOSONAR leading its own comment) did clear, this trailing form did not.

**A comment explaining *why* two files share a deliberately-unextracted duplicate block can itself blow the `new_duplicated_lines_density` gate, even worded differently in each file.** SonarCloud's CPD match is computed on code tokens (comments are stripped for the comparison itself), but the *reported* duplicate line range for a file still includes any new line sitting inside the matched block's span. So a freshly-added comment right above an already-flagged `vi.mock()`/`vi.hoisted()` block counts toward that file's "new duplicated lines" regardless of whether its text matches the sibling file's comment.

Confirmed empirically on two files sharing a near-identical 5-line explanation:

- Duplication density moved 19.8% → 1.4% → 3.1% as the comment was added (gate failed).
- Rewording the comment differently per file did not fix it (still 2.6%, most of the increase persisted).
- Trimming both comments to 1-2 lines did (down to 2.1%).

Keep any such comment as short as possible, and re-check the actual SonarCloud PR analysis after pushing - don't assume a comment is free just because it isn't executable code.
