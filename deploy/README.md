# Admitto deployment (Docker)

Production-oriented compose: **app + PostgreSQL + Redis + nginx reverse proxy**.

Dev/CI database stack remains in [`../infra/docker-compose.yml`](../infra/docker-compose.yml) — do not use dev creds here.

## Deployment model

Admitto is **self-hosted**: you run it on infrastructure you control (VPS, on-prem server, NAS with Docker, etc.). We do **not** ship a managed cloud service.

The **only supported production path** in this repo is a **Docker Compose stack** - not bare-metal installs (Node/Postgres directly on the host), not Kubernetes/Helm, and not serverless hosts like Vercel. You need **Docker Engine** (or Docker Desktop for local smoke tests) on the host; everything else runs inside containers.

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
./scripts/init-host-dirs.sh
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

Migration and serving are two separate compose services, both running
`deploy/docker-entrypoint.sh` (same image, different `command:`). **`app` only starts once
`migrate` exits 0** (`depends_on: condition: service_completed_successfully`), so the web server
never runs migration logic itself. **Every service runs as the unprivileged `node` user** (UID 1000
in the official Node image).

**Before the first `docker compose up`**, prepare host bind mounts. Compose creates missing paths as
**root-owned**, which breaks emergency CLI export and branding uploads until ownership is fixed:

```bash
cd deploy
./scripts/init-host-dirs.sh
# or manually: mkdir -p emergency-exports uploads && chown 1000:1000 emergency-exports uploads && chmod 700 emergency-exports
```

**`migrate`** runs **fail-fast** (any step fails → exits nonzero, `app` never starts):

1. `prisma migrate status` — detect pending migrations (text parse; connection errors abort with a clear log)
2. `prisma migrate deploy` — idempotent schema migrations (automatic; operators never run this by hand)
3. Idempotent backfills (safe to re-run; throw if DB/schema incompatible)

**`app`** execs `node apps/web/dist/src/index.js` only. No migration logic, no retention on boot, and
no filesystem access to backup dumps. Product retention (auth sessions, mail snapshots, security audit
log), bounce ingest, mail drain, and import/export jobs run on the **`worker`** service (same image,
`command: ["worker"]` → `admitto worker`). Keep exactly one worker replica; the process uses session
advisory locks so a mistaken second replica skips overlapping jobs rather than double-running them.

