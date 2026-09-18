# syntax=docker/dockerfile:1
# The line above pins the BuildKit Dockerfile frontend explicitly - required for the
# `RUN --mount=type=secret` below (the GeoIP dataset stage), which a legacy (non-BuildKit)
# builder can't parse at all.
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
# ip-location.ts never fetches it at request time). ILA_FIELDS=country,city is what selects the
# City edition of the database over the lighter Country-only one — country alone (this project's
# previous default) resolves to the ~7MB Country edition regardless of ILA_LICENSE_KEY. ILA_FIELDS
# is re-declared in the production stage below so the running container reads the same,
# already-baked data instead of re-fetching it (ip-location-api hashes ILA_FIELDS into the data
# directory name — mismatched values between stages would silently look in the wrong place).
ENV ILA_FIELDS=country,city
ENV ILA_DATA_DIR=/app/data/geoip
ENV ILA_AUTO_UPDATE=false
# ILA_LICENSE_KEY: downloads from the node-geolite2-redist community mirror by default
# (ip-location-api's own default when unset - no MaxMind account/license key needed), or directly
# from MaxMind's own servers using a real GeoLite2 license key when one is supplied as a build
# secret (`docker build --secret id=maxmind_license_key,src=<path-to-key-file> ...` - see
# deploy/README.md). A build secret, unlike a build ARG or a baked ENV, is never written to any
# image layer or `docker history` - required for a real credential. This project's own published
# image (publish-container.yml) never passes this secret, so it always uses redist; a self-hoster
# or corporate deployer with their own MaxMind account can supply theirs for a direct, auditable
# license relationship instead. Retries brief upstream outages during the image build, but still
# fails after the final attempt.
RUN --mount=type=secret,id=maxmind_license_key \
    for attempt in 1 2 3; do \
      if ILA_LICENSE_KEY="$(cat /run/secrets/maxmind_license_key 2>/dev/null || echo redist)" node apps/web/scripts/prefetch-geo-db.mjs; then exit 0; fi; \
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
# Read-only offline dataset baked in above (builder stage) — never re-fetched at runtime
# (ILA_AUTO_UPDATE=false below), so ILA_LICENSE_KEY isn't needed here regardless of which source
# the builder stage actually used. ILA_FIELDS must still match the builder stage exactly, since
# ip-location-api's own fieldDir-hashing (src/setting.mjs) resolves a different data directory
# than the one actually baked in and finds nothing there otherwise.
ENV ILA_FIELDS=country,city
ENV ILA_DATA_DIR=/app/data/geoip
ENV ILA_AUTO_UPDATE=false
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["/app/deploy/docker-entrypoint.sh"]
