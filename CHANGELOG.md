# Changelog

This project is still pre-`1.0`.
This changelog is intended to do two things at once:

- give the team a milestone-by-milestone picture of what Admitto can already do,
- and preserve the architectural intent behind each release, not just a flat list of filenames.

It is still not a polished public release feed.
At this stage it is an internal engineering changelog for a product that is still converging on its
first event-ready MVP.

**How to read each entry:** one-line theme and git tag, then a short summary of what changed for
operators and organizers, then sections grouped by **product capability** (not by pull request).
ADR references appear only where they explain a design constraint.

## Unreleased

## v0.4.3.1 — 2026-06-19

Security patch and container publish workflow hardening after v0.4.3. Git tag `v0.4.3.1`.

### Security / dependencies

- **undici (#94):** bump transitive `undici` 6.26.0 → 6.27.0 — addresses CVE-2026-12151 (high), CVE-2026-9679 (moderate), CVE-2026-11525 and CVE-2026-6733 (low).

### Infra / CI

- **Publish container (#93):** manual `workflow_dispatch` on branch refs (e.g. `refs/heads/main`) runs **scan-only** — build image, Trivy SARIF upload, CRITICAL gate — without invalid SBOM paths or semver Docker metadata failures.
- **Tag gate:** GHCR push, provenance attestation, and release SBOM upload run only for `refs/tags/*` semver refs; semver-shaped branch names cannot publish.

## v0.4.3 — 2026-06-19

Admin capabilities, dynamic event attributes, and corporate due-diligence readiness. Git tag `v0.4.3`.

### Admin and export

- **F-print export (#88):** attendee list export to CSV, XLSX, and PDF with check-off column, filters parity with list API, formula-injection sanitization, and audit logging.
- **Dynamic custom_data attributes (#91, ADR 0030):** admin PATCH and detail drawer edit fields from `EventItem.config.contents` instead of hardcoded `shirt_size`; export columns follow the same definitions; check-in parity preserved.
- **Release hygiene (follow-up):** Zod validation on `custom_data_fields` keys; stable export column order (`orderBy: key`); duplicate Excel headers disambiguated as `Label (source_field)`; PDF column widths scale down when many attributes exceed printable width; drawer degrades gracefully when event-items API fails; export integration tests use isolated events.

### Security and compliance

- **Semgrep gate:** removed `|| true` from CI — SAST findings block pull requests (baseline verified 0 findings before merge).
- **SECURITY-CONTROLS.md:** configurable security capabilities (auth, RBAC, optional edge/OIDC, logging intent).
- **CORPORATE-DEPLOYMENT.md:** self-hosted model, customer-hosted stack, no SaaS.
- **ARCHITECTURE-FOR-AUDITORS.md:** scope, generic exposure overview, roadmap flows.
- **GDPR-ONE-PAGER.md** + **SUBPROCESSORS.md:** purposes, retention, subprocessor template, DSAR options.
- **DSAR-PROCEDURE.md:** organizer-mediated access/erasure template (Option B).
- **INCIDENT-RESPONSE.md:** rotation, rollback, severity template; GDPR Art. 33/34 72h breach notification.
- **DATA-PROTECTION.md:** updated; legal basis remains customer legal sign-off (LIA note for legitimate interest).
- **SECURITY-CONTROLS.md:** explicit codebase implementation table for TOTP and OIDC (config-dependent).

### References

- Triage: `_ops/design/corp-readiness-pack.md` §C
- Prompt: `_ops/prompts/36-corp-docs-batch.md`

## v0.4.2 — 2026-06-19

Admin event management — full organizer lane. Git tag `v0.4.2`.

After v0.4.1 gave hostesses a complete check-in screen, this release gives **organizers**
the matching admin side: browse and edit the guest list, import from spreadsheet, configure
what operators see on event day, prepare and send ticket mail, and export filtered lists.
Deploy and security are hardened (automatic DB backup before upgrades, readiness probe,
container scanning, dependency fixes).

### Guest list

Organizers open an event and work with attendees in one place:

- **Table:** pagination, search, status and ticket-type filters, badges aligned with operator UI.
- **Edit drawer:** change guest fields in place; view communication history; resend ticket email.
- **Concurrent edits:** if two admins edit the same guest, the second save gets a clear
  *stale write* response instead of silently overwriting (ADR 0028).
- **Export:** download the current filter as XLSX or CSV (sanitized columns, row cap); search
  also matches selected fields inside `custom_data` JSON.

Backend routes are event-scoped (wrong event → 403) with CSRF on mutating calls.

### Import

Upload **CSV or XLSX** with **canonical column headers** (`first_name`, `last_name`, `email`, or a single `name` column, plus optional agency fields), preview row counts and validation errors, choose whether to overwrite existing fields, then commit. Supports both internally generated QR/tokens and agency-provided UUID/QR payloads.

### Event-day requirements

Configure what operators handle at the door:

- **Event items** (gift bag, badge, headset, …) and how they appear on the check-in card.
- **`ops_config`** toggles (e.g. confirm on scan, badge at entry).
- **Content fields** linked to attendee data — invalid field slugs are rejected in the UI.

### Communication and mail

Prepare ticket email without leaving the admin UI:

- Edit **MJML/HTML templates** (Outlook-safe), preview with sample data, send a **test message**.
- Browse the **delivery log** (status, retries — no full rendered body in list views).
- Hardening: request body limits, safe error messages, export-only dev sink for local mail
  testing (ADR 0029).

### Database

| Migration | Purpose |
|-----------|---------|
| `20260618120000_event_item_contents` | Metadata for configurable event-item content |
| `20260618140000_attendee_updated_at` | `updated_at` on attendees for optimistic locking |

Migrations apply **automatically on container start** (fail-fast). When pending migrations
exist, the entrypoint runs a **pre-migration database backup** first (ADR 0027). Operators
do not run `migrate deploy` by hand.

### Deploy, ops, and security

- **`GET /readyz`** — token-protected readiness check (database, Redis, migration status; ADR 0026).
- **Safe upgrades (ADR 0027):** pre-migration backup, CI guard against destructive migration SQL,
  rollback runbook, smoke test for backup path.
- **Supply chain:** Trivy image scan + CycloneDX SBOM in CI; `SECURITY.md` updated.
- **Dependencies:** transitive `uuid` forced to 14.0.0 (Dependabot #13); patch bumps for vitest,
  eslint, argon2. Requires Node ≥22.13 (see root `engines`) for exceljs ↔ uuid interop (`require(esm)`).

### Deploy notes

- Pull or rebuild: `ghcr.io/solarssk/admitto:0.4.2` (rolling `:0.4` on the same minor line).
- Restart the app container after upgrade — migrations and optional backup run on start.
- Smoke: admin login → guest list → import CSV → edit row → export XLSX → mail preview/test-send
  → operator check-in still works.

### Not in this release

- Wallet passes (Apple / Google) → **v0.5**.
- Public self-registration form.
- Major framework upgrades (Prisma 7, React 19).

### Next

- **v0.5.0** — wallet passes via PassCreator.

## v0.4.1 — 2026-06-17

Operator check-in — full event-day screen. Git tag `v0.4.1`.

Builds on v0.4.0’s scan wedge into a **complete hostess workflow**: one attendee card after scan
or manual search, item fulfilment at the door, scan history, per-tablet undo, operator notes,
and optional camera QR. Designed for real event-day use (ADR 0010).

### Attendee card

After a successful scan or manual lookup, the operator sees **one card** with:

- Guest name, company, ticket type, check-in status, warnings.
- Item rows (gift bag, badge, headset) and their states.
- Recent notes and audit context.
- Layout stacks on narrow screens (&lt;1024px).

### Item fulfilment

Per-event items operators can mark at the door:

- **Gift bag** — shirt size shown on the gift bag row when known (not a separate item).
- **Badge** — can auto-issue on check-in when configured.
- **Headset** — issue and return.
- Every change is logged in **AttendeeActionLog** (who, session, device, IP).

### Manual lookup

- Search by name or email; PII stays in the **request body**, not the URL (access-log safe).
- Also matches **company** and **department** inside `custom_data` when present.
- Same admit path as scan — no double admission on repeat tap (CAS).

### Scan history and undo

- Sidebar shows recent scans and admitted count for the event.
- **Undo last check-in** on **this tablet only** — rolls back admission and auto-issued badge
  when safe. Requires a **device label** at login; undo is hidden if none was set.
- Operator notes (max 2000 characters) with author and timestamp.

### Camera scan

- **Opt-in** “Use camera” checkbox — no camera access until enabled.
- USB keyboard wedge remains the primary scan path.
- Dynamic load of the browser QR library.

### Database

| Migration | Purpose |
|-----------|---------|
| `20260617120000_event_day_ops` | `custom_data`, `ops_config`, event items, item states, notes, action log |
| `20260617130000_attendee_note_body_check` | DB limit on note body length |

### Deploy notes

- Image: `ghcr.io/solarssk/admitto:0.4.1`.
- Migrations apply on container start.
- Set **device label** at operator login (e.g. `Tablet 1 — main entrance`) on tablets that need undo.

### Not in this release

- Admin guest list, import, mail templates (→ v0.4.2).
- Wallet passes (→ v0.5).
- Offline check-in queue; Zebra/DataWedge runbook.

### Next

- Admin event screens (v0.4.2).

## v0.4.0 — 2026-06-17

Staff UI foundation and operator check-in wedge. Git tag `v0.4.0`.

First **Tabler-based staff application** served from the same origin as the API: shared design
system, admin/operator shells, scanner-first check-in entry point, reskinned public ticket page,
and **self-hosted fonts/icons** so venue networks without CDN egress still work (ADR 0012).

### Staff application

- **Design system** (`@admitto/ui`): tokens, status badges, 13 primitives; theme vars with
  anti-lockout branding fallback.
- **Admin shell:** lifecycle navigation placeholders, event picker, role-based entry to admin vs
  operator surfaces.
- **Connection state:** auth-aware heartbeat so tablets know when the server session is alive.
- Staff SPA at `/admin`, `/operator`; ticket page `/t` reskinned to match.

### Operator check-in (phase 1)

- Scanner-first: autofocus buffer, Enter to submit, refocus after each scan, ~300 ms duplicate debounce.
- Scan result card with status badge.
- Shared check-in route for admin and operator URLs.

### Security and assets

- Self-hosted Tabler Icons and Inter — no runtime dependency on jsDelivr or Google Fonts.
- Tightened CSP on staff routes; defense-in-depth headers on SPA shell (ADR 0017).
- Controlled redirects when post-login path resolution fails (no HTTP 500 on auth edge cases).

### Deploy notes

- Build includes `@admitto/admin`; static assets at `/admin`, `/operator`, `/assets/*`.
- Image: `ghcr.io/solarssk/admitto:0.4.0`.
- Venue networks that block outbound CDN egress are supported by default.

### Not in this release

- Full attendee card, manual lookup, items, history, camera (→ v0.4.1).
- Admin lifecycle screens (guest list, import, mail) — navigation placeholders only.

### Next

- v0.4.1 — complete operator check-in screen.

## v0.3.7 — 2026-06-16

Release hygiene. Git tag `v0.3.7`.

Signed git tags and a documented cut process so releases show **Verified** on GitHub and
maintainers follow one repeatable path (`scripts/release-tag.sh`, `VERSIONING.md`).

## v0.3.6 — 2026-06-16

Production Docker deployment. Git tag `v0.3.6`.

First **self-hosted compose stack** for running Admitto on real infrastructure (ADR 0018):

- Multi-stage image for `apps/web`; migrations on container start.
- Compose: app + Postgres + Redis + nginx (loopback `:8080`; app internal `:3000`).
- **`GET /healthz`** with database ping for health checks.
- CI builds image; tag push publishes `ghcr.io/solarssk/admitto:0.x.y` and rolling `:0.x`.

## v0.3.5 — 2026-06-15

Cloudflare Access for off-site admins. Git tag `v0.3.5`.

**Off-site organizers** reach `/admin` through Cloudflare Access JWT at the edge; **on-site
break-glass** stays password + TOTP at `/login`. Identity resolves per request via the same
`ExternalIdentity` seam as OIDC — no long-lived Admitto session for CF logins (ADR 0017).

### How it works

- JWT validated on `/admin*` and `/api/admin*` only; missing JWT → login page, not opaque 401.
- Superadmin UI to configure team domain, audience, JWKS test; env locks override DB for kill switch.
- Group → role mapping synced on each valid JWT.

### Database

- `20260615200000_cf_access_settings` — default system settings for CF Access keys.

### Deploy notes

- Pre-link admin `ExternalIdentity` rows before enabling CF off-site.
- `CF_ACCESS_ENABLED=false` in env acts as emergency kill switch.

### Next

- v0.4 — staff UI and operator lane.

## v0.3.4 — 2026-06-15

Corporate SSO (OIDC) and auth hardening. Git tag `v0.3.4`.

**OIDC login** (Authentik-first) as an additive path beside local passwords, plus data-integrity
and transport fixes before Cloudflare Access (ADR 0016).

### OIDC sign-in and account linking

- Authorization Code + PKCE; full ID token validation (JWKS, issuer, audience, nonce).
- New SSO users get **zero roles** unless a group→role rule matches (fail-closed).
- Existing users can **link** an IdP account after password (+ TOTP when required) step-up.
- Superadmin UI for provider config; client secrets encrypted at rest; SSRF guards on discovery URLs.

### Security hardening

- Duplicate role assignments removed; partial unique indexes on scoped roles.
- OIDC provider save resolves HTTP endpoints **before** DB transactions.
- Check-in history `limit` clamped to 1–100.
- SMTP requires TLS 1.2+.

### Database

Six OIDC-related migrations (`20260615120000` … `20260615190000`) — providers, external
identities, OAuth state, role grants, deduplicated assignments.

### Deploy notes

- `ENCRYPTION_KEY` required for IdP secrets and TOTP.
- Configure at least one OIDC provider before expecting SSO logins.
- `TRUST_PROXY=true` behind reverse proxy.

### Not in this release

- Cloudflare Access (→ v0.3.5).
- Admin Tabler UI (→ v0.4).

### Next

- Cloudflare Access; v0.4 staff UI.

## v0.3.3 — 2026-06-14

Two-factor authentication for admins. Git tag `v0.3.3`.

**TOTP 2FA** for admin and superadmin roles; **operators unchanged** on event day (password only).
Partial sessions gate privileged routes until enrollment or verification completes.

### MFA flow

- Enroll authenticator app; backup recovery codes (one-time, hashed).
- Optional **trusted device** cookie to skip TOTP on known browsers.
- Break-glass CLI: reset MFA, generate emergency recovery (superadmin, audited).

### Operator impact

- Operators still get a full session after password — no 2FA friction at the door.
- Existing admin sessions re-staged after deploy; plan communication before an event.

### Database

- `20260614130000_2fa_totp` — MFA methods, trusted devices, session stages, settings seed.
- `20260614210000_totp_replay_protection` — TOTP time-step replay guard.

### Deploy notes

- `ENCRYPTION_KEY` and `TRUST_PROXY=true` in production.
- Run migrations before rollout.

### Not in this release

- OIDC (→ v0.3.4).
- MFA settings UI in Tabler (→ v0.4).

## v0.3.2 — 2026-06-14

Operator login and session-first check-in. Git tag `v0.3.2`.

Tablets **log in with a real session**; check-in is session-first with Bearer token as
break-glass only. Agency ticket URLs use opaque **public_ref** instead of internal attendee IDs (ADR 0015).

### Operator login

- Server-rendered `/login`, `/operator` landing, `/logout`.
- Session cookie (`httpOnly`, `SameSite=Lax`); optional device label; CSRF on mutating routes.
- Login rate limits (IP + per-email on failures).

### Check-in authorization

- Default `ALLOW_CHECKIN_BEARER=false`; session + event scope required for scan and history.
- Per-operator rate limits after authentication.

### Public ticket URLs (Mode B)

- Routes `/t/:slug/a/:ref` and `/q/:slug/a/:ref.png` use **public_ref**, not database id.
- Backfill runs on deploy for existing agency imports.

### Deploy notes

- `npm run db:migrate` (includes public_ref backfill).
- Resend tickets if old Mode B links used internal ids.

### Not in this release

- 2FA (→ v0.3.3).
- Operator scan UI in staff SPA (→ v0.4).

## v0.3.1 — 2026-06-14

Auth core — users, sessions, RBAC. Git tag `v0.3.1`.

First **real identity layer**: local accounts, revocable DB sessions, capability-aware authorization,
and a safe bridge from the legacy check-in Bearer token to session-first operator work (ADR 0011).

### Accounts and sessions

- Local `User` with argon2id passwords; break-glass superadmin bootstrap CLI.
- Opaque session tokens (hash stored); expiry, revocation, role-sensitive TTLs.
- Login/logout/`/api/auth/me`; uniform errors to reduce user enumeration.

### Authorization

- Event-scoped check-in: superadmin (all events), org admin (org events), operator (assigned event).
- `/api/checkin/*` accepts valid session **or** transitional Bearer (ADR 0003 deploy policy).

### Deploy notes

- Bootstrap superadmin before first login: `npm run auth:bootstrap`.
- Missing `CHECKIN_OPERATOR_TOKEN`: 503 in dev, fail-fast in production.

### Next

- Operator HTML login (v0.3.2); 2FA (v0.3.3); OIDC (v0.3.4).

## v0.3.0 — 2026-06-13

Mail operations and public route protection. Git tag `v0.3.0`.

Mail delivery becomes **operable**: test-send, masked config inspection, delivery log listing.
Public ticket/QR routes get **Redis-backed rate limiting** when configured (in-memory fallback locally).

### Mail operations

- Send one test message per event without triggering bulk delivery.
- Read-only config describe (secrets masked).
- Delivery log without exposing full rendered HTML bodies.

### Public routes

- Shared rate limits on `/t/*` and `/q/*` across instances when Redis is available.
- Fail-open if Redis is down — ticket access prioritized over strict limiting.

## v0.2.4 — 2026-06-11

Post-tenant hardening. Git tag `v0.2.4`.

Tighter guardrails after multi-tenant foundation: defensive DB checks on role assignments,
crypto key-version behavior, predictable seed failure when encryption is misconfigured.

## v0.2.3 — 2026-06-11

Multi-tenant foundation and encryption. Git tag `v0.2.3`.

**Organization** as tenant boundary; roles and scopes for superadmin, admin, operator.
Attendee ticket tokens encrypted at rest (AES-256-GCM, ADR 0006).

## v0.2.2 — 2026-06-11

PostgreSQL everywhere. Git tag `v0.2.2`.

Single database engine across dev, CI, and production (ADR 0004). Docker compose for local runs;
relational constraints prevent cross-event check-in mistakes at the DB layer.

## v0.2.1 — 2026-06-11

Atomic check-in backend. Git tag `v0.2.1`.

**Single-use admission**: one QR/token cannot admit twice (CAS, ADR 0001). Temporary Bearer gate
on `/api/checkin/*` until session auth lands in v0.3.

## v0.2.0 — 2026-06-08

Core ticketing. Git tag `v0.2.0`.

End-to-end guest model: CSV/XLSX import, internal QR/token issuance, agency UUID preservation,
public ticket page and hosted QR image routes.

## v0.1.0 — 2026-06-08

Project skeleton and Gate 0. Git tag `v0.1.0`.

Monorepo, initial schema, CI/security baseline, mail adapter groundwork. Gate 0 validated
Power Automate as MVP mail path; Graph/SMTP remain future re-validation candidates.
