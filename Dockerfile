FROM node:24-bookworm-slim AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

ENV npm_config_ignore_scripts=true
RUN npm ci

# Bake the offline IP->country dataset into the image at build time (apps/web/src/rate-limit/
# ip-location.ts never fetches it at request time). ILA_IP_LOCATION_DB=user selects the
# PDDL/CDLA-Permissive-licensed ip-location-db "user" dataset instead of ip-location-api's default
# MaxMind GeoLite2 mode, which needs a MaxMind account/license key — unnecessary friction repeated
# across every self-hosted deployment. These ENV vars are re-declared in the production stage
# below so the running container reads the same, already-baked data instead of re-fetching it.
ENV ILA_IP_LOCATION_DB=user
ENV ILA_DATA_DIR=/app/data/geoip
ENV ILA_AUTO_UPDATE=false
RUN node apps/web/scripts/prefetch-geo-db.mjs

RUN npx prisma generate --schema packages/db/prisma/schema.prisma --config packages/db/prisma.config.ts

# No .git dir is copied into the build context — publish-container.yml passes the real commit
# it just checked out; the admin SPA build (apps/admin/vite.config.ts) reads it from here.
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
RUN npm run build

# Prisma v7's config loader (prisma.config.ts -> @prisma/config -> c12/jiti/etc.) pulls in several
# new transitive packages beyond the old prisma/@prisma/.prisma trio, and docker-entrypoint.sh
# still needs the CLI (a devDependency) at container startup to run migrate status/deploy. Snapshot
# node_modules before pruning devDependencies, then merge back only what pruning removed (`cp -n`
# skips anything that already exists, so real prod dependencies are untouched) instead of
# hardcoding an increasingly long and version-fragile package list.
RUN cp -r node_modules /opt/node_modules-full

RUN npm prune --omit=dev

RUN cp -rn /opt/node_modules-full/. node_modules/ && rm -rf /opt/node_modules-full

FROM node:24-bookworm-slim AS production

# postgresql-client-16 for pre-migration pg_dump (ADR 0027; server is postgres:16).
# Global npm is unused at runtime (Prisma/app invoked via node directly).
# Removes bundled picomatch 4.0.3 flagged by Trivy (CVE-2026-33671).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg openssl wget \
  && curl -fsSL --proto '=https' --proto-redir '=https' https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && apt-get purge -y curl gnupg \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/crypto/package.json packages/crypto/
COPY packages/location/package.json packages/location/
COPY packages/db/package.json packages/db/
COPY packages/tickets/package.json packages/tickets/
COPY packages/auth/package.json packages/auth/
COPY packages/mailer/package.json packages/mailer/
COPY packages/mailer-config/package.json packages/mailer-config/
COPY packages/mail-templates/package.json packages/mail-templates/
COPY packages/mail-delivery/package.json packages/mail-delivery/
COPY packages/import/package.json packages/import/
COPY packages/ui/package.json packages/ui/
COPY apps/admin/package.json apps/admin/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/

COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/apps/admin/dist ./apps/admin/dist
COPY --from=builder /app/apps/cli/dist ./apps/cli/dist
COPY --from=builder /app/packages/ui/dist ./packages/ui/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/crypto/dist ./packages/crypto/dist
COPY --from=builder /app/packages/location/dist ./packages/location/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/packages/db/prisma.config.ts ./packages/db/prisma.config.ts
COPY --from=builder /app/packages/tickets/dist ./packages/tickets/dist
COPY --from=builder /app/packages/auth/dist ./packages/auth/dist
COPY --from=builder /app/packages/mailer/dist ./packages/mailer/dist
COPY --from=builder /app/packages/mailer-config/dist ./packages/mailer-config/dist
COPY --from=builder /app/packages/mail-templates/dist ./packages/mail-templates/dist
COPY --from=builder /app/packages/mail-delivery/dist ./packages/mail-delivery/dist
COPY --from=builder /app/packages/import/dist ./packages/import/dist
COPY --from=builder /app/data/geoip ./data/geoip

COPY deploy/docker-entrypoint.sh ./deploy/docker-entrypoint.sh

RUN chmod +x ./deploy/docker-entrypoint.sh \
  && chown -R node:node /app

# Non-root by default. The one compose service that genuinely needs root — writing pre-migration
# backups into the root-only migration_backups volume — overrides this with `user: root` (see
# deploy/docker-compose.yml's `migrate` service); the long-running web server never runs as root.
USER node

ENV NODE_ENV=production
# Read-only offline dataset baked in above (builder stage) — never re-fetched at runtime.
ENV ILA_IP_LOCATION_DB=user
ENV ILA_DATA_DIR=/app/data/geoip
ENV ILA_AUTO_UPDATE=false
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["/app/deploy/docker-entrypoint.sh"]
