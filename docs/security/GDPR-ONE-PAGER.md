# GDPR One-Pager

> **Legal basis:** to be confirmed by the **customer's** privacy officer or legal team. This
> document captures **technical and operational design intent**, not legal advice.

**Detail:** [DATA-PROTECTION.md](../../DATA-PROTECTION.md) · **Subprocessors:** [SUBPROCESSORS.md](SUBPROCESSORS.md)

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
| OIDC access metadata | IdP group membership stored on `ExternalIdentity.groups` | Personal data (access metadata) |

---

## Retention

Two layers: **product-automated** (daily sidecar + container startup, best-effort) vs **operator policy**
(export/delete, log retention). Periods differ by design.

| Data | Policy (default design intent) |
|------|-------------------------------|
| Login sessions, trusted devices | Purged automatically when expired/revoked — **daily automated sidecar + app startup** |
| Security audit trail (`SecurityAuditLog` — login/MFA/logout/OIDC/access-denied) | Purged automatically after **30 days** default (`SECURITY_AUDIT_LOG_RETENTION_DAYS`) — **daily automated sidecar + app startup** |
| Email delivery snapshots (`rendered_html`, `rendered_subject`) | Nullified **60 days** after terminal delivery — **daily automated sidecar + app startup**; delivery log metadata retained |
| IP in admin audit / check-in logs | **30 days or operator corporate log retention policy** — not auto-purged by product |
| Event attendee PII | **Retained until operator erasure** (conscious product default); export via admin UI; erasure via `DELETE` API per DSAR procedure (no SPA delete button yet) |
| Audit logs (general) | Per customer security policy; attendee data minimised in log lines (staff-accountability exception documented in [DATA-PROTECTION.md](../../DATA-PROTECTION.md)) |
| System logs live tail (in-memory only) | Not persisted by the product — last 1000 entries, emptied on every restart |

Organizers can export attendee lists before erasure (spreadsheet / PDF export in admin UI).
Per-attendee erasure uses `DELETE /api/admin/events/:eventId/attendees/:id` (v0.4.6+); follow
[DSAR-PROCEDURE.md](DSAR-PROCEDURE.md). Automated post-event bulk purge is planned for **v1.0**.

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

**Status:** export available in admin UI (v0.4.2+); erasure via `DELETE` API per [DSAR-PROCEDURE.md](DSAR-PROCEDURE.md) (no SPA delete button yet).

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

- [DATA-PROTECTION.md](../../DATA-PROTECTION.md)
- [CORPORATE-DEPLOYMENT.md](CORPORATE-DEPLOYMENT.md)
- [ARCHITECTURE-FOR-AUDITORS.md](ARCHITECTURE-FOR-AUDITORS.md)
- [SECURITY-CONTROLS.md](SECURITY-CONTROLS.md)
- [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md)
- [DSAR-PROCEDURE.md](DSAR-PROCEDURE.md)
