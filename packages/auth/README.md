# @admitto/auth

Authentication and authorization for Admitto - local accounts, opaque DB sessions, MFA (TOTP and WebAuthn passkeys / security keys), passkey sign-in, OIDC linking, Cloudflare Access JWT validation, and RBAC capability checks (ADR 0011, 0016b, 0016c, 0017).

## Responsibilities

| Area | What lives here |
|------|-----------------|
| **Local auth** | Argon2 passwords, login/logout, session cookies |
| **Sessions** | Opaque server-side sessions; separate TTL and idle timeout for admin vs operator. An operator-only account that signs in on the day of an event it is assigned to gets an event-day session instead (no idle window, ends at 06:00 the next local morning or the event's end if later; master switch `operator_event_day_sessions`, default on); admins and superadmins never do |
| **MFA** | TOTP enrollment, WebAuthn passkey / security-key registration and assertion (also passwordless passkey sign-in, gated by the `webauthn_enabled` / `passkey_login_enabled` settings), backup codes, trusted devices, break-glass recovery |
| **OIDC** | Provider CRUD, PKCE authorize flow, group→role mapping, external identity JIT |
| **Cloudflare Access** | `Cf-Access-Jwt-Assertion` validation on admin collision paths |
| **RBAC** | `canManageEvent`, `canPerformCheckIn`, `canManageInstance`, etc. - scope-bound flat roles (ADR 0005) |

`apps/web` wires HTTP routes and cookies; this package holds the domain logic.

## Import

```ts
import {
  login,
  validateSession,
  canManageEvent,
  bootstrapSuperadmin,
} from "@admitto/auth";
```

For integration tests, use `@admitto/auth/testing` helpers.

## CLI

Requires `DATABASE_URL`. Password is read from stdin (never pass on argv).

**Local dev** (from repo root):

```bash
npm run cli -w @admitto/auth -- bootstrap-superadmin --email admin@example.com
npm run cli -w @admitto/auth -- reset-mfa --email superadmin@example.com
npm run cli -w @admitto/auth -- generate-emergency-recovery --email superadmin@example.com
```

Other subcommands: `bootstrap-superadmin --email <email> --force` (create another superadmin; asks for confirmation), `purge-auth-retention [--dry-run]` (expired and revoked sessions and trusted devices) and `purge-security-audit-log [--dry-run]` (rows older than `SECURITY_AUDIT_LOG_RETENTION_DAYS`, 30 by default). `reset-mfa` and `generate-emergency-recovery` work only for the `superadmin@instance` user and read that user's current password from stdin.

**Docker production** - the runtime image has no `npm`/`npx`; use `node` via the app entrypoint passthrough (see [`deploy/README.md`](../../deploy/README.md)):

```bash
docker compose run --rm app node packages/auth/dist/cli.js bootstrap-superadmin \
  --email admin@example.com
docker compose run --rm app node packages/auth/dist/cli.js reset-mfa \
  --email superadmin@example.com
docker compose run --rm app node packages/auth/dist/cli.js generate-emergency-recovery \
  --email superadmin@example.com
```

## Tests

```bash
npm run db:test-setup   # from repo root
npm run test:unit -w @admitto/auth
npm run test:integration -w @admitto/auth
```
