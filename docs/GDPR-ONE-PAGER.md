# GDPR One-Pager

> **Legal basis:** to be confirmed by the **customer's** privacy officer or legal team. This
> document captures **technical and operational design intent**, not legal advice.

**Detail:** [DATA-PROTECTION.md](../DATA-PROTECTION.md) · **Subprocessors:** [SUBPROCESSORS.md](SUBPROCESSORS.md)

---

## Controller and deployment

- **Data controller:** the organization operating the Admitto instance.
- **Processor role:** if applicable, determined by customer contracts (self-hosted software;
  no vendor cloud database in MVP).
- **Deployment:** single-tenant, self-hosted; region chosen by the customer.
- **No vendor-hosted multi-tenant SaaS** in MVP — personal data stays in customer PostgreSQL.

---

## Purposes of processing

| Purpose | Lawful basis (candidates — confirm with legal) |
|---------|--------------------------------------------------|
| Event access (ticketing, check-in) | Legitimate interest / contract — **LIA may be required** for external guests |
| Ticket email delivery | Same as above |
| Security and audit logging | Legitimate interest |
| Staff administration | Contract / legitimate interest |

If you rely on **legitimate interest** (Art. 6(1)(f) GDPR), your DPO should document a
**Legitimate Interest Assessment (LIA)**, especially when processing data of external event guests.

---

## Data categories

| Category | Examples | Special category? |
|----------|----------|-------------------|
| Identity | Name, email | Personal data |
| Optional profile | Company, department, custom fields | Personal data |
| Access token | Random QR / opaque ID | Not PII in the QR itself |
| Operational | Check-in time, ticket type | Operational |
| Technical | IP address, user-agent (sessions / throttling) | Personal data (online identifier) |

---

## Retention

| Data | Policy (default design intent) |
|------|-------------------------------|
| Event attendee PII | Delete or anonymise **30–60 days after event end** |
| Email delivery snapshots (`rendered_html`, `rendered_subject`) | Nullified **60 days** after terminal delivery (sent/delivered/failed); delivery log metadata retained |
| Audit logs | Per customer security policy; minimise personal data in log lines |
| Automated purge | **Partial** — auth-state and email snapshot cleanup at container startup; full attendee purge scheduled for a future release |

Organizers can export attendee lists before retention cutoff (spreadsheet / PDF export in admin UI).

---

## Data subject rights (access / erasure)

Two models — **customer legal team chooses** before production:

### Option A — Self-service (API)

Dedicated endpoints for data-subject export and deletion (e.g. verified via ticket token or email
verification).

| Pros | Cons |
|------|------|
| Clear for formal DSAR programmes | Extra development and legal alignment |
| Fits automated privacy portals | Must match internal process exactly |

**Status:** not in MVP by default — implement only if legal requires it.

### Option B — Organizer-mediated

Authorized staff export attendee data through the admin UI; erasure follows a **written procedure**
(SLA, identity verification, audit trail).

| Pros | Cons |
|------|------|
| Works with existing organizer workflows | Manual steps; legal must approve process |
| No extra public API surface | Less suited to high-volume self-service DSAR |

**Status:** export available in admin UI (v0.4.2+); erasure per [DSAR-PROCEDURE.md](DSAR-PROCEDURE.md).

---

## Subprocessors

Depends on customer configuration — typical categories:

| Category | Role |
|----------|------|
| Hosting / cloud | VM, disk, backups |
| Email | Microsoft 365 / Graph or corporate SMTP |
| Edge (optional) | CDN, WAF, access gateway |
| Wallet (future) | Third-party pass provider if enabled |

See [SUBPROCESSORS.md](SUBPROCESSORS.md).

---

## Before processing real personal data

1. Legal confirms lawful basis and subprocessors (DPAs in place).
2. DSAR model (A or B) agreed and documented internally.
3. Hosting meets organisational requirements (region, backups, access control).
4. Perimeter and identity choices documented in the deployment runbook.

---

## Related documents

- [DATA-PROTECTION.md](../DATA-PROTECTION.md)
- [CORPORATE-DEPLOYMENT.md](CORPORATE-DEPLOYMENT.md)
- [ARCHITECTURE-FOR-AUDITORS.md](ARCHITECTURE-FOR-AUDITORS.md)
- [SECURITY-CONTROLS.md](SECURITY-CONTROLS.md)
- [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md)
- [DSAR-PROCEDURE.md](DSAR-PROCEDURE.md)
