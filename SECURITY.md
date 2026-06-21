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

| Control | Scope | Workflow |
|---|---|---|
| CodeQL | SAST (JavaScript/TypeScript) | `.github/workflows/codeql.yml` |
| Semgrep | SAST (JavaScript/TypeScript) | `.github/workflows/semgrep.yml` |
| gitleaks | Secret scan (full history) | `.github/workflows/ci.yml` (`secret-scan`) |
| npm audit | Dependency SCA (`--audit-level=high`) | `.github/workflows/ci.yml` (`build-test`) |
| Dependabot | npm + GitHub Actions updates | `.github/dependabot.yml` |
| Trivy | Container image scan (OS + libraries); **scan-before-push** on release tags | `.github/workflows/publish-container.yml` |
| CycloneDX SBOM | Container image bill of materials | `.github/workflows/publish-container.yml` (artifact + release asset) |

Container image scanning fails the release pipeline on **CRITICAL** vulnerabilities
with a known fix (`ignore-unfixed: true`). **HIGH** findings are reported (SARIF in the
Security tab) but do not block the pipeline.

Build provenance attestations (SLSA, `actions/attest-build-provenance`) are published for images
pushed to GHCR on release tags.

### Secrets policy

Only `.env.example` belongs in this repository. Real credentials (Graph, SMTP, database,
TLS keys, API tokens) must be supplied via environment variables or a secret manager at
deploy time — never committed. See **What counts as a secret** above.

### Supported versions

Only the **latest minor release** is supported (currently `0.4.x`, latest `0.4.4`). Deploy from signed
semver tags (`v0.4.y`) published to `ghcr.io/solarssk/admitto`.

### Data protection

See [DATA-PROTECTION.md](DATA-PROTECTION.md) for GDPR design notes and data-handling intent.
