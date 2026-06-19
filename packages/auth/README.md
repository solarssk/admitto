# @admitto/auth

Authentication and authorization for Admitto — local accounts, opaque DB sessions, MFA (TOTP), OIDC linking, Cloudflare Access JWT validation, and RBAC capability checks (ADR 0011, 0016b, 0016c, 0017).

## Responsibilities

| Area | What lives here |
|------|-----------------|
| **Local auth** | Argon2 passwords, login/logout, session cookies |
| **Sessions** | Opaque server-side sessions; separate TTL for admin vs operator |
| **MFA** | TOTP enrollment, backup codes, trusted devices, break-glass recovery |
| **OIDC** | Provider CRUD, PKCE authorize flow, group→role mapping, external identity JIT |
| **Cloudflare Access** | `Cf-Access-Jwt-Assertion` validation on admin collision paths |
| **RBAC** | `canManageEvent`, `canPerformCheckIn`, `canManageInstance`, etc. — scope-bound flat roles (ADR 0005) |

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

Requires `DATABASE_URL` and `ENCRYPTION_KEY`. Password is read from stdin (never pass on argv).

**Local dev** (from repo root):

```bash
npm run cli -w @admitto/auth -- bootstrap-superadmin --email admin@example.com
npm run cli -w @admitto/auth -- reset-mfa --email superadmin@example.com
npm run cli -w @admitto/auth -- generate-emergency-recovery --email superadmin@example.com
```

**Docker production** — the runtime image has no `npm`/`npx`; use `node` via the app entrypoint passthrough (see [`deploy/README.md`](../../deploy/README.md)):

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
