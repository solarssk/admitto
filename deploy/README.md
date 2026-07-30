# Admitto deployment (Docker)

Production-oriented compose: **app + PostgreSQL + Redis + nginx reverse proxy**.

Dev/CI database stack remains in [`../infra/docker-compose.yml`](../infra/docker-compose.yml) — do not use dev creds here.

## Deployment model

Admitto is **self-hosted**: you run it on infrastructure you control (VPS, on-prem server, NAS with Docker, etc.). We do **not** ship a managed cloud service.

The **only supported production path** in this repo is a **Docker Compose stack** — not bare-metal installs (Node/Postgres directly on the host), not Kubernetes/Helm, and **not Vercel** (root [`vercel.json`](../vercel.json) disables Git-linked Vercel deploys; delete or disconnect the project in the Vercel dashboard if it still appears on PRs). You need **Docker Engine** (or Docker Desktop for local smoke tests) on the host; everything else runs inside containers.

What you get in `deploy/`:

| Piece | Role |
|-------|------|
| `Dockerfile` | Builds the `app` image (Node monorepo → production runtime) |
| `docker-compose.yml` | Orchestrates `app`, Postgres, Redis, and an internal nginx proxy |
| `.env` (from `.env.example`) | Secrets and config — never committed |
| **ghcr.io image** | `ghcr.io/solarssk/admitto:X.Y.Z` — published automatically on each git tag `vX.Y.Z` |

TLS termination and public DNS usually sit **in front** of this stack (e.g. Nginx Proxy Manager, Cloudflare) forwarding to `http://<docker-host>:8080` — see below.

## GitHub Container Registry (ghcr.io)

Each release tag `vX.Y.Z` triggers [`.github/workflows/publish-container.yml`](../.github/workflows/publish-container.yml) and pushes:

```text
ghcr.io/solarssk/admitto:X.Y.Z
ghcr.io/solarssk/admitto:X.Y      # minor line (e.g. 0.3)
```

Images are built on `linux/amd64` (GitHub Actions) — suitable for typical VPS hosts.

### Pull on the server (recommended for production)

```bash
cd deploy
cp .env.example .env
# Set secrets, then pin the release image (version without leading v):
# ADMITTO_IMAGE=ghcr.io/solarssk/admitto:0.4.11

docker compose pull app
docker compose up -d --no-build
```

If the package is **private**, log in once on the host:

```bash
echo "$GITHUB_PAT" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
# PAT needs read:packages
```

Public repo → package is usually public; private repo → configure package visibility under GitHub **Packages**.

### Build on the server (alternative)

Omit `ADMITTO_IMAGE` or leave the default `ghcr.io/solarssk/admitto:local` — compose builds and tags locally:

```bash
docker compose up -d --build
```

## Platform and image architecture

**Target runtime:** Linux containers. Official base images (`node:24-bookworm-slim`, `postgres:16`, `redis:7`, `nginx`) are multi-arch, but the **`app` image must match the CPU of the machine that runs it**.

| Build where | Image CPU | Typical use |
|-------------|-----------|---------------|
| GitHub Actions (`docker-build` / `publish-container` on `v*` tag) | `linux/amd64` | CI validation; **published ghcr releases** |
| Your production server (`docker compose build` on the host) | Same as the host | First deploy or air-gapped |
| Apple Silicon Mac (`docker compose build` locally) | `linux/arm64` | Dev/smoke only — **do not** push that image to an amd64 VPS |

**Why it matters:** `prisma generate` runs at image build time and embeds a native query-engine binary for the build platform. An `arm64` image on an `amd64` server (or the reverse) will fail at startup.

**Practical rule:** build on the server you deploy to, or cross-build explicitly:

```bash
docker build --platform linux/amd64 -f Dockerfile -t admitto-app ..
```

We have not tested or documented Synology ARM vs Intel paths separately — pick the platform flag that matches your NAS/CPU.

## Quick start

