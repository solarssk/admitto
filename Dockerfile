FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

ENV npm_config_ignore_scripts=true
RUN npm ci

# Bake the offline IP->city dataset into the image at build time (apps/web/src/rate-limit/
# ip-location.ts never fetches it at request time). ILA_LICENSE_KEY=redist (ip-location-api's own
# default when unset — set explicitly here so the choice is visible, not implicit) downloads
# MaxMind's GeoLite2 database from the node-geolite2-redist community mirror, needing no MaxMind
# account/license key of our own. ILA_FIELDS=country,city is what actually selects the City
# edition of the database over the lighter Country-only one — country alone (this project's
# previous default) resolves to the ~7MB Country edition regardless of ILA_LICENSE_KEY. These ENV
# vars are re-declared in the production stage below so the running container reads the same,
# already-baked data instead of re-fetching it.
ENV ILA_LICENSE_KEY=redist
ENV ILA_FIELDS=country,city
ENV ILA_DATA_DIR=/app/data/geoip
ENV ILA_AUTO_UPDATE=false
# The dataset is downloaded from a public GitHub Release. Retry brief upstream
# outages during the image build, but still fail after the final attempt.
RUN for attempt in 1 2 3; do \
      if node apps/web/scripts/prefetch-geo-db.mjs; then exit 0; fi; \
      if [ "$attempt" -lt 3 ]; then \
        echo "GeoIP prefetch attempt $attempt failed; retrying..."; \
        sleep "$attempt"; \
      fi; \
    done; \
    exit 1

RUN npx prisma generate --schema packages/db/prisma/schema.prisma --config packages/db/prisma.config.ts

# No .git dir is copied into the build context — publish-container.yml passes the real commit
# it just checked out; the admin SPA build (apps/admin/vite.config.ts) reads it from here.
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
RUN npm run build

# docker-entrypoint.sh needs the Prisma CLI at container startup to run migrate status/deploy, so
# packages/db/package.json declares "prisma" as a runtime dependency (not devDependency); npm
# prune keeps it and its resolved transitive tree (prisma.config.ts -> @prisma/config ->
# c12/jiti/etc.) automatically, same as any other production dependency.
RUN npm prune --omit=dev

FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS production

# Global npm is unused at runtime (Prisma/app invoked via node directly).
# Removes bundled picomatch 4.0.3 flagged by Trivy (CVE-2026-33671).
# fontconfig + fonts-dejavu-core: debian-slim ships no fonts at all, so sharp's SVG compositor
# (apps/web/src/maps/static-map.ts, font-family "DejaVu Sans, Arial, Helvetica, sans-serif") has
# nothing to resolve glyphs against and draws the static-map attribution/placeholder text as tofu.
# `apt-get upgrade` pulls in Debian's own bookworm-security point-fixes for whatever the base
# image already shipped (e.g. libpcre2-8-0, CVE-2026-86145) - the base image tag itself only gets
# rebuilt on its own schedule, so without this an already-fixed-upstream package can still ship
# stale in our image between those rebuilds. GIT_COMMIT (already passed as a build-arg on every
# release build, publish-container.yml) is referenced in the RUN command below purely to bust
# BuildKit's own GHA layer cache (cache-from/cache-to: type=gha) on every release - a RUN
# instruction's cache key only changes when an ARG it actually references changes, so without
# this the whole line would replay verbatim from a prior release's cache whenever the Dockerfile
# and base image digest are unchanged, silently skipping both apt-get update and upgrade on every
# release after the first (bot review; see Docker's own docs on RUN cache invalidation).
ARG GIT_COMMIT=unknown
RUN echo "cache-bust for commit ${GIT_COMMIT}" \
  && apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends ca-certificates fontconfig fonts-dejavu-core openssl wget \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app

COPY LICENSE NOTICE THIRD-PARTY-NOTICES.md ./
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/crypto/package.json packages/crypto/
COPY packages/storage/package.json packages/storage/
COPY packages/location/package.json packages/location/
COPY packages/db/package.json packages/db/
COPY packages/tickets/package.json packages/tickets/
COPY packages/wallet/package.json packages/wallet/
COPY packages/auth/package.json packages/auth/
COPY packages/mailer/package.json packages/mailer/
COPY packages/mailer-config/package.json packages/mailer-config/
COPY packages/mail-templates/package.json packages/mail-templates/
COPY packages/mail-delivery/package.json packages/mail-delivery/
COPY packages/notifications/package.json packages/notifications/
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
COPY --from=builder /app/packages/storage/dist ./packages/storage/dist
COPY --from=builder /app/packages/location/dist ./packages/location/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/packages/db/prisma.config.ts ./packages/db/prisma.config.ts
COPY --from=builder /app/packages/tickets/dist ./packages/tickets/dist
COPY --from=builder /app/packages/wallet/dist ./packages/wallet/dist
COPY --from=builder /app/packages/auth/dist ./packages/auth/dist
COPY --from=builder /app/packages/mailer/dist ./packages/mailer/dist
COPY --from=builder /app/packages/mailer-config/dist ./packages/mailer-config/dist
COPY --from=builder /app/packages/mail-templates/dist ./packages/mail-templates/dist
COPY --from=builder /app/packages/mail-delivery/dist ./packages/mail-delivery/dist
COPY --from=builder /app/packages/notifications/dist ./packages/notifications/dist
COPY --from=builder /app/packages/import/dist ./packages/import/dist
COPY --from=builder /app/data/geoip ./data/geoip

COPY deploy/docker-entrypoint.sh ./deploy/docker-entrypoint.sh

RUN chmod +x ./deploy/docker-entrypoint.sh \
  && chown -R node:node /app

# Non-root always — no compose service (app, migrate, or worker) runs as root (ADR 0043).
USER node

ENV NODE_ENV=production
# Read-only offline dataset baked in above (builder stage) — never re-fetched at runtime. Must
# match the builder stage's ILA_FIELDS/ILA_LICENSE_KEY exactly, or ip-location-api's own
# fieldDir-hashing (src/setting.mjs) resolves a different data directory than the one actually
# baked in and finds nothing there.
ENV ILA_LICENSE_KEY=redist
ENV ILA_FIELDS=country,city
ENV ILA_DATA_DIR=/app/data/geoip
ENV ILA_AUTO_UPDATE=false
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["/app/deploy/docker-entrypoint.sh"]