**Operator upgrade:** take a **manual database backup first** (see [PostgreSQL backups](#postgresql-backups-adr-0012-adr-0027)), then pull the new image and `docker compose up -d`. Migrations apply automatically; there is **no** automatic pre-migration dump anymore.

Schema change policy (expand-contract, CI guard): [packages/db/README.md](../packages/db/README.md#schema-change-policy).

For one-off CLI (bootstrap, MFA reset, emergency export), the entrypoint passes through `node …` after
checking that `EMERGENCY_EXPORT_DIR` is writable — see below. `npm`/`npx` are not available in the production image.

## Container logs (what to expect where)

Per-container stdout, by design (SECURITY-CONTROLS: logs are operational — no PII, secrets, or tokens; no built-in SIEM):

| Container | What its logs show |
|-----------|--------------------|
| `migrate` | Entrypoint boot steps (migration status, backfills) — a one-shot container, exits after logging `migrate: startup tasks complete` |
| `app` | `Admitto web running at …`, then: JSON access log (one line per request — method, redacted path, status, `duration_ms`) when `LOG_HTTP_REQUESTS=1` (compose default), plus sparse JSON events (import, upload, `/readyz` auth failure, SPA client errors) |
| `worker` | `[worker] …` lines for heartbeat, mail drain, import/export jobs, bounce ingest, and retention (boot + ~24h) |
| `proxy` | Nginx access/error log (image default) — includes client IPs; rotate/limit via Docker logging options if kept long-term |
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
remains — see the OIDC offboarding runbook in [SECURITY-CONTROLS.md](../docs/security/SECURITY-CONTROLS.md).

## Emergency CLI (event-day failover)

When the admin SPA or scanner is down, use the unified emergency binary (same production `app` image — `npm`/`npx` are not available):

```bash
docker compose run --rm app node apps/cli/dist/index.js --help

# Manual lookup + admit (staging drill before the event)
docker compose run --rm app node apps/cli/dist/index.js checkin lookup --event <eventId> --query "jan kowal"
docker compose run --rm app node apps/cli/dist/index.js checkin admit --event <eventId> --attendee-id <attendeeId>

# Paper backup list (CSV) — use EMERGENCY_EXPORT_DIR (node-writable bind mount), NOT /app/uploads or /backups
# Run ./scripts/init-host-dirs.sh on the host first if a fresh deploy created root-owned emergency-exports/
# (/uploads/* is served without auth; /backups is only on the db-backup sidecar volume)
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

Legacy per-package CLIs (`packages/auth/dist/cli.js`, `packages/mail-delivery/dist/cli.js`) remain for bootstrap and low-level retention; product-automated retention runs on the Admitto **worker**. `admitto retention run` combines auth + mail snapshot + security audit log cleanup in one audited command for manual/on-demand use.

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

Do **not** use `$proxy_add_x_forwarded_for` on the NPM vhost that faces the public internet. With `TRUST_PROXY=true`, Admitto reads the **first** `X-Forwarded-For` hop ([`client-ip.ts`](../apps/web/src/rate-limit/client-ip.ts)); an appended chain would let clients pick the rate-limit bucket and pollute audit logs. The first hop must be a **valid IP**; otherwise the app falls back to the TCP remote address (see [SECURITY-CONTROLS.md](../docs/security/SECURITY-CONTROLS.md)).

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

## Admitto worker (mail, import/export, bounce, retention)

Compose runs a dedicated **`worker`** service (same image as `app`, `command: ["worker"]`).
It records a `BackgroundWorkerHeartbeat` (Settings → Health → Background worker), drains the
mail queue, runs async import/export `AdminJob`s, polls enabled bounce mailboxes, and runs
product retention on boot plus about every 24 hours.

```bash
docker compose logs -f worker
```

Local development (without compose worker): `npm run worker` from the repo root.

Manual one-off retention (audited CLI; not required when the worker is healthy):

```bash
docker compose exec app node apps/cli/dist/index.js retention run --operator-email super@example.com
```

Or the per-package CLIs:

```bash
docker compose exec app node packages/auth/dist/cli.js purge-auth-retention
docker compose exec app node packages/mail-delivery/dist/cli.js nullify-delivery-snapshots
docker compose exec app node packages/auth/dist/cli.js purge-security-audit-log
```

`purge-security-audit-log` defaults to a 30-day window; override with
`SECURITY_AUDIT_LOG_RETENTION_DAYS` (see `.env.example`).

Failed worker job ticks log `FAILED` but do not stop the loop — check `docker compose logs worker`
after deploy. Without a running worker, bulk mail stays queued and bounce/retention do not run.

## PostgreSQL backups (ADR 0012, ADR 0027)

**Before every upgrade (required):** the stack no longer dumps the database before `migrate deploy`.
Take your own restore point immediately before pulling a new image:

```bash
cd deploy
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip > "../backup-pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

Copy upgrade backups offsite when possible (ADR 0023). Practice restore on a non-production database
before the first large event.

**Automatic (nightly):** the `db-backup` sidecar writes `nightly-<UTC>.sql.gz` to the
`migration_backups` volume (14-day retention via `find -mtime`). Verify after first deploy:

```bash
docker compose logs db-backup
docker compose exec db-backup sh -c 'ls -la /backups/nightly-*.sql.gz'
docker compose exec db-backup sh -c 'gzip -t /backups/nightly-*.sql.gz'
```

**Bounce ingest:** runs inside the **`worker`** (not a separate sidecar). The worker wakes on a
short tick; per-event **Check every** (`poll_interval_minutes`) decides when each enabled event is
due. Soft Settings → Health treats a successful run as stale after the larger of 2× Check every and
2× the worker tick (floored at 15 minutes). Each run writes `last_run_*` for the Event settings
card and that Health row. When `OPS_HEALTH_TOKEN` is set, compose also points
`BOUNCE_INGEST_APP_URL=http://app:3000` (or `ADMITTO_INTERNAL_URL`) so each run can append
`mail_bounce_ingest_*` lines to Settings → Logs (mail). `/readyz` exposes soft `bounce_ingest_*`
gauges (never alone a 503). Worker liveness for operators is the Settings → Health **Background
worker** row (DB heartbeat), not a bounce-only container HEALTHCHECK.

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

Stop the app and worker, **empty the target database**, restore from your **pre-upgrade backup** or a
**nightly dump** on the `migration_backups` volume, then redeploy the previous image.

Entrypoint backups are plain `pg_dump` SQL (`--no-owner`, no `--clean`). Replaying into a database
that already ran the bad migration will hit existing tables/types and can leave a **partial** schema
— not a true rollback. You must drop and recreate the application database first.

```bash
docker compose stop app worker

# List nightly dumps on the migration_backups volume (or use your host backup-pre-upgrade-*.sql.gz)
docker compose exec db-backup sh -c 'ls -lt /backups/nightly-*.sql.gz'

# Empty target DB (credentials from the db container env — same pattern as manual backups above)
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '\''$POSTGRES_DB'\'' AND pid <> pg_backend_pid()" \
  -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\"" \
  -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\""'

# Replay a nightly dump (replace timestamp; or pipe backup-pre-upgrade-*.sql.gz from the host instead)
docker compose exec -T db-backup sh -c 'gunzip -c /backups/nightly-<UTC>.sql.gz' \
  | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'

# in deploy/.env: set ADMITTO_IMAGE to the previous tag, e.g. ghcr.io/solarssk/admitto:0.4.1
docker compose pull app && docker compose up -d app worker
```

Without a pre-upgrade or nightly dump you cannot roll the database back — Case A (image-only rollback)
still works when the schema change was additive and the old app tolerates the new schema.
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
