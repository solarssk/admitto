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
| **Edge / CDN (optional)** | Cloudflare, Akamai, corporate CDN | TLS, routing | IP, HTTP metadata | When used in front of origin |
| **Identity provider — SSO (optional)** | Microsoft Entra ID, Okta, Authentik, or another OIDC provider | Staff sign-in without a separate Admitto password | Staff email, display name, group membership used for role mapping — never attendee data | When an OIDC provider is enabled (Organisation Settings → Identity) |
| **Zero Trust / access gateway (optional)** | Cloudflare Access, or a corporate zero-trust client/VPN | Restricts staff URLs to authorized users/devices before a request reaches Admitto at all — a network-layer control in front of, not instead of, Admitto's own role-based access | Staff identity claims (email, group) in the access-gateway JWT/header. When the gateway sits in front of staff SPA/API paths, it also proxies authenticated admin responses that can include attendee lists, ticket details, and other personal data returned by Admitto — treat that proxied application traffic as in scope for your privacy register / DPA for the configured protected paths | When configured in front of staff paths (Organisation Settings → Identity → Cloudflare Access, or an equivalent corporate gateway) |
| **Wallet passes (optional)** | PassCreator, or another PassCreator-compatible provider | Apple / Google Wallet tickets | Name, event details (name/date/hours/location), ticket type, opaque ticket/QR reference; when Semantic tags is enabled, also venue coordinates and event start/end time (Apple Wallet only) | When wallet feature enabled per event (Event Settings → Wallet) |
| **Geocoding — address lookup** | Nominatim (OpenStreetMap), or a self-hosted instance | Venue/address search and pin placement on the Location tab | Search text an admin types (venue name or address) or coordinates for reverse lookup; the instance's own Support contact name/email as the outbound User-Agent (Nominatim's usage policy requires an identifiable requester) — no attendee data | When an admin uses venue search or reverse-geocode on the Location tab (independent of the Maps tile toggle; Organisation Settings → External services configures the Nominatim endpoint) |
| **Map tiles** | OpenStreetMap, CARTO, or a self-hosted tile server | Rendering the venue pin on the Location tab and the static map image on tickets/emails | Event coordinates and zoom level — no attendee data | When Maps is enabled (Organisation Settings → External services) |
| **Weather forecast** | MET Norway, or Open-Meteo | Event-day weather shown on event cards and the public ticket page | Event coordinates and date — no attendee data | When Weather is enabled (Organisation Settings → External services) |
| **CI / dev tooling (repository only)** | Codecov (coverage uploads), SonarCloud (code quality analysis), GitHub Actions | Test coverage reports and static analysis from the CI pipeline | LCOV source paths, line hit counts, and source code under analysis; no production attendee PII | When using project CI; not part of customer production stack |

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
3. Execute a DPA with the wallet pass provider (PassCreator, or an alternative) before enabling wallet passes for any event.
4. Keep this template aligned with the live deployment architecture.

---

## Related documents

- [GDPR-ONE-PAGER.md](GDPR-ONE-PAGER.md)
- [DATA-PROTECTION.md](../../DATA-PROTECTION.md)
- [CORPORATE-DEPLOYMENT.md](CORPORATE-DEPLOYMENT.md)
