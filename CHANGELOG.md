# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Bulk **Send tickets** on the attendees list: `POST .../attendees/bulk-resend` with `target` `unsent` (default, `purpose: initial` with atomic claim) or `all` (resend, max 500 per request); rate limit 3 requests per 10 minutes per admin; response reports provider-accepted (`queued`), `skipped`, and `failed` counts; confirmation modal in admin SPA; audit via `mail_bulk_resend` in attendee action log
- CSV import preview: first 20 valid rows returned as `sampleRows` with `attributeFieldLabels`; admin Import page shows a scrollable "Data preview" table before commit (dynamic optional columns + event custom attributes)
- Requirements v2 (admin): Tabler icon picker on event items (`EventItem.icon`); contents metadata (`type`, `required`, `options`); ops-config flags `allow_manual_lookup` and `auto_advance_on_valid` (defaults true)
- Check-in runtime: enforces `allow_manual_lookup` (403 on lookup API; UI hides manual lookup and blocks short-query lookup); `auto_advance_on_valid` clears scan state after VALID admission; `GET /api/checkin/ops-config`; item icons on AttendeeCard (Tabler)
- Contents metadata runtime: enforce `type`/`select`/`boolean`/`required`/`options` on attendee create and patch; type-aware admin fields; required markers and formatted values on check-in item detail
- CSV import: dynamic event-item attribute columns (`source_field` slugs) validated and stored in `custom_data`; template includes configured fields; export-style label headers accepted on re-import

### Fixed
- CSV import: ignore `source_field` slugs that collide with standard import columns (`email`, `company`, etc.); event item contents API and admin form reject those reserved slugs on save
- CSV import: validate merged `custom_data` at commit (including overwrite with existing attributes); return 400 when event attribute config has conflicting select options
- Settings tabs preserve in-progress panel state (drafts, filters) when switching tabs without eager-loading every panel on first visit
- Per-user preferred locale (`User.preferred_locale`) with date-format picker on Account page; admin SPA date displays respect the stored locale via module-level locale store
- Per-event IANA timezone on events — create/settings/wizard picker, reports/exports/mail preview use event timezone
- Event overview dashboard at `/admin/events/:id/overview` with admission rate, email delivery stats, event countdown, and dedicated `GET /api/admin/events/:eventId/overview` endpoint

### Changed
- Settings: replace mixed SPA/SSR horizontal tabs with four grouped in-app tabs (General, Security, Archiving, Identity); OIDC and Cloudflare Access remain server-rendered manage links
- Admin timestamp display clarity: event operational times use event timezone with abbreviation; admin/system times (audit log, mail deliveries, sessions, archived_at) always show UTC with label
- `client-ip` / healthz rate-limit helpers import `resolveTrustProxy` from lightweight `env-flags` module (avoids flaky CI load of `@admitto/auth` barrel → `@admitto/tickets` → Prisma singleton)
- Shared `@admitto/shared` locale whitelist (`SUPPORTED_LOCALE_TAGS`) used by API validation and Account picker; invalid DB values sanitized on read
- Audit log date filters use UTC calendar-day bounds (aligned with UTC table display)
- Existing events migrated to UTC — update timezone in Event Settings after deploy

## [0.4.6] - 2026-06-27

### Changed
- Admin and operator check-in: desktop camera renders inline in the main panel (stats sidebar stays visible); mobile keeps fullscreen camera overlay; operator mobile autostart with "Use camera" button to reopen after close; desktop inline shows lookup errors in the scan bar area and renders full AttendeeCard (items, notes, undo) below the camera preview
- Attendee note modal includes a one-line reminder not to record medical, dietary, or other sensitive personal data
- Staff SPA Content-Security-Policy allows HTTPS branding logo URLs in setup wizard and settings preview (aligned with existing `font-src https:` for theme fonts)
- Privacy docs: retention tables distinguish product-automated cleanup (sessions, email snapshots) from operator-controlled data (IP logs, attendee lists); OIDC IdP group membership documented; attendee erasure documented as API-only (no SPA delete button)
- `SECURITY.md`: Trivy HIGH remediation SLA (30 days when fix available); blocking HIGH gate deferred to v1.0
- `deploy/README.md`: container startup documents auth-state and email snapshot retention purge steps
- README: MFA first-login flow notes backup-code acknowledgment is persisted in the database

