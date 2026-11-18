#!/usr/bin/env bash
# Dependency audit gate: fails on any high or critical advisory except the ONE named in
# ACCEPTED_ADVISORY (a GHSA id, set by the caller). AUDIT_REPORT may point at a saved
# `npm audit --json` report (tests); otherwise the live audit runs.
set -uo pipefail

accepted="${ACCEPTED_ADVISORY:-}"
report="${AUDIT_REPORT:-}"
if [[ -z "$report" ]]; then
  report="$(mktemp)"
  npm audit --json > "$report" || true
fi

if ! jq -e 'has("vulnerabilities")' "$report" > /dev/null 2>&1; then
  echo "::error::npm audit returned no report:"
  cat "$report"
  exit 1
fi

# Only advisory objects count; `via` strings are transitive links to another package's advisory.
blocking=$(jq -r --arg accepted "$accepted" '
  [.vulnerabilities[].via[] | select(type == "object" and (.severity == "high" or .severity == "critical"))]
  | unique_by(.url // .title)[]
  | select($accepted == "" or (((.url // "") | endswith("/" + $accepted)) | not))
  | "\(.name): \(.title) (\(.url))"
' "$report")
if [[ -n "$blocking" ]]; then
  echo "::error::npm audit found high or critical advisories:"
  echo "$blocking"
  exit 1
fi

if [[ -n "$accepted" ]] && ! jq -e --arg accepted "$accepted" \
  'any(.vulnerabilities[].via[]; type == "object" and ((.url // "") | endswith("/" + $accepted)))' "$report" > /dev/null; then
  echo "::notice::$accepted is gone from the audit: remove ACCEPTED_ADVISORY from the audit step in ci.yml."
fi
echo "npm audit gate passed."
