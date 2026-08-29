# SonarCloud coverage gate: CI-based analysis migration

This repo's SonarCloud project (`solarssk_admitto`) currently runs **Automatic Analysis** (the
GitHub App, no `sonar-scanner`/`sonarqube-scan-action` step in any workflow file) and has **no
`coverage` / `new_coverage` metric at all**, even though `npm run coverage` already produces LCOV
for every workspace and CI already uploads it to Codecov (`apps/**/coverage/lcov.info`,
`apps/**/coverage-integration/lcov.info`, `packages/**/coverage/lcov.info`,
`packages/**/coverage-integration/lcov.info` — see `vitest.coverage.ts`). The project's quality
gate ("Sonar way", the built-in default) *does* include a `new_coverage < 80%` condition, but it
can never fire: with no coverage metric reported, SonarCloud has nothing to evaluate it against.

## Sourced answer: Automatic Analysis cannot ingest coverage, under any configuration

Confirmed directly from SonarSource's own documentation (not inferred, not a support-forum guess):

> "Currently, automatic analysis has the following limitations: ... **Code coverage information is
> not supported.**"
> — [Automatic analysis](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/automatic-analysis), "Considerations" section

> "SonarQube Cloud supports the reporting of test coverage information as part of the analysis of
> your JS/TS project... **Use CI-based, not automatic analysis.** Usually, when you import a new
> JS/TS project, automatic analysis starts immediately. But, since coverage is not yet supported
> under automatic analysis, **you will need to use CI-based analysis instead. This requires
> disabling automatic analysis.**"
> — [JavaScript / TypeScript test coverage](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/javascript-typescript-test-coverage)

This settles it: there is no `.sonarcloud.properties` trick, no alternate coverage property, and
no partial workaround. `sonar.javascript.lcov.reportPaths` is real and does work — but only when a
`sonar-scanner`/`sonarqube-scan-action` step actually runs in CI, authenticated with a
`SONAR_TOKEN`, using `sonar-project.properties` (the CI-based config file). It is never read by
Automatic Analysis, which reads `.sonarcloud.properties` instead and has coverage support removed
entirely at the product level, independent of any property.

Also relevant: **Automatic Analysis and CI-based analysis conflict if both are on at once** — "If
you enable automatic analysis, you must ensure that you do not have any CI-based analyses
configured. If you do then these CI-based analyses will fail and cause a failure in your build
process." Migrating means turning Automatic Analysis **off**, not layering CI-based analysis on
top of it.

## What's already prepared in this repo (no secret needed)

