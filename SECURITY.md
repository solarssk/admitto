# Security Policy

## Reporting a Vulnerability

**Please do NOT open a public issue for security vulnerabilities.**

Report vulnerabilities privately:

- **GitHub private vulnerability reporting** (preferred): use the
  [Report a vulnerability](../../security/advisories/new) button in the Security tab.
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

Active automated checks in this repository:

| Control | Scope | When | Workflow |
|---|---|---|---|
| CodeQL | SAST (JavaScript/TypeScript) | Every PR + weekly | `.github/workflows/codeql.yml` |
| Semgrep | SAST (JavaScript/TypeScript) | Every PR + merge to `main` + weekly | `.github/workflows/semgrep.yml` |
| gitleaks | Secret scan (full history) | Every PR | `.github/workflows/ci.yml` (`secret-scan`) |
| npm audit | Dependency SCA (`--audit-level=high`) | Every PR | `.github/workflows/ci.yml` (`lint-and-typecheck`) |
| Dependabot | npm + GitHub Actions updates | Scheduled | `.github/dependabot.yml` |
| Docker build smoke | Production `Dockerfile` builds | Every merge to `main` | `.github/workflows/ci.yml` (`docker-build`) |
| Trivy (report-only) | Container image scan (OS + libraries), SARIF to Security tab | Every merge to `main` | `.github/workflows/ci.yml` (`docker-build`) |
| Trivy | Container image scan (OS + libraries); **scan-before-push** CRITICAL gate | Release tags + manual dispatch | `.github/workflows/publish-container.yml` |
| CycloneDX SBOM | Container image bill of materials | Release tags | `.github/workflows/publish-container.yml` (artifact + release asset) |
| Codecov | Test coverage reporting; `codecov/project` and `codecov/patch` status checks + PR comment configured (`codecov.yml`), not yet in `main`'s required checks so still non-blocking today | Every PR | `.github/workflows/ci.yml` (`test-web` / `test-admin` / `test-rest`) |
| SonarCloud | Code quality and maintainability (SAST-adjacent, e.g. hardcoded-secret patterns, injection-prone constructs). Automatic Analysis cannot ingest coverage under any configuration (confirmed from SonarSource's own docs); a CI-based migration that would add a coverage quality-gate condition is planned but blocked on a human generating a `SONAR_TOKEN` — see [docs/dev/sonarcloud-ci-coverage-migration.md](docs/dev/sonarcloud-ci-coverage-migration.md) | Automatic analysis on every PR and `main` push | GitHub App (`sonarcloud.io`) — not a workflow file in this repo |

**Codecov data:** CI uploads LCOV coverage reports (file paths and hit counts). No secrets, attendee PII, or production credentials are sent. Treat Codecov as development tooling; customer production data stays in customer PostgreSQL.

**PR pipeline:** application build, lint, typecheck, tests with coverage, dependency audit, secret scan, PII guard, migration safety, CodeQL, and Semgrep. Container image build smoke and a report-only Trivy scan run on every merge to `main`; release tags add the blocking Trivy CRITICAL gate, SBOM, and provenance.

**SAST on PRs vs `main` — decision (2026-07-06), revised (2026-08-29):** Semgrep was kept off PRs (Option B) purely on a CI-speed/marginal-value tradeoff: ~2–3 min added per PR against overlap with CodeQL's `security-extended` rules. That calculus didn't weigh external perception — an enterprise security review of this repo checks whether *every* PR gets dual SAST coverage, not just what lands on `main`. Semgrep (`p/javascript`, `p/typescript`) now also runs on every PR (Option A); CodeQL `security-extended` remains the primary gate, Semgrep the complementary second engine, on PRs and `main` alike.

**Required merge checks on `main`:** GitHub branch protection requires `build-test`, `secret-scan`, `pii-guard`, `analyze` (CodeQL), `migration-safety`, and `wiki-docs`. All six must pass before a PR can merge. Semgrep is not yet in this list — GitHub only allows a required check that has posted at least once with its new trigger; add it once this PR's own Semgrep run lands on `main`.

Container image scanning fails the release pipeline on **CRITICAL** vulnerabilities
with a known fix (`ignore-unfixed: true`). **HIGH** findings are reported (SARIF in the
Security tab) but do not block the pipeline.

**Remediation SLA (v0.4.6+):** **CRITICAL** with an available fix blocks the next release until
patched. **HIGH** with an available fix: remediate within **30 days** (tracked in backlog).
**HIGH** with no upstream fix: accepted risk, documented in the Security tab. A blocking CI gate
on HIGH+fixable (`--ignore-unfixed`) is planned before **v1.0**.

Build provenance attestations (SLSA, `actions/attest-build-provenance`) are published for images
pushed to GHCR on release tags.

### Secrets policy

Only `.env.example` belongs in this repository. Real credentials (Graph, SMTP, database,
TLS keys, API tokens) must be supplied via environment variables or a secret manager at
deploy time — never committed. See **What counts as a secret** above.

### Supported versions

Only the **latest minor release** is supported (currently `0.6.x`, latest <!-- admitto:latest-patch -->`0.6.3`<!-- /admitto:latest-patch -->). Deploy from
semver tags (`v0.6.y`) published to `ghcr.io/solarssk/admitto`. These CI-created tags are ordinary,
unsigned GitHub tags by default; a manual, GPG/SSH-signed tag path exists for emergencies — see
[VERSIONING.md](VERSIONING.md).

### Data protection

See [DATA-PROTECTION.md](DATA-PROTECTION.md) for GDPR design notes and data-handling intent.
