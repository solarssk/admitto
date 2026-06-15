#!/bin/sh
set -eu

SCHEMA="packages/db/prisma/schema.prisma"

node node_modules/prisma/build/index.js migrate deploy --schema "$SCHEMA"
node packages/db/dist/scripts/backfill-public-ref.js

exec node apps/web/dist/src/index.js
