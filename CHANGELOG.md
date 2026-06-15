# Changelog

This project is still pre-`1.0`.
This changelog is intended to do two things at once:

- give the team a milestone-by-milestone picture of what Admitto can already do,
- and preserve the architectural intent behind each release, not just a flat list of filenames.

It is still not a polished public release feed.
At this stage it is an internal engineering changelog for a product that is still converging on its
first event-ready MVP.

## Unreleased

### Cloudflare Access pass-through (prompt 16c / v0.3.5)

- **Conditional edge gate (ADR 0017):** validates `Cf-Access-Jwt-Assertion` on `/admin*` and `/api/admin*`
  only; absent JWT → `/login` boundary (not 401); invalid JWT → reject without session fallback.
- **Per-request auth:** CF JWT resolves to `User` via `ExternalIdentity` without creating a long-lived
  Admitto session (revocation invariant).
- **Config:** `SystemSettings` keys with `env > DB > default` locks; superadmin UI at
  `/admin/auth/cf-access` with JWKS Test; boot fail-fast when enabled without team domain/AUD.
- **Staff entrypoint:** `GET /` redirects to `/login` (shared login boundary).

## v0.3.4 — 2026-06-15

OIDC linking (prompt 16b) and security hygiene (prompt 18 / ADR 0016 DO-NOW).

This milestone adds corporate SSO via OIDC (Authentik-first) as an additive login path, then hardens
RBAC/OIDC data integrity, outbound OIDC admin saves, check-in API limits, and SMTP TLS before the
next auth work (Cloudflare Access / 16c).

### OIDC linking (`@admitto/auth`, PR #47)

- **Additive login:** Authorization Code + PKCE; server-side `state` / `nonce`; full ID token validation
  (JWKS, `iss`, `aud`, `exp`, `nonce`). Local `User` linked through `ExternalIdentity`.
- **JIT provisioning:** new OIDC users get **zero roles** unless a configured group→role rule matches
  (fail-closed; not read-only by default).
- **Grant ownership:** `OidcRoleGrant` rows track OIDC-provisioned roles; demotion revokes grants without
  touching manual `RoleAssignment` rows.
