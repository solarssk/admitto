# Subprocessors

Admitto is **self-hosted** on customer infrastructure. The **customer is the data controller**.
The table lists **categories of third parties** that *may* process personal data when the customer
enables the corresponding integration.

Replace generic rows with your actual vendor names in your internal compliance register.

---

## Subprocessor register (template)

| Category | Typical examples | Purpose | Data involved | When |
|----------|------------------|---------|---------------|------|
| **Hosting / IaaS** | Azure, AWS, Google Cloud, on-premises VM | Compute, disk, network, backups | All data at rest in database volumes | Always |
| **Email — Microsoft 365** | Customer tenant Graph / Exchange Online | Ticket and notification email | Name, email, message content | When Graph mailer configured |
| **Email — SMTP relay** | Corporate relay, transactional SMTP vendor | Email fallback or primary SMTP | Same as above | When SMTP mailer configured |
| **Edge / CDN (optional)** | Cloudflare, Akamai, corporate CDN | TLS, routing, optional staff URL protection | IP, HTTP metadata, identity claims from access gateway | When used in front of origin |
| **Wallet passes (optional, future)** | Third-party pass platform | Apple / Google Wallet tickets | Name, pass fields, opaque ticket reference | When wallet feature enabled |
| **CI / dev tooling (repository only)** | Codecov (coverage uploads), GitHub Actions | Test coverage reports from CI pipeline | LCOV source paths and line hit counts; no production attendee PII | When using project CI; not part of customer production stack |

**Not subprocessors for application logic:**

- Source code hosting and container registry — distribution only; no attendee PII in the supply chain.
- Open-source maintainers — no access to customer production data unless under a separate support agreement.

---

## Data stays on customer infrastructure

- Attendee database contents remain in **customer PostgreSQL**.
- No product telemetry or central analytics cloud in MVP.
- No multi-tenant Admitto-operated data lake.

---

## Customer responsibilities

1. Execute DPAs with actual hosting, mail, and edge providers used.
2. Document region and subprocessors in the internal privacy register.
3. Review any future wallet provider before enabling.
4. Keep this template aligned with the live deployment architecture.

---

## Related documents

- [GDPR-ONE-PAGER.md](GDPR-ONE-PAGER.md)
- [DATA-PROTECTION.md](../../DATA-PROTECTION.md)
- [CORPORATE-DEPLOYMENT.md](CORPORATE-DEPLOYMENT.md)
