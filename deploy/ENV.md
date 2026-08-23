# Admitto environment variable reference

> Generated file. Do not edit by hand.
>
> Descriptions and boot/UI metadata: [`env-catalog.json`](./env-catalog.json).
> Keys are cross-checked against `process.env` / compose / `.env.example` by `scripts/generate-env-dictionary.mjs`.
>
> Regenerate: `npm run docs:env` &nbsp;|&nbsp; Drift check: `npm run docs:env -- --check`

This page is the operator-facing dictionary for deploy env vars. Copy values from [`.env.example`](./.env.example). **Boot vs UI:** anything marked UI `none` must be set in the environment before the container is useful; mail, branding, and most identity settings can wait for Organisation settings after `/setup`.

## How to read this table

| Column | Meaning |
|--------|---------|
| Boot | `required` = production is broken without it; `recommended` = set on first deploy; `optional` = defaults exist |
| Consumers | Which roles read it (`app`, `worker`, `migrate`, ...) |
| UI | Whether the same setting can be managed in admin Settings |
| Secret | Treat as a credential; never commit real values |

## Boot (set these first)

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `NODE_ENV` | required | app, worker, migrate | none | no | Use production for real deploys. Changes security defaults (HTTPS BASE_URL, private-mail lab flag ignored, etc.). |
| `BASE_URL` | required | app, worker | none | no | Public origin browsers use (https://tickets.example.com, no trailing slash). Required at boot in non-development; not configurable from Settings. |
| `ENCRYPTION_KEY` | required | app, worker, migrate | none | yes | AES-256-GCM master key (openssl rand -base64 32). Required to decrypt mail/OIDC secrets at rest. Losing it loses encrypted config. |
| `DATABASE_URL` | required | app, worker, migrate | none | yes | Postgres URL. Password must match POSTGRES_PASSWORD when using compose db service. |
| `REDIS_URL` | required | app, worker | none | yes | Redis URL including password. Compose builds this from REDIS_PASSWORD; keep them in sync. |
| `REDIS_PASSWORD` | required | redis, compose | none | yes | Redis requirepass. Generate with openssl rand -hex 32. Must appear in REDIS_URL. |
| `POSTGRES_USER` | required | db, compose | none | no | Postgres role created by the db container. |
| `POSTGRES_PASSWORD` | required | db, compose | none | yes | Postgres password. Must match the password embedded in DATABASE_URL. |
| `POSTGRES_DB` | required | db, compose | none | no | Postgres database name. |
| `PORT` | recommended | app | none | no | HTTP listen port inside the app container (default 3000). Map host ports to this, not to a different internal port. |

## Compose / image

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `ADMITTO_IMAGE` | recommended | compose | none | no | ghcr.io/solarssk/admitto:X.Y.Z image pin (version without leading v). |

## Reverse proxy trust

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `TRUST_PROXY` | recommended | app | none | no | When true, honour X-Forwarded-* from peers allowed by TRUSTED_PROXY_CIDRS (required behind NPM/nginx). |
| `TRUSTED_PROXY_CIDRS` | recommended | app | none | no | CIDR list of TCP peers allowed to set forwarded headers. Variant A: compose internal subnet in .env.example. Variant B (Portainer/NPM direct to app): use NPM's source on /32 only, not broad RFC1918 ranges. |

## Migrations and DB backups

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `MIGRATION_BACKUP_DIR` | recommended | db-backup | none | no | Directory for nightly SQL dumps written by the db-backup sidecar (compose volume mounted at /backups). |
| `NIGHTLY_BACKUP_RETENTION_DAYS` | optional | db-backup | none | no | How many days of nightly-*.sql.gz files the db-backup sidecar keeps (default 14). |
| `NIGHTLY_BACKUP_INTERVAL_SECONDS` | optional | db-backup | none | no | Sleep between nightly dumps (default 86400). |

## Uploads and emergency exports

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `UPLOAD_DIR` | recommended | app, worker | none | no | Branding/upload root (compose: /app/uploads). Must be writable by uid 1000 (node). Health shows down when not writable. |
| `STORAGE_PROVIDER` | optional | app, worker | none | no | local (default). Other providers are not production-ready yet. |
| `EMERGENCY_EXPORT_DIR` | recommended | app, migrate, cli | none | no | Non-public bind mount for break-glass CSV exports. Never put this under UPLOAD_DIR (/uploads is unauthenticated). |

## Mail transport (often UI later)

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `EMAIL_PROVIDER` | optional | app, worker | Organisation settings → Mail (preferred after setup) | no | smtp \| graph \| powerautomate for env-seeded transport. Production UI config is preferred; export_only is lab dry-run only. |
| `MAIL_FROM_ADDRESS` | optional | app, worker | Organisation / Event mail settings | no | Default From address when seeding mail from env. |
| `MAIL_FROM_NAME` | optional | app, worker | Organisation / Event mail settings | no | Default From display name. |
| `MAIL_REPLY_TO` | optional | app, worker | Organisation / Event mail settings | no | Optional Reply-To. |
| `MAIL_ENVELOPE_FROM` | optional | app, worker | Organisation / Event mail settings | no | Optional envelope/MAIL FROM override. |
| `SMTP_HOST` | optional | app, worker | Organisation / Event mail settings | no | SMTP hostname. Production blocks private/link-local targets unless listed in MAIL_PRIVATE_DESTINATION_ALLOWLIST (lab: ALLOW_PRIVATE_MAIL_DESTINATIONS when NODE_ENV is not production). |
| `SMTP_PORT` | optional | app, worker | Organisation / Event mail settings | no | SMTP port (587 STARTTLS or 465 implicit TLS). |
| `SMTP_SECURE` | optional | app, worker | Organisation / Event mail settings | no | true for implicit TLS (typically 465). |
| `SMTP_USER` | optional | app, worker | Organisation / Event mail settings | no | SMTP username. |
| `SMTP_PASSWORD` | optional | app, worker | Organisation / Event mail settings | yes | SMTP password / app password. |
| `SMTP_REQUIRE_TLS` | optional | app, worker | Organisation / Event mail settings | no | Require STARTTLS upgrade on plaintext ports. |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | optional | app, worker | none | no | Reject invalid TLS certificates (keep true in production). |
| `SMTP_HELO_NAME` | optional | app, worker | none | no | Optional SMTP EHLO/HELO name. |
| `SMTP_POOL` | optional | app, worker | none | no | Enable nodemailer connection pooling. |
| `SMTP_MAX_CONNECTIONS` | optional | app, worker | none | no | Max pooled SMTP connections. |
| `SMTP_MAX_MESSAGES_PER_CONNECTION` | optional | app, worker | none | no | Messages per pooled connection before recycle. |
| `SMTP_RATE_LIMIT_PER_MINUTE` | optional | app, worker | none | no | Soft send rate cap for SMTP. |
| `SMTP_CONNECTION_TIMEOUT` | optional | app, worker | none | no | SMTP connect timeout (ms). |
| `SMTP_GREETING_TIMEOUT` | optional | app, worker | none | no | SMTP greeting timeout (ms). |
| `SMTP_SOCKET_TIMEOUT` | optional | app, worker | none | no | SMTP socket timeout (ms). |
| `POWER_AUTOMATE_URL` | optional | app, worker | Organisation / Event mail settings | yes | Power Automate HTTP trigger URL (treat as a credential; may embed a signed token). Same SSRF rules as SMTP host. |
| `POWER_AUTOMATE_KEY` | optional | app, worker | Organisation / Event mail settings | yes | Power Automate shared key / secret header value. |
| `GRAPH_TENANT_ID` | optional | app, worker | Organisation / Event mail settings | no | Microsoft Graph tenant ID. |
| `GRAPH_CLIENT_ID` | optional | app, worker | Organisation / Event mail settings | no | Microsoft Graph app (client) ID. |
| `GRAPH_CLIENT_SECRET` | optional | app, worker | Organisation / Event mail settings | yes | Microsoft Graph client secret. |
| `GRAPH_MAILBOX` | optional | app, worker | Organisation / Event mail settings | no | Mailbox UPN used as Graph send-as identity. |
| `GRAPH_SAVE_TO_SENT` | optional | app, worker | Organisation / Event mail settings | no | Whether Graph keeps messages in Sent Items. |
| `ALLOW_PRIVATE_MAIL_DESTINATIONS` | optional | app, worker | none | no | Lab only. When true and NODE_ENV is not production, allow SMTP/IMAP/PA hosts on private addresses. Ignored in production. |
| `MAIL_PRIVATE_DESTINATION_ALLOWLIST` | optional | app, worker | none | no | Comma-separated exact hostnames/IPs allowed to resolve to private addresses in production (self-hosted LAN MTA). Set on app and worker. |

## wallet

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `PASSCREATOR_BASE_URL` | optional | app | none | no | Optional PassCreator API base URL. Defaults to the provider's production URL; use only for a compatible PassCreator endpoint. |

## Background worker

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `BOUNCE_INGEST_TICK_SECONDS` | optional | worker | Event settings → Mailing (poll interval) | no | Worker wake tick for bounce IMAP (default 60). Per-event poll decides when each mailbox is due. |
| `BOUNCE_INGEST_INTERVAL_SECONDS` | optional | worker | none | no | Legacy alias of BOUNCE_INGEST_TICK_SECONDS. |
| `BOUNCE_INGEST_APP_URL` | recommended | worker | none | no | Internal base URL for worker → app System Logs bridge (compose: http://app:3000). |
| `ADMITTO_INTERNAL_URL` | optional | worker | none | no | Optional alternate internal app URL used by worker integrations (compose sets http://app:3000). |
| `IMPORT_JOB_STALE_RUNNING_MS` | optional | worker | none | no | Fail import AdminJobs stuck in running after this many ms (default 15 minutes). |
| `EXPORT_JOB_STALE_RUNNING_MS` | optional | worker | none | no | Fail export AdminJobs stuck in running after this many ms (default 15 minutes). |
| `WALLET_PUSH_JOB_STALE_RUNNING_MS` | optional | worker | none | no | Fail wallet_push AdminJobs stuck in running after this many ms (default 30 minutes). |
| `WALLET_MESSAGE_JOB_STALE_RUNNING_MS` | optional | worker | none | no | Fail wallet_message AdminJobs stuck in running after this many ms (default 30 minutes). |

## Ops / health / logging

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `ILA_IP_LOCATION_DB` | optional | app | none | no | Offline IP→country dataset id for audit/session geo (default user). No third-party lookup API. |
| `ILA_DATA_DIR` | optional | app | none | no | Directory for the offline geoip dataset cache. |
| `ILA_AUTO_UPDATE` | optional | app | none | no | Keep false so the process does not fetch dataset updates on its own. |
| `OPS_HEALTH_TOKEN` | optional | app, worker | none | yes | Bearer/X-Ops-Token (≥32 chars) for /readyz and worker System Logs bridge. Unset = /readyz disabled. |
| `LOG_HTTP_REQUESTS` | optional | app | none | no | 1 (compose default) writes redacted JSON access lines to app stdout. No IPs, cookies, or QR tokens. |
| `ALLOW_CHECKIN_BEARER` | optional | app | none | no | Emergency: re-enable Bearer check-in auth. Default false; warns outside development. |
| `CHECKIN_OPERATOR_TOKEN` | optional | app | none | yes | Shared operator token when ALLOW_CHECKIN_BEARER=true. |

## Sessions and MFA

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `SESSION_TTL_OPERATOR_MS` | optional | app | none (defaults in auth) | no | Absolute operator session TTL override (ms). |
| `SESSION_TTL_ADMIN_MS` | optional | app | none (defaults in auth) | no | Absolute admin/superadmin session TTL override (ms). Prefer ≤8h when OIDC group mapping grants elevated roles. |
| `SESSION_IDLE_TIMEOUT_ADMIN_MS` | optional | app | none | no | Idle timeout for elevated sessions (ms). Must not exceed admin TTL. |
| `SESSION_IDLE_TIMEOUT_OPERATOR_MS` | optional | app | none | no | Idle timeout for operator sessions (ms). |
| `TRUSTED_DEVICE_DAYS` | optional | app | none | no | MFA trusted-device cookie lifetime in days. |
| `MFA_REQUIRED_ROLES` | optional | app | none | no | Comma-separated roles that must enroll MFA (default admin,superadmin). |
| `WEBAUTHN_ENABLED` | optional | app | none | no | Whether passkey/security-key (WebAuthn) MFA is offered (default true). |
| `CSP_TRUSTED_ORIGINS` | optional | app | Settings → Security (preferred); env locks UI | no | JSON array of https:// origins trusted to run script/send data on the admin/operator SPA and sign-in pages. |

## Identity (env lock / seed)

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `CF_ACCESS_ENABLED` | optional | app | Settings → Identity (preferred); env locks UI | no | When true with other CF_ACCESS_* vars, locks Cloudflare Access config from env. |
| `CF_ACCESS_TEAM_DOMAIN` | optional | app | Settings → Identity | no | Cloudflare Access team domain URL. |
| `CF_ACCESS_AUD` | optional | app | Settings → Identity | no | Cloudflare Access application audience tag; this is not a bearer token or client secret. |
| `CF_ACCESS_SOURCE_PROVIDER_ID` | optional | app | Settings → Identity | no | ID of the direct OIDC provider whose immutable subject is forwarded by Cloudflare Access for safe staff SSO linking. |
| `CF_ACCESS_PROTECTED_PREFIXES` | optional | app | Settings → Identity | no | JSON array of path prefixes protected by Access. |
| `SSO_PRIVATE_DESTINATION_ALLOWLIST` | optional | app | none | no | Comma-separated exact hostnames/IPs allowed to resolve privately for identity SSO (OIDC Issuer/endpoints today; same list for future SAML). One list covers every provider sharing those hosts. Set on app. Providers themselves are configured only in Settings → Identity. |

## Maps and geocoding

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `LOCATION_MAPS_ENABLED` | optional | app | Organisation settings → External services | no | Legacy/env maps enable; prefer UI External services. |
| `MAP_TILE_URL` | optional | app | Organisation settings → External services | no | Raster tile URL template. |
| `MAP_TILE_ATTRIBUTION` | optional | app | Organisation settings → External services | no | Tile attribution HTML/text. |
| `MAP_TILE_MAX_ZOOM` | optional | app | Organisation settings → External services | no | Max zoom for static maps. |
| `GEOCODING_PROVIDER` | optional | app | Organisation settings → External services | no | Geocoding provider id (Nominatim path by default). |
| `GEOCODING_BASE_URL` | optional | app | Organisation settings → External services | no | Geocoding API base URL (must not be private). |
| `GEOCODING_TIMEOUT_MS` | optional | app | none | no | Nominatim/geocoding HTTP timeout (ms). No UI field. |
| `MAPS_CONFIG_CACHE_TTL_MS` | optional | app | none | no | In-process maps config cache TTL. |
| `ADMITTO_DEFAULT_EVENT_TIMEZONE` | optional | app | Event settings | no | Fallback IANA timezone when an event has none. |

## Weather

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `WEATHER_ENABLED` | optional | app | Organisation settings → External services | no | Env seed for weather; prefer UI. |
| `WEATHER_PROVIDER` | optional | app | Organisation settings → External services | no | met_no \| open_meteo (UI preferred). |
| `WEATHER_CACHE_TTL_MS` | optional | app | none | no | Weather response cache TTL. |
| `OPEN_METEO_BASE_URL` | optional | app | Organisation settings → External services | no | Open-Meteo API base (commercial / self-hosted). |
| `OPEN_METEO_API_KEY` | optional | app | Organisation settings → External services | yes | Open-Meteo API key when required. |
| `OPEN_METEO_TIMEOUT_MS` | optional | app | none | no | Open-Meteo HTTP timeout (ms). |

## Retention

| Variable | Boot | Consumers | UI | Secret | Summary |
|----------|------|-----------|----|--------|---------|
| `EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS` | optional | worker | none | no | Days before rendered mail HTML/subject are nullified on terminal deliveries. |
| `SECURITY_AUDIT_LOG_RETENTION_DAYS` | optional | worker | none | no | Days to keep durable security audit rows (default 30). |

## Maintenance

1. Add or change a deploy-facing variable in code, compose, or `.env.example`.
2. Update [`env-catalog.json`](./env-catalog.json) (summary, boot, consumers, ui).
3. Run `npm run docs:env` and commit `ENV.md`.
4. `npm run docs:check` fails if this file is stale or a scanned key is missing from the catalog.

_Last generated from 102 distinct keys seen in scan (tests excluded)._
