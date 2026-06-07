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