### Added
- Account self-service at `/account` for all signed-in staff: profile, password change (re-auth), TOTP enrollment/reset, and session management (`/api/account/*`)
- Nullable `User.password_hash` for OIDC-only accounts (additive migration; existing rows unchanged)
- IAM Users & roles page at `/admin/users`: staff user table (search, filters, pagination), invite-user modal, edit-user modal with role management, reset MFA/password/sessions, and role-assignments tab
- `GET/POST/PATCH /api/admin/users` and role grant/revoke, reset-2fa, reset-password, revoke-sessions endpoints with anti-lockout guards and audit logging (superadmin; org admin may grant/revoke operator@event only)
- `GET /api/admin/role-assignments` for non-instance role grants
- `must_change_password` on `User` with server-rendered `/change-password` flow after login or admin password reset
- First-run setup: server-rendered `/setup` for empty-database superadmin bootstrap; 5-step React onboarding wizard (system checks, mail, org branding, first event, completion) gated by `setup_complete` in `SystemSettings`
- Settings audit log viewer: superadmin-only paginated table of `AdminAuditLog` entries with action-type and date filters (`GET /api/admin/audit-log`)
- Event reports page at `/admin/events/:id/reports`: admission stats, hourly CSS chart, ticket-type breakdown, paginated admission log, CSV export, and printable HTML/PDF export via `GET /api/admin/events/:eventId/reports` and `/reports/export`; exports write `reports_exported` to the event audit log
- Admin attendee erasure now has a GDPR-ready `DELETE /api/admin/events/:eventId/attendees/:id` path that removes dependent delivery, wallet, and check-in rows in one transaction while preserving an event-scoped audit entry (PRIV-001, PRIV-004)

### Fixed
- Check-in camera result panel shows the actual admission timestamp on repeat scans instead of a hardcoded "Entered earlier today" subtitle
- Attendee note modal privacy hint is linked to the textarea via `aria-describedby` for screen readers
- Ops health/readiness rate limiters import audit logging via `@admitto/auth/audit` so unit tests do not load the full auth barrel (flaky `PrismaClient` init in CI)
- Account page (`/account`): profile Save disabled when unchanged; live password-confirm mismatch feedback; Spinner loading states; SPA `Link` navigation to account from staff/operator shells
- `@admitto/auth` `runInTransaction` no longer value-imports `PrismaClient`, avoiding flaky `healthz-rate-limit` unit tests when the auth barrel loads before `prisma generate`
- First-run `POST /setup` bootstrap race: Serializable transaction re-checks empty user table so only one superadmin can be created
- IAM anti-lockout guards (`last_superadmin` on role revoke and superadmin deactivation) run atomically in Serializable transactions; idempotent role DELETE returns 204 instead of 500 when the assignment is already gone; 404 when the assignment exists under a different user id in the URL
- Setup wizard no longer bypassed on `/operator` — `setup_complete` included on `/api/auth/me` for instance superadmins
- Event slug helper truncates before trimming trailing dashes; wizard step 4 disables Continue when slug is empty and uses max slug length 80 (aligned with API and CreateEventModal)
- DB partial unique index enforces at most one instance-scoped superadmin `RoleAssignment`
- Admin mutations that write `AdminAuditLog` now persist audit rows in the same database transaction as the primary change (users IAM routes, mail settings PUT); audit failure rolls back the mutation instead of leaving inconsistent state (BE-001, BE-002)
- Concurrent attendee import commits for the same event are serialized with a PostgreSQL advisory lock so duplicate bulk audit rows cannot be written (BE-004)
- Agency `public_ref` backfill processes attendees in bounded batches instead of loading all rows at once (BE-005)
- User deactivation revokes sessions after the Serializable user-update transaction commits, avoiding serialization conflicts with concurrent `last_seen_at` updates (Bugbot)
- Import commit transaction timeout raised to 120s so a second commit can wait on the per-event advisory lock without aborting mid-queue (Bugbot)
- `Attendee.rsvp_status` now has a database CHECK constraint matching the application enum, preventing invalid RSVP states from raw SQL or future scripts (DATA-002)
- `OidcRoleGrant` now uses partial unique indexes for scoped and instance grants, correctly enforcing uniqueness when `scope_id` is `NULL` (DATA-004)
- Attendee, check-in, and event item state status columns now have database CHECK constraints matching persisted application values (DATA-003)
- Destructive migration scanning now flags `DELETE FROM` DML in new Prisma migrations unless explicitly approved (DATA-006)
- Staff account creation audit metadata and import CLI skipped-row output now redact email addresses, and privacy/DSAR docs now document attendee-note special-category risk plus manual erasure FK ordering (PRIV-001, PRIV-002, PRIV-003, PRIV-004, PRIV-006)
- Container startup now wraps the agency `public_ref` backfill in a 120-second timeout, and PR-Agent comments are limited to collaborators/members/owners to prevent public API-credit drain (INFRA-002, INFRA-003)
- Container startup now attempts a best-effort purge of expired/revoked `Session` and `TrustedDevice` rows after migrations/backfills with a 120-second timeout; operators can also run `npm run cli -w @admitto/auth -- purge-auth-retention --dry-run` to preview counts, reducing stale auth-state retention (DATA-001, PRIV-005)
- Container startup now nullifies stale `EmailDelivery.rendered_html` / `rendered_subject` snapshots on terminal deliveries older than 60 days (configurable via `EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS`); operators can preview counts with `npm run cli -w @admitto/mail-delivery -- nullify-delivery-snapshots --dry-run` (DATA-005, PRIV-001)

