#!/bin/sh
# One-time host prep for deploy bind mounts. Compose creates missing paths as root-owned;
# the app image runs as UID 1000 (node) and cannot chown them at runtime.
set -eu

cd "$(dirname "$0")/.."

mkdir -p emergency-exports uploads geoip-data

if [ "$(id -u)" -eq 0 ]; then
  chown 1000:1000 emergency-exports uploads geoip-data
else
  echo "init-host-dirs: warning: not root — run 'sudo chown 1000:1000 emergency-exports uploads geoip-data' if exports/uploads/geoip-data fail with EACCES" >&2
fi

chmod 700 emergency-exports
chmod 755 uploads geoip-data

echo "init-host-dirs: emergency-exports/, uploads/, and geoip-data/ are ready for compose bind mounts"
