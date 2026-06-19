# Security Controls (Application)

This document describes **security capabilities** that Admitto supports in typical
self-hosted deployments. It is written for **privacy officers, security reviewers, and operators**
at mid-size and enterprise organizations.

For **repository CI** (SAST, secret scan, container scan, SBOM), see [SECURITY.md](../SECURITY.md).
For **hosting and data residency**, see [CORPORATE-DEPLOYMENT.md](CORPORATE-DEPLOYMENT.md).

> **How to read this:** rows describe what organizations commonly require and how Admitto can be
> configured — not a checklist of what any single deployment must enable. Your runbook and
> environment variables define the effective control set.
>
> **`Where` column:** **App** = built into the application; **Config** = available but must be
> enabled or tuned in deployment settings; **Operator** = customer infrastructure or process
> (reverse proxy, disk encryption, perimeter, runbooks).

---

## Control areas (summary)

| Area | Typical enterprise expectation | Admitto support | Where |
|------|-------------------------------|-----------------|-------|
| Authentication | Staff sign-in before admin/operator actions | Local accounts and/or **OIDC** | App · Config |
| Authorization | Least privilege by role and event/org scope | **RBAC** (admin, operator, platform roles) | App |
| Strong auth | MFA for privileged users | **TOTP** for elevated roles | App · Config |
| Edge access | Restrict staff URLs at the perimeter | Optional zero-trust / access gateway in front of staff paths | Operator |
| Session security | HttpOnly cookies, TLS, rotation | Configurable lifetime; server-side revocation | App · Config |
| CSRF | Protect state-changing browser requests | Same-origin checks on mutating requests (behind standard reverse proxy) | App |
| Abuse prevention | Rate limits on login and public pages | Per-route throttling (shared store recommended in production) | App · Config |
| Secrets | No credentials in source code | Env / secret manager; integration secrets encrypted in DB | App · Operator |
| Data at rest | Protect tickets and integration secrets | Field-level encryption for sensitive data; **disk encryption** | App · Operator |
| Transport | TLS to users | Terminated at customer **reverse proxy, load balancer, or CDN** | Operator |
| Logging | Minimise personal data in logs | Redacted identifiers in audit output; no secrets in log lines | App |
| Supply chain | Scans on code and container image | Documented in [SECURITY.md](../SECURITY.md) | App |

---

## Authentication and access

**Staff surfaces** (administration, check-in) require authentication. Deployments may use:

- **Local accounts** with password and optional MFA for privileged roles.
- **OIDC / SSO** (optional) alongside a local break-glass administrator account.
- **Perimeter access control** (optional) — e.g. corporate zero-trust gateway, VPN, or CDN access
  rules in front of staff URLs. This complements, but does not replace, application RBAC.

Sessions are **server-side** (opaque token, hash stored in the database). Cookie flags follow
common web hardening (`httpOnly`, `SameSite`, `secure` in production).

### Implemented in codebase (v0.4.3)

These capabilities exist in the application — they are **not** roadmap-only claims:

| Capability | Where |
|------------|-------|
| TOTP MFA (privileged roles) | `packages/auth` — MFA enrollment and verification |
| OIDC / SSO | `packages/auth` OIDC provider module; staff login routes in the web app |
| Local break-glass admin | Local account provider alongside OIDC |

Effective controls still depend on **customer configuration** (OIDC disabled by default; TOTP
required only when policy flags are set). Confirm your deployment runbook matches your security
policy.

---

## Authorization (RBAC)

Roles are scoped to **instance**, **organization**, or **event** as appropriate:

| Role | Typical use |
|------|-------------|
| Platform administrator | System configuration, integrations, user management |
| Event organizer | Import, mail, exports, event configuration |
| Check-in operator | Event-day scanning and lookup only |

Access checks are enforced on API routes and staff UI entry points.

---

## Optional hardening (customer choice)

Organizations with stricter policies often add controls **outside** the application:

| Layer | Examples (customer infrastructure) |
|-------|-------------------------------------|
| Edge / CDN | Cloudflare, Akamai, corporate CDN with WAF |
| Reverse proxy | nginx, **Nginx Proxy Manager**, HAProxy, F5, cloud load balancer |
| Network | Site-to-site VPN, zero-trust client, private link to origin |
| Identity | Entra ID, Okta, Authentik, other OIDC providers |
| Mail | Microsoft 365 / Graph, corporate SMTP relay |

Admitto is designed to sit **behind** a trusted reverse proxy (`TRUST_PROXY` and forwarded headers
documented in `deploy/README.md`). The proxy should set client IP and scheme headers consistently.

---

## Data protection in operations

- **Ticket / QR payload:** opaque random identifier — no attendee name or email embedded in the QR.
- **Integration credentials** (mail, OIDC): stored encrypted in the application database; key
  supplied at deploy time via environment variable.
- **Logs:** intended for operations, not analytics — avoid logging full email addresses or secrets.
- **Health endpoints:** public liveness probe; separate token-gated readiness probe for monitoring
  (no personal data in responses).

---

## Known scope limits (MVP)

Be explicit with auditors about what is **out of product scope** today:

- No built-in SIEM or central log platform (forward container logs if required).
- No HA / multi-region failover in the default compose topology.
- No automated long-term PII purge job yet (retention **policy** documented; job planned for v1.0).
- Disk/volume encryption for PostgreSQL and Redis is an **infrastructure** control.

---

## Related documents

- [SECURITY.md](../SECURITY.md) — vulnerability reporting, CI controls
- [DATA-PROTECTION.md](../DATA-PROTECTION.md) — personal data handling
- [CORPORATE-DEPLOYMENT.md](CORPORATE-DEPLOYMENT.md) — deployment model
- [ARCHITECTURE-FOR-AUDITORS.md](ARCHITECTURE-FOR-AUDITORS.md) — scope and data flows
- [GDPR-ONE-PAGER.md](GDPR-ONE-PAGER.md) — privacy summary for DPO review
