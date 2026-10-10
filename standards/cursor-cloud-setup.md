# Cursor Cloud: environment notes

Read only when running as a Cursor Cloud agent, or setting up a local Postgres/Redis environment.

---

## Cursor Cloud specific instructions

Notes for Cursor Cloud agents. The startup update script only runs `npm install`; everything
below is intentionally **not** in that script (services, env, one-off setup) and persists in the
VM snapshot. Standard build/run/test commands live in [README.md](../README.md).

- **Node 24 required** (`engines`). nvm's default is set to 24, so fresh login shells use it. If
  `node -v` prints 22, run `nvm use 24` - the `/exec-daemon/node` shim is v22 and can precede nvm
  on `PATH` in non-login shells.
- **Postgres + Redis are native (no Docker).** Docker is not installed here; Postgres 16 and
  Redis 7 are installed via apt and are **not** auto-started. Start them each session:
  `sudo pg_ctlcluster 16 main start` and `sudo redis-server /etc/redis/redis.conf --daemonize yes`.
  Role/creds `admitto`/`admitto`, database `admitto`, and the `admitto_*_test` databases are
  already created + migrated + seeded in the snapshot. `infra/docker-compose.yml` is unused - the
  test-db scripts fall back to local `psql`/`createdb`.
- **Local env files (gitignored):** `packages/db/.env` and `apps/web/.env` hold the dev
  `DATABASE_URL`, a generated `ENCRYPTION_KEY`, and `REDIS_URL=redis://localhost:6379`. Recreate
  from the matching `.env.example` if missing.
- **Tests:** `npm test`. `apps/web` integration tests start a Testcontainers Redis unless
  `REDIS_URL` is set; since Docker is absent, `export REDIS_URL=redis://localhost:6379` before
  `npm test` so they use the native Redis.
- **Run the app:** `npm run build -w @admitto/admin` once, then `npm run dev -w @admitto/web`
  serves the SPA at http://localhost:3000 (`/admin` after login). For SPA hot-reload also run
  `npm run dev -w @admitto/admin` (Vite :5173, proxies API to :3000).
- **First login needs MFA:** admin/superadmin roles must enroll TOTP on first login. Bootstrap a
  new superadmin with `npm run auth:bootstrap -- --email you@example.com` (password read from
  stdin); you will be prompted to enrol TOTP on first login. To clear an existing account's TOTP
  (e.g. the snapshot's pre-seeded account), run
  `npm run cli -w @admitto/auth -- reset-mfa --email you@example.com`.
