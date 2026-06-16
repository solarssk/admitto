#!/bin/sh
set -eu

# docker compose run --rm app node packages/auth/dist/cli.js bootstrap-superadmin
if [ "${1:-}" = "node" ] || [ "${1:-}" = "npm" ]; then
  exec "$@"
fi

SCHEMA="packages/db/prisma/schema.prisma"

node node_modules/prisma/build/index.js migrate deploy --schema "$SCHEMA"
node packages/db/dist/scripts/backfill-public-ref.js

exec node apps/web/dist/src/index.js