- **Sessions:** OIDC logins receive `full` sessions with `auth_method=oidc` (local TOTP skipped — MFA is
  the IdP's responsibility per ADR 0011).
- **Account linking:** explicit `?link=1` → `/account/oidc/:id/link` step-up (password + TOTP when required);
  `link_step_up_at` on OAuth state (5 min TTL at callback); OIDC flow cookie binds callback to the
  initiating browser.
- **Superadmin UI:** server-rendered `/admin/auth/providers` — IdP config, write-only `client_secret`, Test
  connection, transactional save.
- **SSRF guards:** `assertSafeOidcFetchUrl` blocks private/link-local targets (RFC 1918, IMDS, IPv6 ULA)
  on outbound OIDC discovery/token fetches.
- **Seam:** `resolveOrCreateUserFromExternalIdentity` shared with future Cloudflare Access (16c).

### Security hygiene (PR #48)

- **RBAC-2:** deduplicate `RoleAssignment` rows, then partial UNIQUE indexes (scoped rows + instance rows
  where `scope_id IS NULL`). Migration repoints `OidcRoleGrant` to the survivor assignment before dedup.
- **SEC-2:** orphan `OidcRoleGrant` cleanup; FK `OidcRoleGrant.role_assignment_id → RoleAssignment` with
  `ON DELETE CASCADE`; Prisma relation on both sides.
- **SEC-3:** OIDC discovery/endpoints resolved **before** `$transaction` in provider save paths (no
  network I/O inside DB transactions).
- **OIDC grant races:** idempotent grant creation under concurrent logins (`P2002` → safe no-op; winner
  creates assignment + grant in one transaction).
- **API-001:** check-in history `limit` clamped to **1–100** at HTTP and domain layers.
- **TLS P1:** SMTP adapter `minVersion: "TLSv1.2"`.
- **CI:** `prisma migrate deploy` on `admitto_auth_test` before auth integration tests.

### Database

Migrations (run in order on deploy; folder names as merged on `main`):

- `20260615120000_oidc_linking` — `IdentityProvider`, `ExternalIdentity`, OIDC OAuth state tables.
- `20260615140000_oidc_hardening` — OIDC schema/index hardening from review.
- `20260615160000_oidc_scope_normalization` — scope normalization for group→role mappings.
- `20260615170000_oidc_link_step_up` — `link_step_up_at` on OAuth state.
- `20260615180000_oidc_role_grants` — `OidcRoleGrant` + group mapping tables.
- `20260615190000_role_assignment_unique` — dedup, partial UNIQUE indexes, grant repoint, FK cascade.

### Deploy notes

```bash
npm run db:migrate
```

- Set `ENCRYPTION_KEY` (32-byte base64) — required for encrypted IdP `client_secret` and existing TOTP
  secrets.
- Configure at least one OIDC provider in `/admin/auth/providers` before expecting SSO logins.
- After migrate `20260615190000`, duplicate `RoleAssignment` rows are removed automatically; surviving
  OIDC grants are repointed to the oldest row per `(user, role, scope)`.
- Set `TRUST_PROXY=true` behind nginx/traefik when the app is not directly exposed.
- SMTP paths now require TLS 1.2+ from the server — verify legacy mail relays before go-live.

### Not in this release

- Cloudflare Access / header identity (prompt 16c)
- DNS rebinding hardening for OIDC SSRF (SEC-1 — deferred per ADR 0016)
- Tabler admin UI (`v0.4`)
- `viewer` read-only RBAC role (RBAC-1 — deferred)

### Next

- Prompt 16c — Cloudflare Access seam on top of `ExternalIdentity`
- `v0.4` — Tabler admin UI foundation


## v0.3.3 - 2026-06-14

2FA / TOTP for admin and superadmin (prompt 16a).

This milestone adds a second authentication factor for elevated roles while keeping operator login
unchanged. Partial sessions (`mfa_pending`, `enrollment_required`) gate admin actions until TOTP
enrollment and verification complete; break-glass CLI commands cover lost authenticator scenarios.

### MFA domain (`@admitto/auth`)

- **`UserMfaMethod`:** `totp` and `recovery` rows (seam for future `webauthn`); TOTP `secret_enc` via
  `@admitto/crypto`; backup recovery codes hashed (argon2id), one-time use.
- **Login stages:** admin/superadmin → `mfa_pending` or `enrollment_required`; operators → full session
  after password (no 2FA friction on event day).
- **TOTP:** enroll + confirm, verify with otplib v13 (`epochTolerance: 30` = ±30 s); MFA verify rate
  limits (separate buckets for TOTP vs recovery codes).
- **Trusted device:** optional `admitto_trusted_device` cookie (hash-only in DB); skip TOTP on
  remember; revoked on logout, MFA reset, and session revoke paths.
- **Break-glass CLI:** `reset-mfa`, `generate-emergency-recovery` (password from stdin, no echo,
  superadmin@instance only, audit log).
- **`SystemSettings`:** `session_ttl`, `operator_session_ttl`, `trusted_device_days`,
  `mfa_required_roles` (env lock → DB → default).
- **Session hardening:** `createSession` derives partial stage when omitted (fail-closed for MFA users);
  `validateSession` re-checks MFA policy; `promoteSessionToFull` requires non-expired partial session.

### HTTP (API + minimal HTML)

- **API:** `POST /api/auth/mfa/verify`, `POST /api/auth/mfa/totp/enroll`, `POST /api/auth/mfa/totp/confirm`.
- **HTML:** `GET/POST /mfa/verify`; `GET /mfa/enroll` (read-only), `POST /mfa/enroll/start`,
  `POST /mfa/enroll` (CSRF-protected); safe `?next=` via `resolveSafeRedirectPath`.
- **Gates:** only `full` session grants `/api/auth/me`, check-in, and `/operator`; partial sessions
  blocked from privileged routes.

### Database

- Migration `20260614130000_2fa_totp`: `Session.stage`, `UserMfaMethod`, `TrustedDevice`,
  `SystemSettings` seed; active elevated sessions re-staged to `mfa_pending` / `enrollment_required`
  with `expires_at` clamped (`LEAST`, max 15 minutes).
- Migration `20260614210000_totp_replay_protection`: `UserMfaMethod.last_totp_time_step` (nullable int).

### Dependencies

Bundled Dependabot updates (closes #40–#45):

- **`@admitto/web`:** `hono` 4.12.25, `@hono/node-server` 2.0.4, `redis` 6.0.0.
- **`@admitto/mailer` / `@admitto/import`:** `zod` 4.4.3 (no code changes — `z.string().email()` unchanged).
- **Root:** `@typescript-eslint/parser` 8.61.0.
- **CI:** `github/codeql-action` → `8aad20d1` in `codeql.yml` and `semgrep.yml`.
- **Adapter:** `RedisRateLimitStore` uses `withAbortSignal()` + two-arg `eval()` for redis v6.

### Security

- **CSRF / `TRUST_PROXY`:** `resolveRequestOrigin` honours `X-Forwarded-Proto` and `X-Forwarded-Host`
  only when `TRUST_PROXY=true`, matching the existing rate-limit client-IP policy. Defense-in-depth when
  the app is reachable without a sanitizing reverse proxy.
- **`resolveTrustProxy`:** shared env parser in `apps/web/src/config.ts` (CSRF + rate limits).
- **TOTP replay protection:** `UserMfaMethod.last_totp_time_step` + otplib `afterTimeStep`; login MFA
  verify rejects reuse of the same time-step code; conditional DB update guards parallel replay.

### Deploy notes

- Run `npm run db:migrate` on deploy (new migration required — includes `last_totp_time_step`).
- Set `ENCRYPTION_KEY` (32-byte base64) in production — required for TOTP `secret_enc`.
- Set `TRUST_PROXY=true` behind nginx/traefik (rate limits, audit IP, and CSRF origin); proxy must
  overwrite client-supplied `X-Forwarded-*` headers.
- After rollout, existing admin/superadmin sessions are re-staged — users must complete enrollment or
  MFA verify before admin/check-in access; plan communication before an event.
- Break-glass: `npm run cli -w @admitto/auth -- reset-mfa --email <superadmin>` (server-side only).

### Not in this release

- OIDC linking (`v0.3.4` / prompt 16b)
- WebAuthn / passkeys (schema seam only)
- Admin UI for MFA (Tabler / v0.4)
- Encryption key rotation and expired trusted-device cleanup jobs

## v0.3.2 - 2026-06-14

Operator login, session-first check-in, Mode B `public_ref`, and stable web test infrastructure.

This milestone closes the gap between auth core (`v0.3.1`) and event-day operator work: tablets log in
with a real session, check-in is session-first with Bearer as break-glass only, and agency ticket URLs
no longer expose internal attendee IDs.

### Operator login (HTML)

- Added server-rendered operator auth: `GET/POST /login`, `GET /operator`, `POST /logout`.
- `/operator` is a temporary post-login landing (events from RBAC, sign-out) — not the v0.4 admin UI.
- Reused API session cookie (`httpOnly`, `SameSite=Lax`); optional `device_label` on login (capped server-side).
- CSRF guards on HTML and JSON login/logout and on session-authenticated `POST /api/checkin/scan`.
- Login rate limits (IP + per-email on failed attempts); HTML 429 returns plain text, API returns JSON.

### Check-in: session-first, Bearer break-glass

- Default `ALLOW_CHECKIN_BEARER=false`; boot-time validation via `validateCheckinBootConfig()`.
- Gate pipeline: `preAuth` → optional session CSRF (scan) → rate limit → body parse → `eventScope`.
- Per-operator scan/history rate limits after authentication (not shared IP quota for authed traffic).
- Removed legacy bearer-only gate helpers; tests use `preAuth` + `eventScope`.

### Mode B — `public_ref`

- Added `Attendee.public_ref` (unique, non-guessable); agency import generates refs on create.
- Public routes `/t/:slug/a/:ref` and `/q/:slug/a/:ref.png` resolve by `public_ref`, not `Attendee.id`.
- Mail ticket links require `public_ref` for Mode B; per-attendee skip when missing.
- Backfill on deploy: `npm run db:migrate` runs migrations plus agency `public_ref` backfill.

### Test infrastructure (ADR 0015)

- Fixed CI failures from shared `admitto_web_test` DB (`P3005`, Prisma segfault on repeated
  `force-reset`): fixture cleanup instead of per-file DB resets (#36).
- Stabilized `@admitto/web` tests: Vitest **unit** (no Postgres) vs **integration** (one `globalSetup`
  with `migrate deploy`), integration files under `test/integration/` (#37).
- Added `scripts/test-web-like-ci.sh` for local CI parity; contract in `apps/web/test/README.md`.

### Deploy notes

- Set `ALLOW_CHECKIN_BEARER=false` in production; keep `CHECKIN_OPERATOR_TOKEN` only for break-glass.
- Run `npm run db:migrate` on deploy (includes `public_ref` backfill).
- Legacy Mode B URLs using `Attendee.id` in the path no longer work; resend tickets if needed.

### Not in this release

- 2FA / TOTP (planned for `v0.3.3`)
- OIDC linking (`v0.3.4`)
- Operator scan UI (`v0.4`)

## v0.3.1 - 2026-06-14

Auth core foundation.

This release is the first real identity and session layer for Admitto.
It moves the system away from “temporary guarded endpoints” toward a model where operator work can be
attributed to real users, sessions can be revoked, and future operator/admin UI has a stable backend
auth contract to build on.

### Identity and account model

- Introduced first-class local `User` accounts as the baseline identity model.
- Used `argon2id` password hashing for local credentials.
- Added `is_active` account state so a user can be disabled without deleting history.
- Included CLI bootstrap for a local break-glass superadmin:
  - `npm run auth:bootstrap -- --email admin@example.com`
  - password is read from stdin / prompt, not argv
  - creates a first-run local `superadmin@instance`

### Sessions and revocation

- Added DB-backed `Session` records instead of stateless browser auth.
- Session tokens are opaque and high-entropy; only `token_hash` is stored in the database.
- Added expiry and revocation handling to session validation.
- Added support for revoking a single session and bulk-revoking operator sessions for an event.
- Established role-sensitive session lifetime defaults:
  - shorter-lived operator sessions
  - longer-lived admin and superadmin sessions

### Auth package and backend API

- Added new `@admitto/auth` package as the core auth domain layer.
- Implemented:
  - login flow
  - logout flow
  - session validation
  - password verification helpers
  - auth audit logging
  - capability-aware authorization helpers
- Added HTTP auth endpoints:
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`

### Security posture of the login flow

- Added uniform unauthorized responses for bad email / bad password to reduce user enumeration risk.
- Added dummy verification path for missing users.
- Added rate limiting for login attempts.
- Added structured login audit logs without password or session token leakage.
- Added `httpOnly` session cookie handling with `SameSite=Lax` and `Secure` outside development.

### RBAC and check-in authorization

- Kept `RoleAssignment` as the role/scope source of truth, but replaced raw exact-match middleware with capability-aware checks.
- Introduced event-aware authorization helpers such as:
  - `canPerformCheckIn`
  - `canManageEvent`
  - `canManageInstance`
- Established the intended check-in access model:
  - `superadmin@instance` -> all events
  - `admin@organization` -> events in that organization
  - `operator@event` -> only assigned events

### Safe migration of `/api/checkin/*`

- Extended `/api/checkin/*` to accept:
  - a valid session with correct event scope
  - or the transitional legacy Bearer token
- Preserved ADR 0003 deploy policy so check-in never becomes public during the migration.
- Kept missing `CHECKIN_OPERATOR_TOKEN` behavior unchanged:
  - `503` in development
  - fail-fast at boot in non-development environments
- Added route-specific `eventId` extraction rules for session-gated check-in endpoints.

### Why this release matters

`v0.3.1` is not just “login endpoints landed”.
It is the release that turns auth into a real subsystem:

- real local accounts
- revocable sessions
- explicit check-in authorization
- break-glass superadmin
- and a safe bridge from the shared Bearer-token era to future session-first operator work

This is the backend prerequisite for:

- operator login UI
- session-backed check-in attribution
- admin/session revocation workflows
- 2FA
- and OIDC linking in the next auth milestone

## v0.3.0 - 2026-06-13

Mailer milestone completed.

This release closes the first mail-delivery milestone and adds the first shared infra hardening for
public ticket routes.

### Mail-delivery operations

- Added provider-level test-send support so one message can be sent per event without triggering the
  full attendee-delivery flow.
- Added read-only config inspection with masked secrets.
- Added delivery-log listing without exposing sensitive rendered HTML payloads.

### Public route hardening

- Added Redis-backed shared rate limiting for public `/t/*` and `/q/*` routes.
- Kept in-memory rate limiting as the default local/dev path when `REDIS_URL` is not configured.
- Added shared, cross-instance counters when Redis is configured.
- Preserved fail-open behavior if Redis is configured but unavailable, prioritizing ticket access
  availability over strict limiting during an outage.

### Why this release matters

`v0.3.0` is the point where Admitto stops being “can render/send mail in principle” and becomes
operationally closer to “can inspect, test, and protect the delivery surface”.

## v0.2.4 - 2026-06-11

Post-merge hardening.

This release tightened several foundational guardrails after the first multi-tenant/encryption pass.

- Added defensive DB `CHECK` constraints on `RoleAssignment`.
- Hardened crypto key-version behavior.
- Hardened seed behavior around missing encryption keys so local/setup paths fail more predictably.

### Why this release matters

`v0.2.4` is small in scope but important in posture: it reduces the chance that invalid role/scope
data or partially configured crypto state quietly slips into the system.

## v0.2.3 - 2026-06-11

Multi-tenant foundation and encryption.

This release is where Admitto stopped being a single-event toy model and gained the core shapes
needed for multi-client or multi-organization operation.

### Tenant model

- Added `Organization` as the tenant boundary.
- Threaded `organization_id` through the core event and delivery model.
- Established role/scope groundwork for:
  - `superadmin`
  - `admin`
  - `operator`

### Sensitive token handling

- Added encrypted attendee token storage via `@admitto/crypto`.
- Preserved the principle that raw ticket tokens should not be casually exposed or left lying around
  in plaintext persistence.

### Why this release matters

This is one of the most structurally important releases so far:

- it makes later mail configuration scope possible,
- it makes organization-aware RBAC possible,
- and it creates the data model that later auth, reporting, and operations all depend on.

## v0.2.2 - 2026-06-11

PostgreSQL-only infra foundation.

This release simplifies the persistence story and removes split-brain assumptions between environments.

- Standardized on PostgreSQL across development, CI, and production.
- Added docker-compose support for local setup.
- Added CI service wiring for the real database path.
- Strengthened relational guarantees around check-in data.

### Why this release matters

Choosing one real database engine early avoids a large class of “works locally, breaks in prod”
schema and query problems.
This also gave later milestones a stable base for migrations, tests, and operational runbooks.

## v0.2.1 - 2026-06-11

Check-in backend foundation.

This release established the first real event-day backend behavior.

- Added atomic single-use check-in behavior.
- Added recent-history support for check-in activity.
- Added the temporary operator Bearer gate for `/api/checkin/*` so state-changing admission routes
  are not publicly callable.

### Why this release matters

`v0.2.1` is where Admitto gained a real admission boundary instead of only ticket rendering.
Even though the auth model was still temporary, this release created the security and concurrency
baseline for later operator-facing work.

## v0.2.0 - 2026-06-08

Core ticketing foundation.

This release established the product’s first end-to-end guest/ticket model.

- Added attendee import foundations.
- Added internal token and QR issuance.
- Added agency UUID / external payload support.
- Added public ticket page routes.
- Added the split between internally generated token-based tickets and agency-provided identifiers.

### Why this release matters

This is the release where Admitto first became recognizable as an event access gateway rather than a
generic monorepo skeleton.

## v0.1.0 - 2026-06-08

Project skeleton and Gate 0 outcome.

Initial project skeleton and validated starting assumptions.

- Landed monorepo setup.
- Added the first DB schema and package boundaries.
- Added CI and basic security baseline.
- Added mail adapter groundwork.
- Recorded the Gate 0 outcome that Power Automate remains the MVP mail path while Graph/SMTP stay
  future re-validation candidates.

### Why this release matters

`v0.1.0` set the product direction:

- Admitto is not a generic event platform,
- mail delivery is a core operational constraint,
- and the codebase should be built around a narrow, reviewable, security-conscious MVP path.
