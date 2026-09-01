# Architecture for Auditors

Entry point for **scope, data flows, and design intent** in self-hosted Admitto deployments.
Detailed engineering decisions live in ADRs (where published); this document stays at the level
a mid-size company security or privacy reviewer typically needs.

**Deployment model:** [CORPORATE-DEPLOYMENT.md](CORPORATE-DEPLOYMENT.md)

> **Product maturity:** check [VERSIONING.md](../../VERSIONING.md) and the current release tag
> before assuming production readiness for a go-live timeline. Stability status is tracked
> there, not restated here, so this document doesn't go stale between releases.

---

## 1. Product scope

Admitto supports **internal corporate events**:

1. Import attendee lists (spreadsheet or agency identifiers).
2. Issue opaque ticket / QR tokens (no attendee name or email in the QR payload).
3. Send ticket email via customer mail infrastructure.
4. Issue an Apple/Google Wallet pass for a ticket, when the deployment configures a wallet provider.
5. Check-in on event day (operator UI).
6. Export lists for reporting.

**Planned (not required for initial go-live):** an external, self-service registration/ingest API, and RSVP/calendar-invite flows.

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
    WORKER[Background worker]
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
  WORKER --> PG
  WORKER --> RD
  WORKER --> Mail
```

The application and background worker are separate processes from the same container image (ADR
0042), not the same process under different threads. Only the application accepts inbound HTTP
traffic; the worker has no listening port and is not reachable from the edge. The worker runs
scheduled/queued jobs against the same database (mail delivery drain, bounce ingest, attendee
import commit, retention purges) and coordinates with the application over Redis (job locks, and
pub/sub so a worker-driven change reflects live in an open admin session without the operator
having to refresh).

---

## 3. Business flow

```mermaid
flowchart LR
  Import[Attendee list\nCSV/XLSX or agency import] --> Core[(Admitto database\nsource of truth)]
  Core --> Mail[Ticket email\nQR + optional wallet links]
  Core --> Wallet[Apple/Google\nWallet pass]
  Guest[Guest] --> Checkin[Check-in\nscan or manual lookup]
  Checkin --> Core
  Core --> Export[Organizer export\n/ reports]
  Ingest[External registration source\nplanned, not built] -.-> Core