### Security
- Forced password change is now enforced as a dedicated `change_password_required` session stage: a user whose password was reset by an admin cannot reach any protected route (API or UI) until they set a new password — the previous `next: change_password` hint was a UI directive only and could be ignored by any HTTP client (IAM-001)
- Backup recovery codes must be acknowledged before a full session is granted, even after a fresh login or when the completion request lands on a different process: acknowledgment is now persisted on `UserMfaMethod` (`backup_codes_acknowledged_at`) instead of an in-memory stash, closing a bypass where a returning user could skip saving recovery codes (IAM-002)
- Forced password-change form now enforces the same 12-character minimum as all other self-set passwords (was 8) (IAM-003)
- Granting `superadmin@instance` to a second user now returns HTTP 409 `single_superadmin_limit` instead of an unhandled 500 (IAM-004)
- Known limitation: OIDC group→role mappings are fully reconciled at OIDC login only; deployments using OIDC-managed admin/superadmin roles should set admin session TTL to 8h or less and follow the documented offboarding runbook (accepted risk, IAM-005)
- Attendee CSV export now uses the shared CSV formula-injection sanitizer (covers newline-prefixed formulas and whitespace-padded `=`) across attendee, event-settings PII, and reports exports (SEC-001)
- Printable HTML/PDF event report export now sends a restrictive Content-Security-Policy header (SEC-003)
- `EmailDelivery.error` sanitization now redacts URLs (e.g. Power Automate webhooks) before persistence (BE-006)
- REVOKED check-in audit rows are written inside a transaction for consistency with other check-in paths (BE-003)
- Known limitation: automated post-event attendee PII purge deferred to v1.0 — use Attendees export + per-attendee `DELETE` API (no SPA delete button yet)
- Known limitation: OIDC group→role reconciliation runs at OIDC login only — shorten admin session TTL and follow offboarding guidance in `SECURITY-CONTROLS.md`
- Known limitation: Account page TOTP enrollment shows an `otpauth://` URI string; HTML `/mfa/enroll` shows a QR code — SPA QR deferred to v0.4.7
- Known limitation: ticket token may appear in server access logs when operators open ticket URLs — accepted risk; control via reverse-proxy log retention

## [0.4.5] - 2026-06-24

### Added
- MFA enrollment split into three steps: TOTP QR/setup-key confirm → dedicated backup-codes page → full session; new `backup_codes_required` session stage and DB migration
- `POST /mfa/enroll/backup-codes` route and `handleTotpBackupCodesComplete` API endpoint; session promoted to `FULL` only after backup-codes acknowledgment
- 6-digit centered OTP input field with auto-focus, paste support, keyboard navigation, and backup-recovery-code toggle
- `GET /` smart redirect: authenticated users land on `/admin` (or `/operator`), unauthenticated users on `/login`
- Admitto favicon set: SVG, 32 × 32 PNG, Apple touch icon, and ICO fallback served from `/favicon.*`
- SSO button label per identity provider (`login_button_label`); default falls back to "Continue with SSO"
- Admin sidebar: checkmark brand mark (correct `admitto-mark.svg`), `All events` + `Settings` items always pinned to footer
- Settings sub-navigation: horizontal tab bar (General · Identity providers · Cloudflare Access) rendered on both SPA and SSR settings pages
- Identity-provider and Cloudflare Access admin pages rendered with full sidebar shell matching the SPA layout (sticky layout, design-system CSS tokens)
- Event card: date icon, location pin icon, attendee count stat with user icon; hover lift effect
- Event overview landing page at `/admin/events/:id/overview` with quick stats and navigation links to live admin sections
- Shared admin shell (`StaffShell`): sidebar with independent scroll, slim topbar, optional settings subnav, and mobile drawer navigation
- Staff topbar: mailer status indicator (configured dot + provider label), role badge (SA/AD/OP), icon-only sign out
- Sidebar footer: **Users & roles** link for org admins and superadmins (page ships in a follow-up PR)
- Dev-only demo bar (`import.meta.env.DEV`) to trigger sample toasts from the admin shell
- Admin check-in v2: split layout with scan bar, connection banner, stats/progress sidebar, color-dot recent scans, and fullscreen camera overlay with QR viewfinder
- Create event UI: `POST /api/admin/events`, New event modal (title, slug, date, location), redirect to attendees after create
- Events picker visual polish: active status badge, responsive 2/3-column grid, empty state with Create event CTA
- Attendees v2: `rsvp_status` migration, wider list table (STATUS/MAIL/CHECK-IN/actions), manual `POST /attendees`, full attendee detail page with activity log, Add attendee modal
- Event settings page at `/admin/events/:id/settings`: edit title, date, location, capacity; superadmin PII CSV export; archive/unarchive from danger zone; `capacity` field on Event