- **`sonar-project.properties`** (repo root) — project key/organization, the same `sonar.tests`
  classification as `.sonarcloud.properties` (see that file's own comment and the
  `AGENTS.md` Compounding rules entry for why it's a literal list, not a glob — `sonar.tests` never
  accepts wildcards, under either analysis mode, per SonarSource's
  ["Setting initial scope"](https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/project-analysis/setting-analysis-scope/setting-initial-scope)
  docs), and `sonar.javascript.lcov.reportPaths` pointing at every workspace's LCOV output. This
  file is **inert today** — Automatic Analysis never reads `sonar-project.properties` (it reads
  `.sonarcloud.properties` instead, per SonarSource's own docs on that file). It only takes effect
  once the workflow step below exists and Automatic Analysis is off.

Everything past this point needs a human with SonarCloud organization-admin access and GitHub repo
admin access — an agent cannot generate a SonarCloud token or safely flip an org-wide analysis
mode toggle on its own initiative.

## Exact human steps

1. **Generate a SonarCloud token.** SonarCloud → the project's
   `Administration > Analysis Method` page → pick the **GitHub Actions** tutorial. The in-product
   tutorial generates the token for you (Team plan: a scoped organization token; Free plan: a
   personal access token) and shows the exact value — this avoids guessing which token type this
   org's plan expects.
2. **Add it as a GitHub Actions secret.** Repo → `Settings > Secrets and variables > Actions` →
   new repository secret named `SONAR_TOKEN`, value from step 1.
3. **Turn off Automatic Analysis.** Same `Administration > Analysis Method` page →
   switch **Automatic Analysis** to off. Required — see the conflict warning above; leaving it on
   makes the new CI-based analysis fail every run.

Nothing else in SonarCloud's UI needs to change — `sonar-project.properties` already carries the
project key (`solarssk_admitto`) and organization (`recmedia`), read from this repo's existing
public SonarCloud project via `api/components/show?component=solarssk_admitto`.

## Exact CI changes (apply once the two steps above are done)

Not applied in this PR — merging a scan step against a secret that doesn't exist yet would fail on
every run, and this repo's own rule is "do not push on red." This is the literal patch to apply in
a follow-up PR right after `SONAR_TOKEN` exists and Automatic Analysis is off.

Each of `test-web`, `test-admin`, and `test-rest` in `.github/workflows/ci.yml` already produces
LCOV as its own job, run in parallel — none of them has the full set of reports on its own, so a
new job needs all three uploaded as build artifacts first. Add this step to **each** of the three
jobs (after their existing `Run coverage` step, alongside the existing Codecov upload steps):

```yaml
      - name: Upload coverage artifact for SonarCloud
        if: ${{ !cancelled() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.fork == false) }}
        uses: actions/upload-artifact@<pin to latest v4.x>
        with:
          name: coverage-web   # coverage-admin / coverage-rest in the other two jobs
          path: |
            apps/**/coverage/lcov.info
            apps/**/coverage-integration/lcov.info
            packages/**/coverage/lcov.info
            packages/**/coverage-integration/lcov.info
          retention-days: 1
```

Then add a new job, after the three test jobs:

```yaml
  sonarcloud:
    runs-on: ubuntu-latest
    needs: [test-web, test-admin, test-rest]
    if: ${{ !cancelled() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.fork == false) }}
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@<pin, matches other jobs>
        with:
          fetch-depth: 0 # required for accurate SCM/blame data - shallow clones degrade analysis
          persist-credentials: false
      - uses: actions/download-artifact@<pin to latest v4.x>
        with:
          pattern: coverage-*
          merge-multiple: true
      - name: SonarQube Cloud Scan
        uses: SonarSource/sonarqube-scan-action@<pin to latest v7.x>
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

Notes on this shape:

- The `fork == false` guard mirrors SonarSource's own documented pattern for GitHub Actions
  (["Analyzing pull requests from forked repositories"](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/ci-based-analysis/github-actions-for-sonarcloud))
  and is necessary here: unlike Codecov's upload action, `sonarqube-scan-action` has no
  `fail_ci_if_error`-style soft-fail — an empty/invalid `SONAR_TOKEN` makes the step error for
  real. Fork-originated `pull_request` runs never receive repo secrets (the same reason this
  workflow's `DATABASE_URL` has no password — see that comment in `ci.yml`), so without this guard
  every external-contributor PR would show a hard-failing `sonarcloud` job.
- **Trade-off worth deciding on deliberately:** this guard means fork PRs get **no** SonarCloud
  analysis at all post-migration. Automatic Analysis currently analyzes fork PRs today with zero
  extra config (just without coverage). Getting CI-based analysis working on fork PRs too needs
  SonarSource's documented 3-workflow split (build fork code with no secrets → hand off via
  `workflow_run` → analyze with secrets, never executing fork-provided code) — real additional
  complexity and a security-sensitive pattern, not something to add speculatively. Flag this
  explicitly to whoever approves the migration; it may be an acceptable trade for a mostly
  solo-maintained repo, or it may not.
- **Not included above, and a deliberate policy choice for whoever does the migration, not
  something to default to silently:** `sonar.qualitygate.wait=true` (add to
  `sonar-project.properties`) makes the scan step itself fail when the quality gate fails, which is
  what would let `sonarcloud` become a required branch-protection check. Add it — and add
  `sonarcloud` to `main`'s required status checks (`Settings > Branches`) — only once there's been
  a chance to see real coverage numbers and confirm the existing `new_coverage < 80%` "Sonar way"
  condition is achievable, not a surprise wall on the first PR after migration.

## Verification after the follow-up PR merges

Same empirical approach as the existing `sonar.tests` fix (see `AGENTS.md` Compounding rules) —
verify against the live dashboard, not assumptions:

```bash
curl -s "https://sonarcloud.io/api/measures/component?component=solarssk_admitto&metricKeys=coverage,new_coverage"
```

`coverage`/`new_coverage` should now be present and non-empty (they are currently absent from this
endpoint's response entirely, not just zero).

## Alternative / complement: gate on Codecov instead

Codecov already receives this repo's LCOV on every PR (`CODECOV_TOKEN` is already an configured
secret; no new one needed) and already posts a `codecov/patch` commit status today, using
Codecov's undocumented-in-this-repo defaults — it's just not in `main`'s required status checks,
and has no PR comment. A root `codecov.yml` (added in this PR — see repo root) makes that explicit
and adds a `codecov/project` status plus a PR comment, without needing any of the SonarCloud steps
above. See `codecov.yml`'s own comments for the exact config and `SECURITY.md`'s Codecov row for
current status. This is the faster, zero-new-secret path to "coverage is visibly gated somewhere"
— the SonarCloud migration above is still worth doing for its own sake (one combined quality +
coverage gate, an existing `new_coverage` quality-gate condition that's currently dead weight), but
it is not the only or fastest route to a coverage signal on PRs.

## Sources

- [Automatic analysis](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/automatic-analysis) — SonarQube Cloud docs, "Considerations" (coverage limitation), "Conflict with CI-based analysis", "Additional analysis configuration" (`.sonarcloud.properties` vs `sonar-project.properties`)
- [JavaScript / TypeScript test coverage](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/javascript-typescript-test-coverage) — "Use CI-based, not automatic analysis", `sonar.javascript.lcov.reportPaths` usage and wildcard support
- [Test coverage parameters](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/test-coverage-parameters) — coverage reports are always externally generated and imported via a scanner parameter
- [Setting initial scope](https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/project-analysis/setting-analysis-scope/setting-initial-scope) — `sonar.sources`/`sonar.tests` never accept wildcards, under any analysis mode
- [Github Actions (SonarQube Cloud CI-based analysis)](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/ci-based-analysis/github-actions-for-sonarcloud) — current `SonarSource/sonarqube-scan-action`, fork pull request limitations, `sonar.qualitygate.wait`
- SonarCloud public API, `solarssk_admitto` project (2026-08-29): `api/components/show` (organization key `recmedia`), `api/qualitygates/get_by_project` + `api/qualitygates/show` (default "Sonar way" gate, `new_coverage < 80%` condition present), `api/measures/component?metricKeys=coverage,new_coverage,ncloc,duplicated_lines_density` (`coverage`/`new_coverage` absent from the response entirely)