```

**Today:** import, mail delivery, wallet passes, check-in, and export/reporting have all shipped (see VERSIONING.md and the release tag for maturity status - shipped is not the same as production-ready for a first event). A self-service external registration/ingest API (a form or third-party system submitting attendees directly into Admitto without staff re-keying them) is a roadmap item, not a deployed control - mention it to auditors as **planned**, not as existing.

Admitto is intended as the **system of record for attendance** after guests are registered in the
customer process (today, via staff-driven CSV/XLSX import).

### 3.1 Triggers, actions, and processes

The table below lists every event that causes Admitto to do something, for a reviewer who needs to trace cause and effect rather than just the end-to-end shape above. "Automatic" means it runs on a schedule or as a direct side effect with no staff action in the moment; every attendee-facing send today is staff-triggered, not automatic.

| Trigger | Actor | Process | Result |
|---|---|---|---|
| Import a CSV/XLSX file | Staff | Parse, validate, dedupe against existing tokens, commit | Attendee rows created; a validation report shows accepted/rejected rows and why |
| Send or resend a ticket | Staff | Render the event's mail template, queue a delivery row, hand off to the configured mail transport | The worker drains the queue and sends via Graph, SMTP, or Power Automate; delivery status is tracked per attendee |
| Add to Wallet (attendee action) | Attendee, from the ticket page | Create or reuse a wallet pass via the configured provider (PassCreator) | Attendee receives an Apple/Google Wallet pass carrying the same QR token as the ticket |
| Scan a QR code, or a manual name lookup | Operator | Validate the token, apply an atomic compare-and-set check-in | Check-in is recorded exactly once; a second scan of the same ticket is reported as already used, never double-counted |
| A wallet pass is voided, restored, or an attendee's details change | Staff, or automatically as a side effect of revoking/restoring a ticket | Push the updated state to the wallet provider | The attendee's wallet pass reflects the new status/details (a lock-screen update, not a new pass) |
| Mail bounces | External mail system | The worker's bounce-ingest process reads the bounce mailbox and marks the affected delivery | Delivery status changes to "bounced"; surfaced to staff in-app (no outbound alert is sent - see [DATA-PROTECTION.md](../../DATA-PROTECTION.md)) |
| Retention window elapses (sessions, trusted devices, security audit log, mail-body snapshots) | Automatic - the worker, on a fixed interval | Purge or nullify the expired rows | Reduces what's retained without staff action; see the Retention table in [DATA-PROTECTION.md](../../DATA-PROTECTION.md) |
| Export attendees / reports | Staff | Query the database, render CSV/XLSX/PDF | File download; no data leaves the customer's own instance |

There is currently **no date-triggered automation** (for example, an automatic reminder email sent N days before an event, or an automatic waitlist promotion) - every attendee-facing action above is either a direct staff action or an immediate side effect of one.

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
| Audit events | PostgreSQL + operational logs | Attendee data minimised in log lines; a small, named set of staff-accountability events (login, admin actions) logs the acting staff member's own email — see [DATA-PROTECTION.md](../../DATA-PROTECTION.md) |

Privacy detail: [DATA-PROTECTION.md](../../DATA-PROTECTION.md), [GDPR-ONE-PAGER.md](GDPR-ONE-PAGER.md).

---

## 6. Security and privacy documentation map

| Topic | Document |
|-------|----------|
| Configurable security capabilities | [SECURITY-CONTROLS.md](SECURITY-CONTROLS.md) — includes rate-limit matrix, `TRUST_PROXY` trust model, SSRF controls, PEN retest checklist |
| CI / image provenance | [SECURITY.md](../../SECURITY.md) |
| Hosting | [CORPORATE-DEPLOYMENT.md](CORPORATE-DEPLOYMENT.md) |
| Incidents | [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) |
| Subprocessors (template) | [SUBPROCESSORS.md](SUBPROCESSORS.md) |

---

## 7. If your reviewer uses a formal framework or questionnaire

Admitto is **self-hosted, no formal certification** (no SOC 2 report, no ISO 27001 certificate) —
that's normal for this size and stage of a vendor, not a red flag to hide. Being upfront about it,
and giving a reviewer something concrete to check instead, is what actually gets a review through:

- **A vendor security questionnaire (SIG Lite, CAIQ, or an internal equivalent):** the documents
  in the map above already answer most of the categories those cover — subprocessors, data flows,
  authentication/access controls, encryption, incident response, and supply-chain scanning. Point
  the reviewer at this document map rather than filling in a separate form from memory; the
  answers should match.
- **A technical/code-level review (pentest scoping, secure-SDLC checklist):** use the
  [OWASP Application Security Verification Standard (ASVS)](https://owasp.org/www-project-application-security-verification-standard/)
  as the reference checklist — it's a testing standard, not a certification, and maps directly onto
  what [SECURITY-CONTROLS.md](security/SECURITY-CONTROLS.md) already documents (authentication,
  session management, access control, input validation / SSRF handling, and so on).
- **A formal audit (SOC 2, ISO 27001):** Admitto does not have either. If your organization's
  policy requires one, that's a decision for whoever owns the vendor-risk process, not something
  this documentation set can substitute for.

## 8. Conscious exclusions (MVP)

Useful answers when enterprise checklists ask for features not in scope:

- Multi-region HA / automatic failover
- Built-in SIEM or SOC integration (log forwarding is customer-side)
- Automated enterprise IAM provisioning (OIDC supported; SCIM not in MVP)
- Vendor-operated penetration test (customer may commission independently before go-live)

---

## 9. Evidence artefacts (repository)

| Artefact | Location |
|----------|----------|
| Release tags | Project releases — created by CI as ordinary, unsigned GitHub tags by default; a manual signed-tag path exists for emergencies, see [VERSIONING.md](../../VERSIONING.md) |
| Container SBOM | `.github/workflows/publish-container.yml` — CycloneDX SBOM generated via `aquasecurity/trivy-action`, attached to release assets |
| Container vulnerability scan | `.github/workflows/publish-container.yml` — Trivy on built image |
| Static analysis SARIF (CodeQL) | `.github/workflows/codeql.yml` — `security-extended` on every PR |
| Static analysis SARIF (Semgrep) | `.github/workflows/semgrep.yml` — `--error` on every PR, every merge to `main`, and weekly; complements CodeQL's `security-extended` PR gate (see [SECURITY.md](../../SECURITY.md)) |
| Code quality analysis (SonarCloud) | Automatic analysis on every PR and `main` push via GitHub App integration (`sonarcloud.io`), not a workflow file in this repo — see [SECURITY.md](../../SECURITY.md) |
| Migration safety checks | `.github/workflows/ci.yml` job `migration-safety` — `scripts/check-migrations-destructive.sh` on PRs |

Release **v0.4.3** added the corporate documentation pack. **CI trigger details** (PR vs `main`, required checks) are maintained in [SECURITY.md](../../SECURITY.md) — prefer that file over this table when answering audit questionnaires.
