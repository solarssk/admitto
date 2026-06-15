# Admitto deployment (Docker)

Production-oriented compose: **app + PostgreSQL + Redis + nginx reverse proxy**.

Dev/CI database stack remains in [`../infra/docker-compose.yml`](../infra/docker-compose.yml) — do not use dev creds here.

## Quick start

```bash
cd deploy
cp .env.example .env
# Edit .env: POSTGRES_PASSWORD, ENCRYPTION_KEY (openssl rand -base64 32), BASE_URL, mail provider

docker compose up -d --build
curl -sf http://127.0.0.1:8080/healthz
```

The app listens on port 3000 **inside** the compose network only. Use the proxy on `127.0.0.1:8080`.

## First superadmin

After the stack is healthy:

```bash
docker compose run --rm app node packages/auth/dist/cli.js bootstrap-superadmin
```

Follow the CLI prompts. Run on the server directly (break-glass), not through Cloudflare Access.

## Nginx Proxy Manager (production edge)

NPM is the **TLS termination layer in front of this compose stack**. Forward **only** to:

```text
http://<docker-host>:8080
```

Do **not** forward NPM directly to `app:3000` or host port 3000.

In NPM **Advanced** (or custom snippet), match the compose nginx behaviour:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
```

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
