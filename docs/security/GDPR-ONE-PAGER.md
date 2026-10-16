# GDPR One-Pager

A short summary for your privacy officer (DPO). It describes how Admitto is built and run. It is design intent, **not legal advice**. Your own privacy officer or legal team confirms the legal basis.

More detail: [DATA-PROTECTION.md](../../DATA-PROTECTION.md) · [SUBPROCESSORS.md](SUBPROCESSORS.md)

---

## Who is responsible

- **Data controller:** the organization that runs the Admitto instance.
- **Processor role:** if there is one, your contracts decide. Admitto is self-hosted software, and there is no vendor cloud database in the MVP.
- **Deployment:** single-tenant and self-hosted. You choose the region.
- **No vendor-hosted multi-tenant SaaS** in the MVP. Personal data stays in your PostgreSQL.

---

## Why personal data is processed

| Purpose | Lawful basis (candidates, confirm with legal) |
|---------|-----------------------------------------------|
| Event access (ticketing, check-in) | Legitimate interest or contract. A **LIA may be required** for external guests |
| Ticket email delivery | Same as above |
| Security and audit logging | Legitimate interest |
| Staff administration | Contract or legitimate interest |

If you rely on **legitimate interest** (Art. 6(1)(f) GDPR), your DPO should document a **Legitimate Interest Assessment (LIA)**. This matters most for external event guests.

---

## What data is processed

| Category | Examples | Notes |
|----------|----------|-------|
| Identity | Name, email | Personal data |
| Optional profile | Company, department, custom fields | Personal data. Free-text notes and custom fields can hold Art. 9 special-category data (for example dietary or accessibility needs). See [DATA-PROTECTION.md](../../DATA-PROTECTION.md) |
| Access token | Random QR code or opaque ID | The QR code itself holds no personal data |
| Operational | Check-in time, ticket type | Operational |
| Technical | IP address, user agent (sessions, rate limits) | Personal data (online identifier) |
| SSO access metadata | Identity provider group membership, stored in `ExternalIdentity.groups` | Personal data (access metadata) |

---

## How long data is kept

Two layers work together:

- **Product, automatic:** the Admitto **worker** deletes expired data at boot and about every 24 hours, on a best-effort basis.
- **Operator policy:** you decide about exports, erasure and log retention.

The periods differ by design.

| Data | What happens |
|------|--------------|
| Login sessions, trusted devices | Deleted automatically when expired or revoked |
| Security audit trail (`SecurityAuditLog`: login, MFA, logout, OIDC, access denied) | Deleted automatically after **30 days** by default (`SECURITY_AUDIT_LOG_RETENTION_DAYS`) |
| Email delivery snapshots (`rendered_html`, `rendered_subject`) | Emptied **60 days** after the delivery reached its final status. The delivery log metadata stays |
| Export and import files (the exported CSV, XLSX or PDF, and the staged import CSV) | Deleted automatically **7 days** after the job finished (`EXPORT_FILE_RETENTION_DAYS`, `IMPORT_STAGED_FILE_RETENTION_DAYS`). Erasing or removing an attendee deletes them at once. Details: [DATA-PROTECTION.md](../../DATA-PROTECTION.md#retention) |
| In-app security alert inbox (`Notification`) | Deleted automatically after **30 days** by default (`NOTIFICATION_RETENTION_DAYS`), or earlier when the staff member clears it |
| IP address in the admin audit log | **30 days or your corporate log retention policy.** The product does not delete it. A check-in-time IP only appears in the System logs live tail, which is in memory only |
| Event attendee personal data | **Kept until you erase it.** This is a deliberate product default. Export a copy first if you need one (spreadsheet or PDF in the admin UI). Erasure is described below |
| Audit logs (general) | Per your security policy. Attendee data is kept out of log lines (the staff accountability exception is in [DATA-PROTECTION.md](../../DATA-PROTECTION.md)) |
| System logs live tail | Not stored. The last 1000 entries live in memory and are emptied on every restart |

An automated post-event purge of attendee data is planned for **v1.0**.

---

## Data subject rights (access and erasure)

Your legal team chooses one of two models **before production**.

### Option A: self-service (API)

Dedicated endpoints for data-subject export and deletion, for example verified with a ticket token or email verification.

| Pros | Cons |
|------|------|
| Clear for formal DSAR programmes | Extra development and legal alignment |
| Fits automated privacy portals | Must match your internal process exactly |

**Status:** not in the MVP by default. Build it only if legal requires it.

### Option B: organizer-mediated

Authorized staff export attendee data in the admin UI. Erasure follows a **written procedure** (response time, identity check, audit trail).

| Pros | Cons |
|------|------|
| Works with existing organizer workflows | Manual steps. Legal must approve the process |
| No extra public API | Less suited to many requests |

**Status:** available now.

- **Access:** export in the admin UI (spreadsheet or PDF).
- **Erasure:** **Erase personal data** in the Attendees screen (one attendee or several), the erase API (`POST /api/admin/events/:eventId/attendees/:id/erase`), or the `attendees erase` command of the emergency CLI when the UI is down.

Follow [DSAR-PROCEDURE.md](DSAR-PROCEDURE.md).

---

## Subprocessors

They depend on your configuration. Typical categories:

| Category | Role |
|----------|------|
| Hosting / cloud | VM, disk, backups |
| Email | Microsoft 365 / Graph or corporate SMTP |
| Edge (optional) | CDN, WAF, access gateway |
| Wallet | Third-party pass provider (PassCreator), when enabled for an event |

Full list: [SUBPROCESSORS.md](SUBPROCESSORS.md).

---

## Before processing real personal data

1. Legal confirms the lawful basis and the subprocessors (DPAs are in place).
2. The DSAR model (A or B) is agreed and documented internally.
3. Hosting meets your requirements (region, backups, access control).
4. Perimeter and identity choices are written in your deployment runbook.

---

## Related documents

- [DATA-PROTECTION.md](../../DATA-PROTECTION.md)
- [CORPORATE-DEPLOYMENT.md](CORPORATE-DEPLOYMENT.md)
- [ARCHITECTURE-FOR-AUDITORS.md](ARCHITECTURE-FOR-AUDITORS.md)
- [SECURITY-CONTROLS.md](SECURITY-CONTROLS.md)
- [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md)
- [DSAR-PROCEDURE.md](DSAR-PROCEDURE.md)
