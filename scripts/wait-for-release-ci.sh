#!/usr/bin/env bash
set -euo pipefail

# Release and CI both start on a main push. Do not create a tag until the entire CI run
# for this exact commit has succeeded; otherwise tag-triggered publication can race CI.
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_SHA:?}"

attempts="${CI_WAIT_ATTEMPTS:-180}"
interval="${CI_WAIT_INTERVAL:-15}"
for ((attempt = 1; attempt <= attempts; attempt++)); do
  result="$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs?head_sha=${GITHUB_SHA}&event=push&per_page=100" \
    --jq '[.workflow_runs[] | select(.name == "CI" and .event == "push")] | sort_by(.created_at) | last | if . == null or .status != "completed" then "pending" else .conclusion end')"
  case "$result" in
    success)
      echo "CI passed for ${GITHUB_SHA}; release tag may be created."
      exit 0
      ;;
    pending)
      echo "CI for ${GITHUB_SHA} is not complete yet (${attempt}/${attempts})."
      ;;
    *)
      echo "CI for ${GITHUB_SHA} ended with '${result}'; refusing to create a release tag." >&2
      exit 1
      ;;
  esac
  if ((attempt < attempts)); then
    sleep "$interval"
  fi
done

echo "Timed out waiting for CI to pass for ${GITHUB_SHA}; refusing to create a release tag." >&2
exit 1
