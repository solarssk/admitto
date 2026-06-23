#!/usr/bin/env sh
# Pre-flight deploy/.env checks — see validate-env.mjs
set -eu
cd "$(dirname "$0")"
exec node validate-env.mjs "${1:-.env}"