```bash
cd deploy
cp .env.example .env
# Edit .env:
#   POSTGRES_PASSWORD (openssl rand -hex 32)
#   REDIS_PASSWORD (openssl rand -hex 32) — keep REDIS_URL password in sync
#   ENCRYPTION_KEY (openssl rand -base64 32)
#   DATABASE_URL — same password as POSTGRES_PASSWORD
#   BASE_URL — production: https://tickets.example.com; local smoke: http://127.0.0.1:8080
# Set EMAIL_PROVIDER to one of: smtp, graph, powerautomate (production paths)
# export_only is dev/test dry-run only — requires a runtime exportSink; npm run dev wires one
# automatically; production deploy must use a real provider (default in .env.example: smtp).
# If EMAIL_PROVIDER=export_only slips into production anyway, boot logs a warning but does not
# exit — mail sends fail at runtime until a real provider is configured.
# Populate only the mail section for that provider

./validate-env.sh
docker compose up -d --build
curl -sf http://127.0.0.1:8080/healthz
```

The app listens on port 3000 **inside** the compose network only. Use the proxy on `127.0.0.1:8080`.

## Upgrading from v0.4.4 or earlier

Releases before authenticated Redis require a one-time `deploy/.env` update:

```bash
cd deploy
# Generate a strong Redis password (keep it secret):
openssl rand -hex 32
# Add or replace in .env:
#   REDIS_PASSWORD=<generated>
# Ensure DATABASE_URL password still matches POSTGRES_PASSWORD.
./validate-env.sh
docker compose pull app   # or set ADMITTO_IMAGE to the new tag
docker compose up -d
```

`validate-env.sh` checks placeholders, secret lengths, `BASE_URL` (`https://` on production hosts), and `DATABASE_URL` / `POSTGRES_PASSWORD` consistency. The app container also fails fast at boot if `REDIS_URL`, `ENCRYPTION_KEY`, or `BASE_URL` are misconfigured.

## Container startup (entrypoint)

Migration/backup and serving are two separate one-shot-then-long-running compose services, both
running `deploy/docker-entrypoint.sh` (same image, different `command:`). `app` only starts once
`migrate` exits 0 (`depends_on: condition: service_completed_successfully`), so the web server
never runs any of this itself and never runs as root (docker:S6471).

**`migrate`** (`user: root` — the only service that is; needed to write into the root-only
`migration_backups` volume) runs **fail-fast** (any step fails → exits nonzero, `app` never starts):

1. `prisma migrate status` — detect pending migrations (text parse; connection errors abort with a clear log)
2. **If pending migrations** and backup not disabled: pre-migration `pg_dump` to the `migration_backups` volume (`/backups/pre-migration-<UTC>.sql.gz`, `gzip -t` integrity check, `install -m 600`). If `pg_dump` fails → **no migrate**. Routine restarts with no pending migrations skip the dump.
3. `prisma migrate deploy` — idempotent schema migrations (automatic; operators never run this by hand; drops to the `node` user for this and every step below)
4. `backfill-public-ref.js` and other idempotent backfills (safe to re-run; throw if DB/schema incompatible)

**`app`** (always runs as `node`, never root) then runs its own startup step — best-effort retention cleanup (120s timeout each, non-fatal on failure): expired/revoked auth sessions and trusted devices (`purge-auth-retention`), stale email delivery HTML/subject snapshots (`nullify-delivery-snapshots`), then stale `SecurityAuditLog` rows (`purge-security-audit-log`, default 30 days, `SECURITY_AUDIT_LOG_RETENTION_DAYS`) — before execing `node apps/web/dist/src/index.js`. Retention lives here rather than in `migrate` because `migrate`'s `depends_on: condition: service_completed_successfully` is only evaluated on `docker compose up`; a bare `app` restart (crash loop, `docker compose restart app`, `restart: unless-stopped`) never re-runs `migrate`, so retention needs to run on every `app` start independently to keep its original on-every-boot cadence. No migration logic here, and no filesystem access to `/backups` at all (not mounted).

**Operator upgrade:** pull the new image and `docker compose up -d` — migrations apply automatically with a restore point when needed. No manual migration step.

