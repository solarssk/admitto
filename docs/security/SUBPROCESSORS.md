# Subprocessors

Admitto is **self-hosted** on your infrastructure. **You are the data controller.**

This page lists **categories of third parties** that *may* process personal data when you turn on the matching integration. Replace the generic rows with your real vendor names in your internal compliance register.

---

## At a glance

| Category | Typical examples | When it applies |
|----------|------------------|-----------------|
| **Hosting / IaaS** | Azure, AWS, Google Cloud, on-premises VM | Always |
| **Email: Microsoft 365** | Your tenant (Graph / Exchange Online) | A Graph mailer is configured |
| **Email: SMTP relay** | Corporate relay, transactional SMTP vendor | An SMTP mailer is configured |
| **Edge / CDN** (optional) | Cloudflare, Akamai, corporate CDN | You use one in front of the origin |
| **Identity provider, SSO** (optional) | Microsoft Entra ID, Okta, Authentik, or another OIDC provider | An OIDC provider is enabled (Organisation Settings → Identity) |
| **Zero Trust / access gateway** (optional) | Cloudflare Access, or a corporate zero-trust client or VPN | It is set up in front of staff paths (Organisation Settings → Identity → Cloudflare Access, or an equivalent gateway) |
| **Wallet passes** (optional) | PassCreator, or another PassCreator-compatible provider | The wallet feature is enabled for an event (Event Settings → Wallet) |
| **Geocoding (address lookup)** | Nominatim (OpenStreetMap), or a self-hosted instance | An admin uses venue search or reverse geocoding on the Location tab |
| **Map tiles** | OpenStreetMap, CARTO, or a self-hosted tile server | Maps is enabled (Organisation Settings → External services) |
| **Alert webhook** (optional) | Discord, Slack, or any HTTPS endpoint you choose | A superadmin saves a webhook URL (Organisation Settings → Notifications) |
| **Weather forecast** | MET Norway, Open-Meteo | Weather is enabled (Organisation Settings → External services) |
| **Bot protection** (optional) | Cloudflare Turnstile | A superadmin saves the Turnstile site key and secret key for the public registration form (Organisation Settings → External services → Guest registration) |
| **CI and dev tooling** (repository only) | Codecov, SonarCloud, GitHub Actions, Anthropic (Claude), Sigstore | Project CI only. Not part of your production stack |

---

## What each one receives

### Hosting / IaaS

- **Purpose:** compute, disk, network, backups.
- **Data:** all data at rest in the database volumes.

### Email: Microsoft 365 and SMTP relay

- **Purpose:** ticket and notification email. The SMTP relay is the fallback or the primary mailer.
- **Data:** name, email, message content.

### Edge / CDN

- **Purpose:** TLS and routing.
- **Data:** IP address and HTTP metadata.

### Identity provider (SSO)

- **Purpose:** staff sign in without a separate Admitto password.
- **Data:** staff email, display name and the group membership used for role mapping. Given name, family name or phone number are included when those claims are mapped.
- **Never attendee data.**

### Zero Trust / access gateway

- **Purpose:** limits staff URLs to authorized users and devices before a request reaches Admitto. It sits in front of Admitto's own role-based access, not instead of it.
- **Data:** staff identity claims (email, group) in the gateway's JWT or header.
- **Also in scope:** when the gateway sits in front of the staff app and API paths, it proxies authenticated admin responses. These can include attendee lists, ticket details and other personal data. Treat that proxied traffic as in scope for your privacy register and DPA, for the protected paths.

### Wallet passes

- **Purpose:** Apple and Google Wallet tickets.
- **Data sent:** name, event details (name, date, hours, location), ticket type and an opaque ticket or QR reference.
- **Also sent:** whatever else an admin maps in Field mapping (Event Settings → Wallet). That can include venue access details (room, entrance, door, gate or portal, phone number, Apple Maps place ID), access-point opening times and the event's category.
- **How long it stays:** a pass stays at the provider, even a voided or expired one, until an admin removes it (Attendees → More actions → Remove inactive passes, or Remove from provider) or the attendee is erased.
- **Erasure limit:** erasure deletes the pass only while the event's wallet template and API key are still configured. Otherwise, remove the pass in the provider's own console.

