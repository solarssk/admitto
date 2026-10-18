# Security Policy

## Reporting a Vulnerability

**Please do NOT open a public issue for security vulnerabilities.**

Report vulnerabilities privately:

- **GitHub private vulnerability reporting** (preferred): use the
  [Report a vulnerability](https://github.com/solarssk/admitto/security/advisories/new) button in
  the Security tab.
- **Direct contact**: reach @solarssk on GitHub.

We will acknowledge your report within 48 hours and aim to resolve confirmed
vulnerabilities within 14 days.

## What counts as a secret

The following must **never** appear in this repository or its history:

- Microsoft Graph client secret
- SMTP password
- IMAP password (bounce detection mailbox)
- Power Automate webhook URL or API key
- TLS certificates or private keys
- Database credentials or connection strings
- Any token, password, or API key of any kind

**Rotation policy:** any exposed secret is considered burned immediately and must be
rotated before any further use.

## Responsible disclosure

We follow coordinated disclosure. Please give us reasonable time to fix the issue
before making it public. We will credit researchers who follow this policy.

## Security controls / CI

These automated checks are active in this repository. The table gives the short version. The notes under it explain the controls that need more than one line.

| Control | What it checks | When | Workflow |
|---|---|---|---|
| CodeQL | SAST (JavaScript/TypeScript) | Every PR + weekly | `.github/workflows/codeql.yml` |
| Semgrep | SAST (JavaScript/TypeScript) | Every PR + merge to `main` + weekly | `.github/workflows/semgrep.yml` |
| gitleaks | Secret scan of the commits a PR adds on top of its base branch. For a push to `main`: the commits that push introduced | Every PR + every push to `main` | `.github/workflows/ci.yml` (`secret-scan`) |
| npm audit | Dependency SCA (`--audit-level=high`) | Every PR | `.github/workflows/ci.yml` (`lint-and-typecheck`) |
| Dependency review | Diffs the PR's manifest against its base ref. Blocks newly introduced high-severity-vulnerable or disallowed-license dependencies | Every PR | `.github/workflows/ci.yml` (`dependency-review`) |
| License compliance | Every third-party package's license against an allowlist of standard permissive terms (`scripts/check-licenses.mjs`). Not a blocking check, see the notes | Every PR | `.github/workflows/ci.yml` (`lint-and-typecheck`) |
| Dependabot | npm, GitHub Actions, pip (Semgrep toolchain) and Docker image pins (root Dockerfile, deploy compose, ClusterFuzzLite) | Scheduled | `.github/dependabot.yml` |
| PII guard | No real email addresses or phone-number-shaped strings in tracked data files (`scripts/check-ci-pii.sh`). A required check | Every PR | `.github/workflows/ci.yml` (`pii-guard`) |
| Privacy Guard | Compares a PR's diff with a private denylist held as a repository secret. See the notes | Every PR | `.github/workflows/privacy-guard.yml` |
| AI review | An automated review of the repository owner's same-repository PRs. A formal gate, not a human review. See the notes | Every PR by the repository owner | `.github/workflows/ai-review.yml` |
| ClusterFuzzLite | Fuzzing of the CSV and user-agent parsers under `.clusterfuzzlite/fuzz/`. Not a merge gate | PRs touching the fuzzed code (a short run) + nightly (a longer batch run) | `.github/workflows/cflite_pr.yml`, `.github/workflows/cflite_batch.yml` |
| Docker build smoke | Production `Dockerfile` builds | Every merge to `main` | `.github/workflows/ci.yml` (`docker-build`) |
| Trivy (report-only) | Container image scan (OS + libraries), SARIF to Security tab | Every merge to `main` | `.github/workflows/ci.yml` (`docker-build`) |
| Trivy | Container image scan (OS + libraries) per platform, with a CRITICAL gate and a smoke test. See the notes | Release tags + manual dispatch | `.github/workflows/publish-container.yml` |
| CycloneDX SBOM | Container image bill of materials (Trivy), plus a BuildKit SBOM attestation attached to each published image. See the notes | Release tags | `.github/workflows/publish-container.yml` (artifact + release asset; attestation in the registry) |
| Codecov | Test coverage reporting. The `codecov/project` and `codecov/patch` status checks and a PR comment are configured (`codecov.yml`), but they are not yet in `main`'s required checks, so they are still non-blocking today | Every PR | `.github/workflows/ci.yml` (`test-web` / `test-admin` / `test-rest`) |
| SonarCloud | Code quality and maintainability, plus a new-code coverage condition. See the notes | Code-changing PRs (same-repo, non-Dependabot) + code-changing `main` pushes | `.github/workflows/ci.yml` (`sonarcloud`) |
| OWASP ZAP baseline | DAST, passive scan of the unauthenticated surface, plus `/admin` as a signed-in synthetic superadmin and `/operator` as a synthetic operator (no merge gate) | Manual dispatch + weekly | `.github/workflows/dast-baseline.yml` |
| OpenSSF Scorecard | Supply-chain security posture score (branch protection, pinned dependencies, SAST presence, token permissions, etc.). Report-only, not a merge gate | Push to `main` + branch-protection changes + weekly | `.github/workflows/scorecard.yml` |

### Notes on individual controls

**License compliance**

- The job runs with `continue-on-error: true` by design.
- `buffers` (no discoverable license anywhere) is an accepted risk.
- The reviewed-version list for the LGPL libvips packages lags the lockfile, so the report can flag more than one package.
- See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

**Privacy Guard**

- The diff is read over the REST API and never checked out.
- Only same-repository branches are scanned, so a fork cannot probe the list.

**AI review**

- A second identity (`github-actions[bot]`) reviews the repository owner's same-repository PRs. It approves or comments. It never merges or pushes.
- Changes that touch only Markdown under `docs/` or `CHANGELOG.md` are approved by a path rule, without a model call. Root docs, `deploy/` and `.github/` files get a normal review.
- The number of reviews per PR and per day is capped.
- Claude is primary. Its recognized provider outages can trigger the official Codex GitHub connector through the owner's linked subscription.
- Only a verified clean result for the exact current commit is translated into an Actions approval. Findings never approve.
- A scoped owner GitHub token only posts the review request. The separate Actions identity publishes approvals.
- At the maintainer's request, recognized provider unavailability or an exhausted automatic review budget produces a policy approval. It states explicitly that no AI review ran and that manual review is required. Configuration and unknown failures stay red.
- No ChatGPT login is exported to CI, and no paid API is enabled. See [docs/dev/ai-review.md](docs/dev/ai-review.md).
- The approval is a formal gate that lets a single-maintainer repository satisfy branch protection. It does not replace a human review.

**Trivy on release tags**

- It scans per platform (linux/amd64 and linux/arm64), each on its own native runner, with no QEMU.
- Each platform gets a CRITICAL gate plus a smoke test on its untagged candidate image, which is staged in ghcr.io by digest.
- No version tag or multi-arch manifest is published unless both platforms pass.

**CycloneDX SBOM**

- Each SBOM release asset is signed keyless with Sigstore (`.sigstore.json`).
- Each one comes with a provenance attestation (`provenance-<tag>.intoto.jsonl`).

**SonarCloud**

- It checks code quality and maintainability (SAST-adjacent, for example hardcoded-secret patterns and injection-prone constructs). The new-code coverage condition is fed by the same LCOV reports Codecov uses.
- It runs as CI-based analysis (`sonar-project.properties`, authenticated with a `SONAR_TOKEN` secret). Automatic Analysis (the GitHub App) is deliberately off, because it cannot ingest coverage under any configuration (confirmed from SonarSource's own docs). See [docs/dev/sonarcloud-ci-coverage-migration.md](docs/dev/sonarcloud-ci-coverage-migration.md) for the sourced migration history.
- Fork PRs and Dependabot PRs don't receive the `SONAR_TOKEN` secret, so they skip this analysis. Automatic Analysis covered them before the migration, without coverage.
- It is also skipped on a docs-only diff. The `changes` job in `ci.yml` classifies `SECURITY.md`, `docs/**` and other doc paths as non-code, and this job needs `needs.changes.outputs.code == 'true'`.

### Verifying a release

- Every release attaches a CycloneDX SBOM per architecture.
- Once the publish workflow has finished, each SBOM also has a keyless Sigstore signature (`*.cdx.json.sigstore.json`), and the release carries a signed provenance file (`provenance-vX.Y.Z.intoto.jsonl`).
- The SBOMs are attached first. If signing or attestation ever fails, they are still there, and the manual "Sign release assets" workflow can add the signatures afterward.
- That workflow never adds provenance, because that file would claim the recovery run built the SBOMs. A release recovered this way has signatures but no provenance file.
- An SBOM without a `.sigstore.json` next to it has not been verified and should not be relied on.

To check one:

```bash
cosign verify-blob --bundle sbom-vX.Y.Z-amd64.cdx.json.sigstore.json \
  --certificate-identity-regexp '^https://github\.com/solarssk/admitto/\.github/workflows/(publish-container|sign-release-assets)\.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  sbom-vX.Y.Z-amd64.cdx.json
gh attestation verify oci://ghcr.io/solarssk/admitto:X.Y.Z --repo solarssk/admitto
```

Git tags are created by the release workflow and are not GPG/SSH-signed.

### DAST scope (2026-08-29)

- **Scope:** the ZAP baseline scan runs against the same docker-compose stack that `deploy-smoke.yml` builds. It runs four scans.
  - Two are unauthenticated: `/` (plus whatever its spider finds from there) and `/healthz`.
  - Two sign in with a synthetic account and crawl with the AJAX spider, so the SPA's own API calls are exercised and passively scanned.
    - `/admin` signs in as a synthetic superadmin. `scripts/dast-login.mjs` walks the forced TOTP enrollment over HTTP, then hands ZAP the session cookie.
    - `/operator` signs in as a synthetic operator, created by `scripts/dast-seed-operator.mjs`. It starts from the check-in page of a seeded event.
  - The accounts exist only in that run's disposable stack. The logout URLs are excluded, so the spider cannot end its own session.
- **Limitation:** scanning is passive plus spidering only, with no active attack payloads.
- **Reporting status:** report-only for now. Results are a workflow artifact, not a Security-tab SARIF upload (ZAP's baseline scanner has no native SARIF output), and they do not block any pipeline.

### What runs where

- **Every PR:** application build, lint, typecheck, tests with coverage, dependency audit, license compliance, secret scan, PII guard, migration safety, CodeQL and Semgrep.
- **Every merge to `main`:** a container image build smoke and a report-only Trivy scan.
- **Release tags:** the blocking Trivy CRITICAL gate, SBOM and provenance.
- **Codecov data:** CI uploads LCOV coverage reports (file paths and hit counts). No secrets, attendee PII or production credentials are sent. Treat Codecov as development tooling. Customer production data stays in customer PostgreSQL.

### SAST on PRs vs `main`

- CodeQL `security-extended` is the primary gate. Semgrep (`p/javascript`, `p/typescript`) is the complementary second engine, on every PR and on `main`.
- Both engines run on every PR, because an enterprise security review of this repo checks whether *every* PR gets dual SAST coverage, not just what lands on `main`.
- The cost is about 2 to 3 minutes of CI per PR, and Semgrep overlaps with CodeQL's `security-extended` rules.

### Required merge checks on `main`

GitHub branch protection requires these eight checks. All eight must pass before a PR can merge.

| Check name | Job id |
|---|---|
| **Build and test gate** | `build-test` |
| **Secret scan** | `secret-scan` |
| **PII guard (no real personal data)** | `pii-guard` |
| **Code security scan (CodeQL)** | `analyze` |
| **Database migration safety** | `migration-safety` |
| **Wiki docs - sync and links** | `wiki-docs` |
| **Code security scan (Semgrep)** | `semgrep` |
| **Dependency and license review** | `dependency-review` |

### Container image scanning and remediation

- Container image scanning fails the release pipeline on **CRITICAL** vulnerabilities with a known fix (`ignore-unfixed: true`).
- **HIGH** findings are reported (SARIF in the Security tab) but do not block the pipeline.

**Remediation SLA**

- **CRITICAL** with an available fix blocks the next release until patched.
- **HIGH** with an available fix: remediate within **30 days** (tracked in backlog).
- **HIGH** with no upstream fix: accepted risk, documented in the Security tab.
- A blocking CI gate on HIGH+fixable (`--ignore-unfixed`) is planned.

### Build provenance

- Build provenance attestations (SLSA, `actions/attest-build-provenance`) are published for the multi-arch image on both ghcr.io and docker.io on release tags.
- BuildKit also attaches a `mode=max` SLSA provenance and an SBOM attestation to every per-platform image.
- The release build fails if the image's `org.opencontainers.image.revision` label is not the commit that was checked out.

### Secrets policy

Only `.env.example` belongs in this repository. Real credentials (Graph, SMTP, database,
TLS keys, API tokens) must be supplied via environment variables or a secret manager at
deploy time - never committed. See **What counts as a secret** above.

### Known cryptographic limitations

**PassCreator webhook signatures**

- Wallet/PassCreator integration is optional and not required to run Admitto.
- Its webhook signature verification uses SHA-1. PassCreator's docs never state this explicitly. It is inferred from their own PHP code example, which omits `openssl_verify()`'s algorithm argument (PHP defaults that to SHA-1), and their API exposes no way to choose a different algorithm.
- This is an observed constraint, not a documented vendor guarantee. See [packages/wallet/src/passcreator-webhook.ts](packages/wallet/src/passcreator-webhook.ts) for the full reasoning.
- Verification fails closed: a wrong or unverifiable signature is rejected, never accepted.

### Supported versions

- Only the **latest minor release** is supported (currently `0.7.x`, latest <!-- admitto:latest-patch -->`0.7.6`<!-- /admitto:latest-patch -->).
- Deploy from semver tags (`v0.7.y`) published to `ghcr.io/solarssk/admitto` (mirrored to `docker.io/solarssk/admitto`).
- These CI-created tags are ordinary, unsigned GitHub tags by default. A manual, GPG/SSH-signed tag path exists for emergencies. See [VERSIONING.md](VERSIONING.md).

### Data protection

See [DATA-PROTECTION.md](DATA-PROTECTION.md) for GDPR design notes and data-handling intent.
