#!/bin/sh
# One-time host prep for deploy bind mounts. Compose creates missing paths as root-owned;
# the app image runs as UID 1000 (node) and cannot chown them at runtime.
set -eu

cd "$(dirname "$0")/.."

mkdir -p emergency-exports uploads

if [ "$(id -u)" -eq 0 ]; then
  chown 1000:1000 emergency-exports uploads
else
  echo "init-host-dirs: warning: not root — run 'sudo chown 1000:1000 emergency-exports uploads' if exports/uploads fail with EACCES" >&2
fi

chmod 700 emergency-exports
chmod 755 uploads

echo "init-host-dirs: emergency-exports/ and uploads/ are ready for compose bind mounts"
