# Admitto deployment (Docker)

Production-oriented compose: **app + PostgreSQL + Redis + nginx reverse proxy**.

Dev/CI database stack remains in [`../infra/docker-compose.yml`](../infra/docker-compose.yml) — do not use dev creds here.

## Deployment model

Admitto is **self-hosted**: you run it on infrastructure you control (VPS, on-prem server, NAS with Docker, etc.). We do **not** ship a managed cloud service.

The **only supported production path** in this repo is a **Docker Compose stack** — not bare-metal installs (Node/Postgres directly on the host), not Kubernetes/Helm. You need **Docker Engine** (or Docker Desktop for local smoke tests) on the host; everything else runs inside containers.

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
# ADMITTO_IMAGE=ghcr.io/solarssk/admitto:0.3.6

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

**Target runtime:** Linux containers. Official base images (`node:22-bookworm-slim`, `postgres:16`, `redis:7`, `nginx`) are multi-arch, but the **`app` image must match the CPU of the machine that runs it**.

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
# Edit .env: POSTGRES_PASSWORD, ENCRYPTION_KEY (openssl rand -base64 32), BASE_URL
# Set EMAIL_PROVIDER to one of: export_only, powerautomate, smtp, graph
# Populate only the mail section for that provider

docker compose up -d --build
curl -sf http://127.0.0.1:8080/healthz
```

The app listens on port 3000 **inside** the compose network only. Use the proxy on `127.0.0.1:8080`.

## Container startup (entrypoint)

On every `app` start, `deploy/docker-entrypoint.sh` runs **fail-fast** (any step fails → container exits, no web server):

1. `prisma migrate deploy` — idempotent schema migrations
2. `backfill-public-ref.js` — idempotent agency `public_ref` backfill (safe to re-run; throws if DB/schema incompatible)
3. `node apps/web/dist/src/index.js` — HTTP server

This is intentional: a broken migration or backfill must not serve traffic on a half-upgraded database.

For one-off CLI (bootstrap, MFA reset), the entrypoint passes through `node …` / `npm …` without starting the web server — see below.

## First superadmin

After the stack is healthy:

```bash
docker compose run --rm app node packages/auth/dist/cli.js bootstrap-superadmin \
  --email admin@example.com
```

Replace the email with your break-glass superadmin address. The CLI prompts for a password on stdin (not echoed). Run on the server directly, not through Cloudflare Access.

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
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
```

Do **not** use `$proxy_add_x_forwarded_for` on the NPM vhost that faces the public internet. With `TRUST_PROXY=true`, Admitto reads the **first** `X-Forwarded-For` hop ([`client-ip.ts`](../apps/web/src/rate-limit/client-ip.ts)); an appended chain would let clients pick the rate-limit bucket and pollute audit logs.

(`$scheme` is `https` on the public NPM vhost; compose nginx forwards that value so `TRUST_PROXY` CSRF checks see HTTPS.)

For the future admin SSE metrics path, add a custom location matching `*/api/admin/events/*/metrics/stream` with `proxy_buffering off` and a long read timeout.

Set `TRUST_PROXY=true` in `deploy/.env` (already in `.env.example`).

## Cloudflare and WireGuard

See [`../../_ops/design/deployment-cloudflare-access.md`](../../_ops/design/deployment-cloudflare-access.md) for:

- Path classification (what stays bypass vs Access-protected)
- Origin invariant: reachable only via Cloudflare or WireGuard tunnel
- Pre-linking admins before enabling `CF_ACCESS_ENABLED`

Public attendee paths (`/t/*`, `/q/*`) must stay bypassed at Cloudflare.

## PostgreSQL backups (ADR 0012)

Manual `pg_dump` before/after key operations. Examples from the `deploy/` directory:

```bash
# Pre-import
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-pre-import.sql

# Post-import
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-post-import.sql

# Post-send (after mail batch)
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-post-send.sql

# Post-event
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-post-event.sql
```

Test a restore on a non-production database before the first large event.

## TLS notes

- **Cloudflare public:** CF terminates TLS; origin can use HTTP on the internal/docker path (Full strict with origin cert is also supported).
- **WireGuard on-site:** trusted network path; local Admitto login still enforces admin TOTP.
- Compose nginx listens on HTTP `:8080` bound to loopback by default.

## Verify deployment

```bash
curl -sf http://127.0.0.1:8080/healthz    # expect {"status":"ok"}
curl -sf http://127.0.0.1:8080/login -o /dev/null -w '%{http_code}\n'  # expect 200
# Port 3000 must NOT respond on the host:
curl --connect-timeout 2 http://127.0.0.1:3000/healthz && echo unexpected || echo ok
```

## Stop

```bash
docker compose down
# docker compose down -v   # destroys postgres volume
```