### Geocoding (address lookup)

- **Purpose:** venue and address search, and pin placement on the Location tab.
- **Data:** the search text an admin types (venue name or address), or coordinates for a reverse lookup.
- **Also sent:** the outbound User-Agent. It carries the product version, the instance URL saved in Settings and the instance's own Support contact (the email, or the name when there is no usable email). Nominatim's usage policy requires an identifiable requester.
- **No attendee data.**
- **Independent of the Maps tile toggle.** The Nominatim endpoint is set in Organisation Settings → External services.

### Map tiles

- **Purpose:** show the venue pin on the Location tab, and the static map image on tickets and emails.
- **Data:** event coordinates and zoom level. When the server renders a static map, it also sends the same User-Agent as the address lookup (product version, instance URL, Support contact).
- **No attendee data.**

### Alert webhook

- **Purpose:** team-wide delivery of security alerts.
- **Data:** alert text that names the affected staff account (email or name), and details such as the sign-in IP, device, country or location, or the changed setting.
- **Never attendee data.**

### Weather forecast

- **Purpose:** event-day weather on event cards and on the public ticket page.
- **Data:** event coordinates and date. MET Norway also receives the same User-Agent as the address lookup.
- **No attendee data.**

### Bot protection (Cloudflare Turnstile)

- **Purpose:** tells people from bots on the public registration form, so that automated sign-ups cannot fill the event or send mail to addresses they do not own.
- **Data from the guest's browser:** when the form opens, the browser loads Cloudflare's script and sends Cloudflare the visitor's IP address, user agent and other browser and connection details, and the result of the challenge. This happens before the guest has typed anything.
- **Data from the server:** the secret key and the challenge token, to check the result. The server does not send the visitor's IP address.
- **Not sent to Turnstile:** the form itself. Turnstile receives no name, email or answers. If the instance sits behind Cloudflare as a CDN or an access gateway, that traffic is covered by the Edge / CDN row instead.
- **When:** only for forms that guests reach by a public link or a password, and only while both keys are saved. Without the keys those forms are closed and nothing loads from Cloudflare.
- **Your duty:** name Cloudflare in the privacy notice shown on the registration form, and have the agreement with Cloudflare that your legal team requires, for example a DPA.

### CI and dev tooling (repository only)

- **Purpose:** test coverage reports, static analysis, an automated review of pull requests, and signatures for release assets.
- **Data:** LCOV source paths and line hit counts, the source code under analysis, and pull request diffs and descriptions sent to the reviewer. A signed release records the signing workflow's identity and the file digest in Sigstore's public log.
- **No production attendee personal data.**

---

## Not subprocessors for application logic

- Source code hosting and the container registry. They only distribute the software. No attendee personal data is in the supply chain.
- Open-source maintainers. They have no access to your production data, unless you sign a separate support agreement.

---

## Data stays on your infrastructure

- Attendee database contents remain in **your PostgreSQL**.
- No product telemetry or central analytics cloud in the MVP.
- No multi-tenant Admitto-operated data lake.

---

## Your responsibilities

1. Sign DPAs with the hosting, mail and edge providers you actually use.
2. Write down the region and the subprocessors in your internal privacy register.
3. Sign a DPA with the wallet pass provider (PassCreator, or an alternative) before you enable wallet passes for any event.
4. Sign a DPA with whichever service receives the alert webhook, or leave the webhook unset. Alerts still reach admins in the app and by email.
5. Before you turn on guest registration, agree the terms with Cloudflare for Turnstile (for example a DPA) and name Cloudflare in the privacy notice of the registration form.
6. Keep this page in line with your live deployment.

---

## Related documents

- [GDPR-ONE-PAGER.md](GDPR-ONE-PAGER.md)
- [DATA-PROTECTION.md](../../DATA-PROTECTION.md)
- [CORPORATE-DEPLOYMENT.md](CORPORATE-DEPLOYMENT.md)
