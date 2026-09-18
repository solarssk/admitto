#!/usr/bin/env bash
# Unit tests for deploy/docker-entrypoint.sh's maybe_refresh_geoip_from_maxmind (the
# MAXMIND_LICENSE_KEY handling, deploy/README.md). Runs the real, unmodified entrypoint script's
# "serve" branch via `sh`, with a fake `node` (scripts/fixtures/fake-node-geoip) standing in for
# both the geoip prefetch script and the final app exec - no Docker, no network, no real DB/Redis
# needed, since this logic has no dependency on any of those.
#
# The fake prefetch deliberately mimics ip-location-api's real "skip download if data files
# already exist" behavior (node_modules/ip-location-api/src/main.mjs's `reload`), which is the
# actual mechanism behind the bug this test guards against: without a fresh staging directory per
# attempt, rotating MAXMIND_LICENSE_KEY would silently keep serving the previous key's dataset
# forever, while the entrypoint's own marker claimed the new key was in effect.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENTRYPOINT="$ROOT/deploy/docker-entrypoint.sh"
FAKEBIN="$ROOT/scripts/fixtures/fake-node-geoip"

chmod +x "$ENTRYPOINT" "$FAKEBIN/node"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

run_serve() {
  local data_dir="$1" key="${2:-}" fail="${3:-0}" call_log="$4"
  PATH="$FAKEBIN:$PATH" \
  MAXMIND_DATA_DIR="$data_dir" \
  MAXMIND_LICENSE_KEY="$key" \
  FAKE_PREFETCH_FAIL="$fail" \
  FAKE_NODE_CALL_LOG="$call_log" \
  sh "$ENTRYPOINT" serve
}

assert_eq() {
  local actual="$1" expected="$2" label="$3"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: $label - expected [$expected], got [$actual]" >&2
    exit 1
  fi
  echo "ok: $label"
}

assert_file_missing() {
  local path="$1" label="$2"
  if [ -e "$path" ]; then
    echo "FAIL: $label - expected $path to not exist" >&2
    exit 1
  fi
  echo "ok: $label"
}

echo "== Scenario A: first download writes fresh data and the key marker =="
data_dir="$tmpdir/a"
calls="$tmpdir/a-calls.log"
: >"$calls"
run_serve "$data_dir" "key-a" 0 "$calls"
assert_eq "$(cat "$data_dir/fake-dataset-key")" "key-a" "scenario A: dataset reflects key-a"
assert_eq "$(cat "$data_dir/.maxmind-key-sha256")" "$(printf '%s' key-a | sha256sum | cut -d' ' -f1)" "scenario A: marker hash matches key-a"
assert_eq "$(grep -c 'prefetch-geo-db.mjs' "$calls")" "1" "scenario A: prefetch called once"
assert_file_missing "$tmpdir/a.staging" "scenario A: staging dir cleaned up"

echo ""
echo "== Scenario B: unchanged key skips re-fetching entirely =="
calls="$tmpdir/b-calls.log"
: >"$calls"
run_serve "$data_dir" "key-a" 0 "$calls"
assert_eq "$(grep -c 'prefetch-geo-db.mjs' "$calls" || true)" "0" "scenario B: prefetch not called again for the same key"
assert_eq "$(cat "$data_dir/fake-dataset-key")" "key-a" "scenario B: dataset still reflects key-a"

echo ""
echo "== Scenario C: key rotation replaces the dataset (regression test for the reuse bug) =="
calls="$tmpdir/c-calls.log"
: >"$calls"
run_serve "$data_dir" "key-b" 0 "$calls"
assert_eq "$(cat "$data_dir/fake-dataset-key")" "key-b" "scenario C: dataset now reflects key-b, not stale key-a"
assert_eq "$(cat "$data_dir/.maxmind-key-sha256")" "$(printf '%s' key-b | sha256sum | cut -d' ' -f1)" "scenario C: marker hash matches key-b"

echo ""
echo "== Scenario D: failed fetch with no prior dataset falls back to the built-in one =="
data_dir="$tmpdir/d"
calls="$tmpdir/d-calls.log"
: >"$calls"
run_serve "$data_dir" "key-bad" 1 "$calls"
assert_file_missing "$data_dir/.maxmind-key-sha256" "scenario D: no marker written on first-ever failure"
assert_file_missing "$tmpdir/d.staging" "scenario D: staging dir cleaned up after failure"

echo ""
echo "== Scenario E: failed rotation preserves the last good dataset untouched =="
data_dir="$tmpdir/e"
calls="$tmpdir/e-calls.log"
: >"$calls"
run_serve "$data_dir" "key-good" 0 "$calls"
run_serve "$data_dir" "key-rotated-but-fails" 1 "$calls"
assert_eq "$(cat "$data_dir/fake-dataset-key")" "key-good" "scenario E: dataset still reflects the last good key"
assert_eq "$(cat "$data_dir/.maxmind-key-sha256")" "$(printf '%s' key-good | sha256sum | cut -d' ' -f1)" "scenario E: marker still matches the last good key, not the failed rotation"

echo ""
echo "== Scenario F: no MAXMIND_LICENSE_KEY set never touches the data dir =="
data_dir="$tmpdir/f"
calls="$tmpdir/f-calls.log"
: >"$calls"
run_serve "$data_dir" "" 0 "$calls"
assert_file_missing "$data_dir" "scenario F: data dir never created when no key is set"
assert_eq "$(grep -c 'prefetch-geo-db.mjs' "$calls" || true)" "0" "scenario F: prefetch never called when no key is set"

echo ""
echo "test-geoip-entrypoint.sh: all passed"
