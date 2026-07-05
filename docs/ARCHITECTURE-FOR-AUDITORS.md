# Architecture for Auditors

Entry point for **scope, data flows, and design intent** in self-hosted Admitto deployments.
Detailed engineering decisions live in ADRs (where published); this document stays at the level
a mid-size company security or privacy reviewer typically needs.

**Deployment model:** [CORPORATE-DEPLOYMENT.md](CORPORATE-DEPLOYMENT.md)

---

## 1. Product scope

Admitto supports **internal corporate events**:

1. Import attendee lists (spreadsheet or agency identifiers).
2. Issue opaque ticket / QR tokens (no attendee name or email in the QR payload).
3. Send ticket email via customer mail infrastructure.
4. Check-in on event day (operator UI).
5. Export lists for reporting.

**Planned (not required for initial go-live):** wallet passes, registration ingest, RSVP flows.

**Out of MVP scope:** public self-registration portal, payments, CRM, vendor-hosted SaaS.

---

## 2. Logical architecture

```mermaid
flowchart TB
  subgraph edge [Customer edge - optional]
    CDN[CDN or WAF]
    RP[Reverse proxy / load balancer]
  end
  subgraph stack [Admitto stack on customer host]
    APP[Application]
    PG[(PostgreSQL)]
    RD[(Redis)]
  end
  subgraph external [Customer-managed integrations]
    Mail[Corporate email]
    Wallet[Wallet provider - optional future]
  end
  Users[Users] --> CDN
  CDN --> RP
  RP --> APP
  APP --> PG
  APP --> RD
  APP --> Mail
  APP -.-> Wallet
```

---

## 3. Business flow (roadmap)

```mermaid
flowchart LR
  Reg[Registration source] --> Ingest[Ingest API - planned]
  Ingest --> Core[Admitto database]
  Core --> Mail[Ticket email]
  Core --> Wallet[Wallet - planned]
  Core --> RSVP[RSVP - planned]
  Guest[Guest] --> Checkin[Check-in]
  Checkin --> Core
  Core --> Export[Organizer export]
```

**Today:** import, mail, check-in, export are in scope for MVP UI. Ingest, RSVP, and wallet are
roadmap items — mention them to auditors as **planned**, not as deployed controls.

Admitto is intended as the **system of record for attendance** after guests are registered in the
customer process.

---

## 4. Exposure overview (generic)

| Area | Typical exposure | Mitigation approach |
|------|------------------|---------------------|
| Public ticket links | Internet | Opaque tokens; throttling; minimal data on page |
| Staff UIs | Restricted by customer network and/or app auth | RBAC; optional MFA; optional perimeter gateway |
| Admin APIs | Authenticated staff only | Scope checks on event/org; per-user throttling on heavy ops (import, template preview) |
| Superadmin OIDC config | Authenticated superadmin only | Outbound fetch SSRF guards + rate limits on discover/test |
| Database | Internal network | Not published to internet |
| Container image | Pulled by customer | Signed tags; CI scanning documented in SECURITY.md |
| Ops probes | Often internal/monitoring | `/healthz` rate-limited liveness; `/readyz` token-gated readiness |

Specific paths and headers are defined in deployment runbooks — not repeated here to avoid
coupling public docs to one customer's perimeter design.

---

## 5. Data categories (summary)

| Category | Storage | Notes |
|----------|---------|-------|
| Attendee PII | Customer PostgreSQL | Name, email, optional profile fields |
| Ticket secret | PostgreSQL (encrypted field) | Random identifier for QR |
| Check-in state | PostgreSQL | Operational |
| Mail credentials | PostgreSQL (encrypted) | Customer Graph / SMTP settings |
| Audit events | PostgreSQL + operational logs | Designed to minimise PII in log lines |

Privacy detail: [DATA-PROTECTION.md](../DATA-PROTECTION.md), [GDPR-ONE-PAGER.md](GDPR-ONE-PAGER.md).

---

## 6. Security and privacy documentation map

| Topic | Document |
|-------|----------|
| Configurable security capabilities | [SECURITY-CONTROLS.md](SECURITY-CONTROLS.md) — includes rate-limit matrix, `TRUST_PROXY` trust model, SSRF controls, PEN retest checklist |
| CI / image provenance | [SECURITY.md](../SECURITY.md) |
| Hosting | [CORPORATE-DEPLOYMENT.md](CORPORATE-DEPLOYMENT.md) |
| Incidents | [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) |
| Subprocessors (template) | [SUBPROCESSORS.md](SUBPROCESSORS.md) |

---

## 7. Conscious exclusions (MVP)

Useful answers when enterprise checklists ask for features not in scope:

- Multi-region HA / automatic failover
- Built-in SIEM or SOC integration (log forwarding is customer-side)
- Automated enterprise IAM provisioning (OIDC supported; SCIM not in MVP)
- Vendor-operated penetration test (customer may commission independently before go-live)

---

## 8. Evidence artefacts (repository)

| Artefact | Location |
|----------|----------|
| Signed release tags | Project releases |
| Container SBOM | `.github/workflows/publish-container.yml` — Syft SBOM attached to release assets |
| Container vulnerability scan | `.github/workflows/publish-container.yml` — Trivy on built image |
| Static analysis SARIF (CodeQL) | `.github/workflows/codeql.yml` — `security-extended` on every PR |
| Static analysis SARIF (Semgrep) | `.github/workflows/semgrep.yml` — `--error` on every merge to `main` + weekly (not every PR; see [SECURITY.md](../SECURITY.md)) |
| Migration safety checks | `.github/workflows/ci.yml` job `migration-safety` — `scripts/check-migrations-destructive.sh` on PRs |

Release **v0.4.3** added the corporate documentation pack. **CI trigger details** (PR vs `main`, required checks) are maintained in [SECURITY.md](../SECURITY.md) — prefer that file over this table when answering audit questionnaires.
