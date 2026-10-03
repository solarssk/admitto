#!/usr/bin/env bash
# Fallback reviewer for .github/workflows/ai-review.yml: runs the Codex CLI on the same prompt and
# the same output schema as the Claude reviewer, on the maintainer's ChatGPT subscription login.
# It only reviews. It publishes nothing; the workflow's single Submit step does that.
#
# Contract: this script exits 0 whenever Codex itself is unavailable (not configured, login
# rejected, usage limit, timeout, no usable output) and says so in the step outputs `ok=false` and
# `reason=<fixed word>`. A non-zero exit means a bug in our own script and must stay red, so a
# broken CI step is never mistaken for an unavailable provider.
#
# Environment: CODEX_AUTH_JSON (the contents of ~/.codex/auth.json after `codex login`),
# CODEX_BIN (the pinned codex executable), RUNNER_TEMP, GITHUB_OUTPUT. The credential is read from
# the environment and written to a 0600 file in a temp CODEX_HOME; it is never a command-line
# argument and is removed on exit.
set -euo pipefail
umask 077

: "${GITHUB_OUTPUT:?}" "${RUNNER_TEMP:?}" "${CODEX_BIN:?}"
PROMPT=.github/ai-review/prompt-live.md
SCHEMA_SRC=.github/ai-review/schema-live.json
TIMEOUT_SECONDS=${CODEX_TIMEOUT_SECONDS:-600}

CODEX_HOME="$RUNNER_TEMP/codex-home"
export CODEX_HOME
WORK="$RUNNER_TEMP/codex-review"
cleanup() { rm -rf "$CODEX_HOME" "$WORK"; }
trap cleanup EXIT
mkdir -p "$CODEX_HOME" "$WORK"

unavailable() { # $1 reason word (fixed set), $2 message for the log
  echo "Codex unavailable: $2"
  { echo "ok=false"; echo "reason=$1"; } >> "$GITHUB_OUTPUT"
  exit 0
}

if [ -z "${CODEX_AUTH_JSON:-}" ]; then
  unavailable not_configured "the CODEX_AUTH_JSON secret is not set"
fi
# Subscription login only: refuse an API-key login, so this fallback can never start billing the
# OpenAI API by accident.
if ! jq -e '((.tokens.refresh_token // "") != "") and ((.OPENAI_API_KEY // "") == "")' <<< "$CODEX_AUTH_JSON" > /dev/null 2>&1; then
  unavailable bad_credential "CODEX_AUTH_JSON is not a ChatGPT login (expected tokens.refresh_token and no OPENAI_API_KEY)"
fi

# Mask every token separately before anything else can print it: GitHub masks the secret as a
# whole, and the tokens inside it are not guaranteed to be masked on their own.
jq -r '[.tokens | .. | strings | select(length >= 16)] | unique | .[]' <<< "$CODEX_AUTH_JSON" > "$WORK/tokens.txt"
while IFS= read -r TOKEN; do echo "::add-mask::${TOKEN}"; done < "$WORK/tokens.txt"

printf '%s' "$CODEX_AUTH_JSON" > "$CODEX_HOME/auth.json"
chmod 600 "$CODEX_HOME/auth.json"
cp "$CODEX_HOME/auth.json" "$WORK/auth.before"
# The model's shell must not inherit the credential.
unset CODEX_AUTH_JSON

# Codex wants a strict schema (additionalProperties: false on every object). Derived from the one
# schema file the Claude reviewer uses, so both providers answer in the same shape.
jq 'walk(if type == "object" and has("properties") then .additionalProperties = false else . end)' \
  "$SCHEMA_SRC" > "$WORK/schema.json"

set +e
# Read-only sandbox, no web search, no session files, no user config. The prompt goes in on stdin.
timeout "$TIMEOUT_SECONDS" "$CODEX_BIN" exec \
  --ignore-user-config --ephemeral --skip-git-repo-check --color never \
  --sandbox read-only \
  -c 'cli_auth_credentials_store="file"' -c 'web_search="disabled"' \
  --output-schema "$WORK/schema.json" --output-last-message "$WORK/result.json" \
  - < "$PROMPT" > "$WORK/codex.log" 2>&1
RC=$?
set -e

# Codex rewrites auth.json when it refreshes its tokens. The refreshed copy dies with this runner,
# so the stored secret is then stale and the next run may be rejected.
if ! cmp -s "$WORK/auth.before" "$CODEX_HOME/auth.json"; then
  echo "::warning::Codex refreshed its login during this run. The stored CODEX_AUTH_JSON may stop working; renew it (see docs/dev/ai-review.md)."
fi

if [ "$RC" -ne 0 ]; then
  # Only a fixed category reaches the outputs; a short, token-masked tail of the log helps debugging.
  if grep -qiE 'refresh token|log ?in again|sign ?in|not logged in|unauthori[sz]ed|\b401\b|token.*(expired|revoked|invalid)' "$WORK/codex.log"; then
    REASON=credential_rejected
  elif grep -qiE 'usage limit|rate limit|quota|\b429\b' "$WORK/codex.log"; then
    REASON=usage_limit
  elif [ "$RC" -eq 124 ]; then
    REASON=timeout
  elif grep -qiE 'bwrap|bubblewrap|landlock|seccomp|namespace' "$WORK/codex.log"; then
    REASON=sandbox_failed
  else
    REASON=error
  fi
  echo "--- end of the Codex log (masked, truncated) ---"
  tail -n 8 "$WORK/codex.log" | cut -c1-240
  unavailable "$REASON" "codex exec exited with ${RC} (${REASON})"
fi

if [ ! -s "$WORK/result.json" ] || ! jq -e '(.verdict == "approve" or .verdict == "comment") and (.summary | type == "string") and (.blocking_findings | type == "array")' "$WORK/result.json" > /dev/null 2>&1; then
  unavailable invalid_output "Codex finished without a usable review"
fi
# The review text is published. Never let it carry the login, whatever a prompt-injected diff asked.
if grep -qF -f "$WORK/tokens.txt" "$WORK/result.json"; then
  unavailable output_leak "the review text contained credential material and was dropped"
fi

{ echo "ok=true"; echo "structured=$(jq -c . "$WORK/result.json")"; } >> "$GITHUB_OUTPUT"
echo "Codex review produced."