### Changed
- `GET /api/admin/me` includes `mailer_status` (provider presence only — no credentials); `/api/auth/me` unchanged for operator sessions
- Toast stack position: top-right below the staff topbar (`--topbar-h`) instead of bottom-right
- Admin check-in: keyboard wedge `inputMode="none"`, auto-submit for long tokens, Esc to clear result state
- README: local dev onboarding (`Run locally`), Node `engines` alignment, `infra/` vs `deploy/` distinction; new [`apps/admin/README.md`](apps/admin/README.md)
- Admin Vite dev proxy: forward `/mfa` to `@admitto/web` so MFA enrollment works on `:5173`
- Login page `<title>` fixed to "Admitto"; added `application-name`, `og:site_name`, and `description` meta tags for password-manager naming
- MFA page heading changed from `<h1>` to `<p class="auth-page-action">` to preserve correct document semantics; Admitto brand uses `<h1>`
- CSRF fix: Nginx forwards `$http_host` (with port) in `Host` and `X-Forwarded-Host` headers so `127.0.0.1:8080` logins no longer return 403
- Superadmin instance settings at `/admin/settings` with branding panel — live theme preview, anti-lockout guards, and links to OIDC / Cloudflare Access admin pages (#96)
- Settings → Mail transport panel: configure provider, masked secrets, env-locked fields, and test send (#99)
- Settings → Sessions and Security panels: list/revoke staff sessions, bulk operator revoke, session TTL and MFA policy; `GET`/`PATCH /api/admin/system-settings` (#112)
- Event archiving: `Event.archived_at` hides completed events from default lists; superadmin archive/unarchive; archived events read-only on admin mutating APIs; Active/Archived tabs; check-in stays available (ADR 0022) (#116)
- Admin shell layout: single main scroll region (subnav + page content), `100dvh` viewport, Overview in live event sidebar segments; events picker opens archived tab when no active events remain; active event cards are fully clickable
- MFA enrollment and verify: step progress indicator (`Step X of 3`), no OTP autofocus on the QR step, auto-submit after six digits, and submit loading state on auth forms
- Settings horizontal subnav uses consistent styling across SPA and SSR; Identity providers and Cloudflare Access open via full-page navigation to SSR admin pages
- Admin sidebar chrome trimmed: redundant context labels and duplicate Instance settings header action removed
- `@admitto/ui` design system: `Spinner`, `EmptyState`, `Skeleton`, and `ToastProvider` / `useToast` (#120)
- Admin app root wrapped with `ToastProvider`; recoverable `ErrorBoundary` on render errors (#97, #120)
- Admin UX micro-fixes: import column reference table and CSV template download; delivery log purpose filter; compose dirty-state guard; attendee drawer discard confirmation; check-in stats admitted/total (#121)
- `POST /mfa/enroll/download-codes` — backup codes as `.txt` during enrollment (#117)
- Check-in: `NoteModal` replaces `window.prompt` for attendee notes (#114)
- Runtime upgraded to Node 24 LTS; React 18 → 19 across admin and web (#111, #110)
- Login, MFA, and superadmin identity-provider HTML pages aligned with Admitto design tokens (#117)
- OIDC group mapping role picker uses a select; provider list supports inline enable/disable (#117)
- Cloudflare Access admin form shows status badge, fall-through explanation, and enable warning (#117)
- Requirements and Communication panels use `ConfirmDialog` instead of native `window.confirm` (#97)

### Fixed
- Guest ticket page now prints correctly (white background, no wallet buttons, no shadows)
- Export: sanitize dynamic attribute column headers against formula injection (#97)
- Local dev: login/MFA CSRF when `Origin`/`Referer` absent (Safari); admin SPA dist path after `npm run build -w @admitto/admin` (#115)
- Admin page shell document title uses event name prefix without regressing the visible `h1` (#118)
- SSO failure on `/login` shows a dedicated fallback banner; removed placeholder “SSO coming soon” when no IdP is configured (#117)
- Check-in card coloured left border per scan status (#114)
- Login page title and heading: “Sign in to Admitto” (#114)
- Sidebar Overview section shows “Soon” until built (v1.0) (#114)
- Settings subnav active tab uses path prefix matching instead of exact pathname equality
- Sidebar “Soon” badges render with correct styling (`.nav-item--soon`, `.nav-item__badge`)
- Global link hover underline no longer appears on sidebar brand, navigation items, or button-styled links (SPA and SSR settings shell)
- OIDC admin form: URL fields use `type="url"`; group→role mapping rows can be added/removed; scope type select; SSO button live preview on provider form; failed save re-renders submitted mapping drafts
- Cloudflare Access settings: clearer operator copy and field hints; test action labeled “Test connection”
- Events picker: search by title/location; content width capped at 1100px; grid capped at three columns on wide screens
- Check-in camera: removed fullscreen toggle (browser instability); debounce repeated ZXing decodes; extract ticket token from QR URLs with trailing slash or query (`packages/tickets`)
- Check-in invalid/revoked scans show dedicated feedback card instead of silent failure
- Requirements: `@admitto/ui` Switch missing thumb restored; item table uses name + auto-generated key; drawer layout cleanup
- Event picker cards: removed hover lift/underline noise
- Vercel Git deploys disabled via root `vercel.json` (self-hosted Docker only)

### Security
- Branding `font_family_name` allowlist on save and ticket-page render (blocks CSS/HTML injection via custom fonts) (#96)
- `deploy/validate-env.sh` pre-flight for `deploy/.env`; production boot fails fast when `REDIS_URL` is missing, unauthenticated, or `ENCRYPTION_KEY` is invalid
- PENtest hardening: structured audit events for rate limits, MFA, OIDC login, logout, admin 403, and settings changes — ISO `ts` on each event (#123)
- Production `BASE_URL` must use `https://` (except `localhost` / `127.0.0.1` smoke) (#123)
- OIDC ID token verification restricts JWT algorithms to RS/ES/PS family (no `none`) (#123)
- Deploy Redis requires `REDIS_PASSWORD`; compose wires authenticated `REDIS_URL` (#123)
- Nginx proxy baseline security headers (HSTS, nosniff, frame deny); Docker bridge gateway for RealIP behind NPM (#123)
- `/healthz` and `/readyz` responses include baseline security headers (#123)
- GitHub Releases for `v0.x.y` are **pre-release** until `v1.0.0`; `publish-container` sets the flag automatically (#123)
- PENtest follow-up: rate limits on MFA enroll, `/healthz`, admin import/template preview, and OIDC provider discover/test; OIDC outbound fetch resolves DNS before connect; malformed `X-Forwarded-For` falls back to socket IP (no shared `unknown` bucket)
- `docs/SECURITY-CONTROLS.md`: rate-limit matrix, `TRUST_PROXY` trust model, SSRF/DNS-rebind guards, PEN retest checklist for operators

## [0.4.4] - 2026-06-19

### Security
- Bump transitive `undici` 6.26.0 → 6.27.0; addresses CVE-2026-12151 (high), CVE-2026-9679 (moderate), CVE-2026-11525 and CVE-2026-6733 (low) (#94)

### Fixed
- Container publish workflow: `workflow_dispatch` on branch refs runs scan-only (Trivy SARIF, CRITICAL gate) without SBOM path or Docker metadata failures (#93)
- GHCR push, provenance attestation, and release SBOM restricted to `refs/tags/v*.*.*` semver refs; semver-shaped branch names can no longer trigger a publish

## [0.4.3] - 2026-06-19

### Added
- Attendee list export to CSV, XLSX, and PDF with check-off column and formula-injection sanitization (#88)
- Dynamic custom attributes in admin drawer: edit fields driven by `EventItem.config.contents` instead of hardcoded `shirt_size` (ADR 0030, #91)
- Export columns follow `EventItem.config.contents` definitions; check-in parity preserved
- `SECURITY-CONTROLS.md`: configurable security capabilities table with TOTP and OIDC implementation detail
- `CORPORATE-DEPLOYMENT.md`: self-hosted model, customer-hosted stack, no SaaS
- `ARCHITECTURE-FOR-AUDITORS.md`: scope, generic exposure overview, roadmap flows
- `GDPR-ONE-PAGER.md`, `SUBPROCESSORS.md`: purposes, retention, subprocessor template, DSAR options
- `DSAR-PROCEDURE.md`: organizer-mediated access and erasure template (Option B)
- `INCIDENT-RESPONSE.md`: rotation, rollback, severity template; GDPR Art. 33/34 72-hour breach notification
- Zod validation on `custom_data_fields` keys; stable export column order (`orderBy: key`)
- Duplicate Excel headers disambiguated as `Label (source_field)`; PDF column widths scale down when many attributes exceed printable width
- Export integration tests use isolated events

### Changed
- `DATA-PROTECTION.md` updated with legal basis note (LIA for legitimate interest)

### Fixed
- Drawer degrades gracefully when event-items API fails

### Security
- Removed `|| true` from Semgrep CI step — SAST findings now block pull requests (baseline verified at 0 findings before merge)

## [0.4.2] - 2026-06-19

### Added
- Admin attendee table with pagination, search, status and ticket-type filters, and badge parity with operator UI
- Edit drawer: change guest fields in-place, view communication history, resend ticket email
- CSV and XLSX import: canonical column headers, row preview and validation errors, overwrite toggle, agency UUID/QR payload support
- Event-day configuration: event items (gift bag, badge, headset), `ops_config` toggles, content fields linked to attendee data
- Admin mail UI: edit MJML/HTML templates, preview with sample data, send a test message
- Delivery log: browsable per event (status, retries; no rendered HTML in list views)
- `GET /readyz` token-protected readiness check for database, Redis, and migration status (ADR 0026)
- Pre-migration database backup on container start when pending migrations exist (ADR 0027)
- CI guard against destructive migration SQL; rollback runbook; smoke test for backup path
- Trivy image scan and CycloneDX SBOM in CI; `SECURITY.md` updated
- Export also matches selected fields inside `custom_data` JSON

### Changed
- Backend routes are event-scoped (wrong event returns 403) with CSRF on mutating calls
- Migrations apply automatically on container start (fail-fast); no manual `migrate deploy` for operators
- Requires Node ≥ 22.13 for exceljs ↔ uuid interop (`require(esm)`)

### Fixed
- Concurrent edits: second save on the same guest returns a clear stale-write response instead of silently overwriting (ADR 0028)
- Request body limits and safe error messages on mail endpoints; export-only dev sink for local mail testing (ADR 0029)
- Transitive `uuid` forced to 14.0.0 (#13); patch bumps for vitest, eslint, argon2

### Database migrations
- `20260618120000_event_item_contents` — metadata for configurable event-item content
- `20260618140000_attendee_updated_at` — `updated_at` on attendees for optimistic locking

## [0.4.1] - 2026-06-17

### Added
- Attendee card after scan or manual lookup: guest name, company, ticket type, check-in status, warnings, item rows, recent notes, audit context; stacks on narrow screens (< 1024 px)
- Item fulfilment at the door: gift bag (shirt size shown on row), badge (auto-issue on check-in when configured), headset (issue and return)
- Every item and check-in change logged in `AttendeeActionLog` (who, session, device, IP)
- Manual lookup by name or email: PII in request body (not URL); also matches `company` and `department` inside `custom_data`
- Scan history sidebar with admitted count; operator notes (max 2 000 characters, author + timestamp)
- Per-tablet undo of last check-in: rolls back admission and auto-issued badge; requires device label at login
- Opt-in camera QR decode via dynamically loaded `@zxing/browser`; USB keyboard wedge remains primary scan path

### Changed
- Manual lookup uses the same admit path as scan — no double admission on repeat tap (CAS)
- Undo hidden when session has no device label (matches server 409 response)

### Database migrations
- `20260617120000_event_day_ops` — `custom_data`, `ops_config`, event items, item states, notes, action log
- `20260617130000_attendee_note_body_check` — DB CHECK on note body length

## [0.4.0] - 2026-06-17

### Added
- `@admitto/ui` design system: tokens, status badges, 13 React primitives, theme vars with anti-lockout branding fallback
- Admin and operator shells served from the same origin as the API; role-based redirect to correct surface after login
- Auth-aware heartbeat (`ConnectionStateProvider`) so tablets know when the server session is alive
- Staff SPA at `/admin`, `/operator`; public ticket page `/t` reskinned to match
- Scanner-first check-in entry: autofocus buffer, Enter to submit, refocus after each scan, ~300 ms duplicate debounce
- Scan result card with status badge; shared check-in route for admin and operator URLs
- Self-hosted Tabler Icons and Inter font — no runtime dependency on jsDelivr or Google Fonts (ADR 0012)
- Defense-in-depth headers on staff SPA shell (CSP, `nosniff`, `no-referrer`, `frame-ancestors 'none'`) (ADR 0017)

### Changed
- Semantic theme tokens replace hardcoded hex in `components.css` and `ticket.css`
- `Tabs` reconciles `active` when the `tabs` prop changes after mount

### Fixed
- Controlled redirects when post-login path resolution fails (no HTTP 500 on auth edge cases)

## [0.3.7] - 2026-06-16

### Added
- `scripts/release-tag.sh` for signed annotated tags (`git tag -s`) with pre-push checks
- `VERSIONING.md` with SSH/GPG signing setup and release steps including GitHub Release
- Re-signed tags `v0.3.3`–`v0.3.6` on GitHub (verified: true); future tags use the script

## [0.3.6] - 2026-06-16

### Added
- Multi-stage production Docker image for `apps/web`; migrations run on container start
- `deploy/docker-compose.yml`: app + Postgres + Redis + nginx (loopback `:8080`; app internal `:3000`)
- `GET /healthz` with database ping for Docker health checks
- CI `docker-build` job; `publish-container` pushes `ghcr.io/solarssk/admitto:0.x.y` and rolling `:0.x` on each semver tag (ADR 0018)
- Optional `deploy-smoke` `workflow_dispatch`

## [0.3.5] - 2026-06-15

### Added
- Cloudflare Access JWT validation on `/admin*` and `/api/admin*`; missing JWT redirects to `/login`, not 401 (ADR 0017)
- Per-request CF identity resolution via `ExternalIdentity` seam — no long-lived Admitto session for CF logins
- Superadmin UI to configure team domain, audience, JWKS test; env locks override DB as kill switch
- Group-to-role mapping synced on each valid CF JWT; boot fail-fast when CF Access enabled without team domain/AUD
- `CF_ACCESS_ENABLED=false` env override as emergency kill switch

### Database migrations
- `20260615200000_cf_access_settings` — system settings defaults for CF Access keys

## [0.3.4] - 2026-06-15

### Added
- OIDC login (Authentik-first): Authorization Code + PKCE; full ID token validation (JWKS, issuer, audience, nonce)
- JIT provisioning: new OIDC users get zero roles unless a configured group-to-role rule matches (fail-closed)
- Account linking: explicit `?link=1` step-up (password + TOTP when required); `link_step_up_at` on OAuth state (5 min TTL)
- `OidcRoleGrant` tracks OIDC-provisioned roles; demotion revokes grants without touching manual `RoleAssignment` rows
- Superadmin UI for OIDC provider config; client secrets encrypted at rest; SSRF guards on discovery URLs
- `resolveOrCreateUserFromExternalIdentity` shared seam for Cloudflare Access

### Changed
- SMTP adapter requires TLS 1.2+ (`minVersion: "TLSv1.2"`)
- Check-in history `limit` clamped to 1–100 at HTTP and domain layers

### Fixed
- Duplicate `RoleAssignment` rows removed; partial unique indexes on scoped and instance roles
- OIDC provider save resolves HTTP endpoints before DB transaction (no network I/O inside transactions)
- Idempotent grant creation under concurrent OIDC logins (`P2002` → safe no-op)
- `prisma migrate deploy` on `admitto_auth_test` before auth integration tests in CI

### Database migrations
- `20260615120000_oidc_linking` — `IdentityProvider`, `ExternalIdentity`, OAuth state tables
- `20260615140000_oidc_hardening` — schema and index hardening
- `20260615160000_oidc_scope_normalization` — scope normalization for group-to-role mappings
- `20260615170000_oidc_link_step_up` — `link_step_up_at` on OAuth state
- `20260615180000_oidc_role_grants` — `OidcRoleGrant` + group mapping tables
- `20260615190000_role_assignment_unique` — dedup, partial unique indexes, grant repoint, FK cascade

## [0.3.3] - 2026-06-14

### Added
- TOTP 2FA for admin and superadmin roles; operators unchanged (full session after password, no MFA friction on event day)
- Partial session stages: `mfa_pending` and `enrollment_required` gate privileged routes until TOTP completes
- Backup recovery codes (argon2id-hashed, one-time use)
- Optional trusted-device cookie (hash-only in DB); skips TOTP on known browsers; revoked on logout, MFA reset, and session revoke
- Break-glass CLI: `reset-mfa`, `generate-emergency-recovery` (superadmin@instance only, audit log)
- `SystemSettings`: session TTL, operator session TTL, trusted device days, `mfa_required_roles` (env lock → DB → default)

### Security
- CSRF origin check honours `X-Forwarded-Proto` and `X-Forwarded-Host` only when `TRUST_PROXY=true` (aligned with rate-limit client-IP policy)
- TOTP replay protection: `last_totp_time_step` + otplib `afterTimeStep`; conditional DB update guards parallel replay

### Changed
- Dependency updates: `hono` 4.12.25, `@hono/node-server` 2.0.4, `redis` 6.0.0, `zod` 4.4.3, `@typescript-eslint/parser` 8.61.0, CodeQL action SHA bump
- `RedisRateLimitStore` adapted for redis v6 (`withAbortSignal()`, two-arg `eval()`)

### Database migrations
- `20260614130000_2fa_totp` — `Session.stage`, `UserMfaMethod`, `TrustedDevice`, `SystemSettings` seed; active elevated sessions re-staged
- `20260614210000_totp_replay_protection` — `UserMfaMethod.last_totp_time_step`

## [0.3.2] - 2026-06-14

### Added
- Server-rendered operator auth: `GET/POST /login`, `GET /operator`, `POST /logout`
- Session cookie (`httpOnly`, `SameSite=Lax`); optional device label; CSRF on login/logout and `POST /api/checkin/scan`
- Login rate limits: IP-based and per-email on failed attempts
- `Attendee.public_ref` (unique, non-guessable) for agency ticket URLs
- Public routes `/t/:slug/a/:ref` and `/q/:slug/a/:ref.png` resolve by `public_ref`, not internal `Attendee.id`
- Backfill on deploy: agency attendees without `public_ref` receive one automatically
- `scripts/test-web-like-ci.sh` for local CI parity; test contract in `apps/web/test/README.md`

### Changed
- Default `ALLOW_CHECKIN_BEARER=false`; session + event scope required for scan and history; Bearer token is break-glass only
- Per-operator scan/history rate limits applied after authentication (not shared with unauthenticated IP quota)
- Integration tests stabilized: Vitest unit (no Postgres) vs integration (one `globalSetup` with `migrate deploy`); integration files under `test/integration/`

### Fixed
- CI failures from shared `admitto_web_test` DB (`P3005`, Prisma segfault on repeated `force-reset`): fixture cleanup instead of per-file DB resets

## [0.3.1] - 2026-06-14

### Added
- Local `User` accounts with argon2id password hashing and `is_active` state
- Break-glass superadmin bootstrap CLI: `npm run auth:bootstrap` (password from stdin, not argv)
- `@admitto/auth` package: login, logout, session validation, password verification, auth audit logging, capability-aware authorization helpers
- HTTP auth endpoints: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- Event-scoped check-in RBAC: `superadmin@instance` (all events), `admin@organization` (org events), `operator@event` (assigned event only)
- DB-backed `Session` records: opaque high-entropy tokens (only `token_hash` stored), expiry, single-session revoke, event-scoped bulk revoke
- Role-sensitive session lifetimes: shorter for operators, longer for admin and superadmin

### Changed
- `/api/checkin/*` extended to accept a valid session or the transitional legacy Bearer token; ADR 0003 deploy policy preserved

### Security
- Uniform unauthorized responses for bad email and bad password to reduce user enumeration risk
- Dummy verification path for missing users; structured login audit logs without password or session token leakage
- Login rate limiting; `httpOnly` session cookie with `SameSite=Lax` and `Secure` outside development

## [0.3.0] - 2026-06-13

### Added
- Provider-level test-send: one message per event without triggering bulk delivery
- Read-only mail config inspection with masked secrets
- Delivery log listing without exposing full rendered HTML bodies
- Redis-backed shared rate limiting on public `/t/*` and `/q/*` routes; in-memory fallback when Redis is not configured

### Changed
- Rate limiting fails open when Redis is configured but unavailable — ticket access prioritized over strict limiting during an outage

## [0.2.4] - 2026-06-11

### Fixed
- Defensive DB `CHECK` constraints on `RoleAssignment`
- Crypto key-version behavior hardened
- Seed fails predictably when encryption is misconfigured

## [0.2.3] - 2026-06-11

### Added
- `Organization` as the tenant boundary; `organization_id` threaded through the event and delivery model
- Role and scope groundwork: `superadmin`, `admin`, `operator`
- Attendee ticket tokens encrypted at rest via `@admitto/crypto` (AES-256-GCM, ADR 0006)

## [0.2.2] - 2026-06-11

### Added
- Docker Compose for local development with PostgreSQL
- CI service wiring for real database path
- Relational constraints preventing cross-event check-in mistakes at the DB layer

### Changed
- Standardized on PostgreSQL as the single database engine across development, CI, and production (ADR 0004)

## [0.2.1] - 2026-06-11

### Added
- Atomic single-use check-in: one QR/token cannot admit twice (CAS, ADR 0001)
- Recent check-in history endpoint
- Temporary operator Bearer gate on `/api/checkin/*`

## [0.2.0] - 2026-06-08

### Added
- CSV/XLSX attendee import with agency UUID preservation
- Internal QR/token issuance; agency UUID/external payload support
- Public ticket page (`/t/:slug`) and hosted QR image routes (`/q/:slug`)
- Split between internally generated token-based tickets and agency-provided identifiers

## [0.1.0] - 2026-06-08

### Added
- Monorepo setup with initial DB schema and package boundaries
- CI pipeline and basic security baseline (CodeQL, Semgrep, gitleaks, npm audit, Dependabot)
- Mail adapter groundwork
- Gate 0 outcome recorded: Power Automate as MVP mail path; Graph/SMTP remain future re-validation candidates

[Unreleased]: https://github.com/solarssk/admitto/compare/v0.4.6...HEAD
[0.4.6]: https://github.com/solarssk/admitto/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/solarssk/admitto/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/solarssk/admitto/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/solarssk/admitto/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/solarssk/admitto/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/solarssk/admitto/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/solarssk/admitto/compare/v0.3.7...v0.4.0
[0.3.7]: https://github.com/solarssk/admitto/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/solarssk/admitto/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/solarssk/admitto/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/solarssk/admitto/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/solarssk/admitto/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/solarssk/admitto/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/solarssk/admitto/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/solarssk/admitto/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/solarssk/admitto/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/solarssk/admitto/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/solarssk/admitto/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/solarssk/admitto/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/solarssk/admitto/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/solarssk/admitto/releases/tag/v0.1.0