Env (see `.env.example`): `MIGRATION_BACKUP_DIR`, `MIGRATION_BACKUP_RETENTION`, `MIGRATION_BACKUP_MIN_FREE_MB` (default 512 — tune per deployment), `MIGRATION_BACKUP_DISABLE` (dev/test only).

Copy pre-migration backups offsite per ADR 0023 (backup and disaster recovery — internal archive) (nightly dumps are separate).

Schema change policy (expand-contract, CI guard): [packages/db/README.md](../packages/db/README.md#schema-change-policy).

For one-off CLI (bootstrap, MFA reset), the entrypoint passes through `node …` without starting the web server — see below. `npm`/`npx` are not available in the production image.

## Container logs (what to expect where)

Per-container stdout, by design (SECURITY-CONTROLS: logs are operational — no PII, secrets, or tokens; no built-in SIEM):

| Container | What its logs show |
|-----------|--------------------|
| `migrate` | Entrypoint boot steps (migration status, backup, backfills) — a one-shot container, exits after logging `migrate: startup tasks complete` |
| `app` | Retention cleanup lines on every start, then `Admitto web running at …`, then: JSON access log (one line per request — method, redacted path, status, `duration_ms`) when `LOG_HTTP_REQUESTS=1` (compose default), plus sparse JSON events (import, upload, `/readyz` auth failure, SPA client errors) |
| `proxy` | Nginx access/error log (image default) — includes client IPs; rotate/limit via Docker logging options if kept long-term |
| `retention` | `[retention] …` prefixed lines per nightly run |
| `db-backup` | `[db-backup] …` prefixed lines per nightly dump |
| `db` / `redis` | Image defaults (Postgres startup/checkpoints, Redis notices) |

**Decision (issue #237):** the `app` access log is the supported way to see request activity in Portainer/`docker logs`. It deliberately excludes IPs, user agents, cookies, and query strings; ticket/QR paths are logged as `/t/[redacted]` and `/q/[redacted]` so QR tokens never reach stdout. Successful `/healthz`/`/readyz` probes are skipped (Docker healthcheck fires every 10s); failing probes are logged. Request-level *attribution* (who did what) stays in the DB audit log; client IPs stay at the proxy layer. Disable with `LOG_HTTP_REQUESTS=0` in `deploy/.env`.

## First superadmin

On a **fresh database** (no users), open the app URL — you are redirected to **`/setup`**
automatically (`/`, `/login`, and other staff paths send you there until the first account exists).

Create the break-glass superadmin in the browser: email, display name, and password (min. 12
characters). After submit you enroll MFA, then the in-app setup wizard runs (mail, branding, first
event).

**CLI bootstrap** remains for break-glass recovery when the web UI is unavailable:

```bash
docker compose run --rm app node packages/auth/dist/cli.js bootstrap-superadmin \
  --email admin@example.com
```

From **v0.4.10** onward (drops the single-instance-superadmin index on migrate), additional
instance superadmins can be assigned in the admin UI (Users) or via OIDC group mappings.
Before demoting a superadmin in your IdP, ensure at least one other **active** instance superadmin
remains — see the OIDC offboarding runbook in [SECURITY-CONTROLS.md](../docs/SECURITY-CONTROLS.md).

## Emergency CLI (event-day failover)

When the admin SPA or scanner is down, use the unified emergency binary (same production `app` image — `npm`/`npx` are not available):

```bash
docker compose run --rm app node apps/cli/dist/index.js --help

# Manual lookup + admit (staging drill before the event)
docker compose run --rm app node apps/cli/dist/index.js checkin lookup --event <eventId> --query "jan kowal"
docker compose run --rm app node apps/cli/dist/index.js checkin admit --event <eventId> --attendee-id <attendeeId>

# Paper backup list (CSV) — use EMERGENCY_EXPORT_DIR (node-writable bind mount), NOT /app/uploads or /backups
# (/uploads/* is served without auth; /backups isn't even mounted on app — see migrate service)
docker compose run --rm app node apps/cli/dist/index.js attendees export --event <eventId> --out /app/emergency-exports/emergency-attendees-<eventId>.csv --operator-email super@example.com
# File lands on the host at deploy/emergency-exports/ (bind mount, not web-accessible). CLI writes mode 0600.

# Retry failed mail batch
docker compose run --rm app node apps/cli/dist/index.js mail retry-failed --event <eventId>

# Session break-glass (destructive — requires confirmation or --yes, and --operator-email for audit)
docker compose run --rm app node apps/cli/dist/index.js sessions revoke --user admin@example.com --operator-email super@example.com
docker compose run --rm app node apps/cli/dist/index.js sessions purge --all --yes --operator-email super@example.com

# Auth break-glass / retention
docker compose run --rm app node apps/cli/dist/index.js auth reset-mfa --email super@example.com
docker compose run --rm app node apps/cli/dist/index.js retention run --operator-email super@example.com
```

**Pre-event drill:** on staging, admit at least three test attendees using only `checkin lookup` → `checkin admit` and verify `AttendeeActionLog` / admitted status in admin.

Legacy per-package CLIs (`packages/auth/dist/cli.js`, `packages/mail-delivery/dist/cli.js`) remain for bootstrap and low-level retention (and are what actually run automatically — see below); `admitto retention run` combines auth + mail snapshot + security audit log cleanup in one audited command for manual/on-demand use.

## Nginx Proxy Manager (production edge)

NPM is the **TLS termination layer in front of this compose stack**. Forward **only** to:

```text
http://<docker-host>:8080
```

Do **not** forward NPM directly to `app:3000` or host port 3000.

NPM is the **trust boundary** for client IP and TLS. It must **overwrite** `X-Forwarded-For` with the real client IP — never append to a value the browser sent (`$proxy_add_x_forwarded_for` allows spoofing). Compose nginx (`deploy/nginx/default.conf`) uses `real_ip` from loopback/docker peers, then forwards a **single** `$remote_addr` to the app.

In NPM **Advanced** (or custom snippet), use:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
```

Use `$http_host` instead of `$host` when the public URL uses a non-default port (e.g. local smoke on `:8080`) so the CSRF origin check matches the browser `Origin` header.

Do **not** use `$proxy_add_x_forwarded_for` on the NPM vhost that faces the public internet. With `TRUST_PROXY=true`, Admitto reads the **first** `X-Forwarded-For` hop ([`client-ip.ts`](../apps/web/src/rate-limit/client-ip.ts)); an appended chain would let clients pick the rate-limit bucket and pollute audit logs. The first hop must be a **valid IP**; otherwise the app falls back to the TCP remote address (see [SECURITY-CONTROLS.md](../docs/SECURITY-CONTROLS.md)).

Compose nginx trusts **only `127.0.0.1`** as the RealIP peer (NPM on the host → `127.0.0.1:8080`). If NPM runs in Docker and hits the host via the bridge gateway (often `172.17.0.1`), add that single address to `deploy/nginx/default.conf` — do not widen to whole RFC1918 ranges.

That covers the first hop (NPM → compose nginx). The app has its **own**, second trust boundary: it only honours `X-Forwarded-For/Host/Proto` when the request's direct TCP peer is inside `TRUSTED_PROXY_CIDRS` ([`rate-limit/trust-proxy.ts`](../apps/web/src/rate-limit/trust-proxy.ts)) — `TRUST_PROXY=true` alone is not enough, since anything that can reach the app container directly could otherwise set those headers itself. Compose nginx and `app` are separate containers on the `internal` network, not sharing loopback, so this is **not** `127.0.0.1` — it's the network's fixed subnet (`docker-compose.yml`'s `networks.internal.ipam`), already set to match in `.env.example`. Only widen it if you added another trusted hop between compose nginx and the app.

(`$scheme` is `https` on the public NPM vhost; compose nginx forwards that value so `TRUST_PROXY` CSRF checks see HTTPS.)

For long-lived check-in SSE, add a custom location in NPM (or here in `default.conf`):

```nginx
location ~ ^/api/checkin/events/[^/]+/stream$ {
  proxy_buffering off;
  proxy_read_timeout 3600s;
  proxy_pass http://admitto_app;
}
```

Set `TRUST_PROXY=true` and `TRUSTED_PROXY_CIDRS` in `deploy/.env` (both already in `.env.example`).

## Cloudflare and WireGuard

See [`../../_ops/design/deployment-cloudflare-access.md`](../../_ops/design/deployment-cloudflare-access.md) for:

- Path classification (what stays bypass vs Access-protected)
- Origin invariant: reachable only via Cloudflare or WireGuard tunnel
- Pre-linking admins before enabling `CF_ACCESS_ENABLED`

Public attendee paths (`/t/*`, `/q/*`) must stay bypassed at Cloudflare.

## Retention (auth sessions, mail snapshots, security audit log)

**On app startup:** `docker-entrypoint.sh` runs `purge-auth-retention`,
`nullify-delivery-snapshots`, and `purge-security-audit-log` (best-effort, 120s timeout per CLI).

**Daily sidecar (`retention`):** the same CLIs run every 24 hours so long-lived stacks
do not skip retention between restarts. Logs:

```bash
docker compose logs -f retention
```

Manual one-off (same commands as the sidecar):

```bash
docker compose exec app node packages/auth/dist/cli.js purge-auth-retention
docker compose exec app node packages/mail-delivery/dist/cli.js nullify-delivery-snapshots
docker compose exec app node packages/auth/dist/cli.js purge-security-audit-log
```

`purge-security-audit-log` defaults to a 30-day window; override with
`SECURITY_AUDIT_LOG_RETENTION_DAYS` (see `.env.example`).

Failed runs log `FAILED` but do not stop the loop — check logs after deploy.

## PostgreSQL backups (ADR 0012, ADR 0027)

**Automatic (upgrades):** when pending migrations exist, the `migrate` service writes
`pre-migration-<UTC>.sql.gz` to the `migration_backups` volume before `migrate deploy`. Copy these
offsite when possible (ADR 0023).

**Automatic (nightly):** the `db-backup` sidecar writes `nightly-<UTC>.sql.gz` to the same
`migration_backups` volume (14-day retention via `find -mtime`; pre-migration files use count-based
`MIGRATION_BACKUP_RETENTION` instead). Verify after first deploy:

```bash
docker compose logs db-backup
docker compose exec db-backup sh -c 'ls -la /backups/nightly-*.sql.gz'
docker compose exec db-backup sh -c 'gzip -t /backups/nightly-*.sql.gz'
```

Nightly dumps on the host volume are **not** a full disaster-recovery strategy — copy offsite per
ADR 0023 (S3, rsync, or your backup tool). TODO: document operator-specific offsite copy.

**Manual (ops milestones):** run from the `deploy/` directory. Postgres credentials come from the **db container env** (compose `.env`), not your host shell — use `sh -c` so `$POSTGRES_USER` / `$POSTGRES_DB` expand inside the container:

```bash
# Pre-import
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup-pre-import.sql

# Post-import
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup-post-import.sql

# Post-send (after mail batch)
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup-post-send.sql

# Post-event
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup-post-event.sql
```

Test a restore on a non-production database before the first large event.

## Rollback runbook

`prisma migrate deploy` is forward-only — the database always rolls **forward**.
App rollback is a separate operation and covers the vast majority of incidents.

### Case A — bad app code, schema is fine (the common case)

Additive migrations keep the new schema backward-compatible with the previous app image.
Roll back by pointing at the previous image tag — **no DB operation needed, no data loss, ~30 seconds**.

**Portainer:** Stack → edit image tag → redeploy.

**CLI:**

```bash
# in deploy/.env: set ADMITTO_IMAGE to the previous tag, e.g. ghcr.io/solarssk/admitto:0.4.1
docker compose pull app && docker compose up -d app
```

This works for any number of skipped versions — all intermediate migrations are additive
(enforced by CI), so the old app runs safely against a newer schema.

### Case B — a bad migration destroyed or corrupted data (disaster only)

Stop the app, **empty the target database**, restore from the automatic pre-migration dump, redeploy the previous image.

Entrypoint backups are plain `pg_dump` SQL (`--no-owner`, no `--clean`). Replaying into a database that already ran the bad migration will hit existing tables/types and can leave a **partial** schema — not a true rollback. You must drop and recreate the application database first.

```bash
docker compose stop app

# Pick the dump written immediately before the failed upgrade (migration_backups volume).
# Use the migrate service, not app — app no longer mounts /backups at all (docker:S6471: the
# running web server has zero filesystem access to backup dumps, even read-only).
docker compose run --rm --no-deps --entrypoint sh migrate -c \
  'ls -lt /backups/pre-migration-*.sql.gz'

# Empty target DB (credentials from the db container env — same pattern as manual backups above)
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '\''$POSTGRES_DB'\'' AND pid <> pg_backend_pid()" \
  -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\"" \
  -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\""'

# Replay into the empty database (override entrypoint for restore — production image has no npm/npx)
docker compose run --rm --no-deps --entrypoint sh migrate -c \
  'gunzip -c /backups/pre-migration-<UTC-timestamp>.sql.gz | psql "$DATABASE_URL"'

# in deploy/.env: set ADMITTO_IMAGE to the previous tag, e.g. ghcr.io/solarssk/admitto:0.4.1
docker compose pull app && docker compose up -d app
```

Backups are written to the `migration_backups` volume before every `migrate deploy` run.
Restore point is always available; data loss is limited to changes between the dump and the incident.
Practice this on a non-production database before the first large event.

### Case C — the schema needs fixing after a bad migration

Do **not** reverse the migration. Ship a new corrective (additive) migration in the next release.

### Invariant

Every app release must run correctly against **both** the previous and the new schema (expand-contract).
That is what makes Case A — image rollback without touching the DB — safe by default.

## Uptime Kuma (observability)

Set `OPS_HEALTH_TOKEN` in `deploy/.env` (see `.env.example`). `/readyz` is **disabled** (404) until the token is set.

| Monitor | URL | Notes |
|---------|-----|-------|
| Basic up/down | `GET /healthz` | Expect HTTP 200 and body keyword `ok` (no auth). Rate-limited (120/min per IP) — do not poll faster from a single monitor source. |
| Critical readiness | `GET /readyz` | Header `Authorization: Bearer $OPS_HEALTH_TOKEN` or `X-Ops-Token: $OPS_HEALTH_TOKEN`; HTTP **503** = critical failure |
| DB | same `/readyz` | JSON-query: `$.checks.database.status == "ok"` |
| Redis | same `/readyz` | JSON-query: `$.checks.redis.status == "ok"` (or `disabled` when Redis not configured) |
| Mail queue | same `/readyz` | JSON-query: `$.gauges.email_deliveries_failed_retryable < 50` (adjust threshold) |

`/readyz` may sit on the Cloudflare Access bypass list — it is token-gated, not CF-protected. Docker `HEALTHCHECK` stays on `/healthz` only.

## TLS notes

- **Cloudflare public:** CF terminates TLS; origin can use HTTP on the internal/docker path (Full strict with origin cert is also supported).
- **WireGuard on-site:** trusted network path; local Admitto login still enforces admin TOTP.
- Compose nginx listens on HTTP `:8080` bound to loopback by default.

## Verify deployment

```bash
curl -sf http://127.0.0.1:8080/healthz    # expect {"status":"ok"}
curl -sf http://127.0.0.1:8080/login -o /dev/null -w '%{http_code}\n'  # expect 200
# POST /login through the proxy must not return 403 (CSRF); wrong credentials → 401 + error copy
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8080/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Origin: http://127.0.0.1:8080' \
  -d 'email=nobody@example.com&password=wrong'   # expect 401, not 403
# Port 3000 must NOT respond on the host (stop local `npm run dev` first if it binds :3000):
curl --connect-timeout 2 http://127.0.0.1:3000/healthz && echo unexpected || echo ok
```

## Stop

```bash
docker compose down
# docker compose down -v   # destroys postgres volume
```
