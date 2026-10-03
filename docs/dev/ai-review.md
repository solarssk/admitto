# AI review: providers, secrets and renewal

Maintainer notes for the automated pull request review (`.github/workflows/ai-review.yml`). The
review itself (who is reviewed, budgets, what it may do) is described in the workflow header and in
[SECURITY.md](../../SECURITY.md); this page covers the reviewer providers and their credentials.

## Provider order

```text
PR -> prompt + diff (same files for both providers)
        |
        v
  Claude Code (CLAUDE_CODE_OAUTH_TOKEN, your Claude subscription)  -- review produced --> publish
        |
        | only if no review could be produced for a provider reason
        v
  Codex CLI (CODEX_AUTH_JSON, your ChatGPT subscription)           -- review produced --> publish
        |
        v
  no review: a comment says so, nothing is approved, the job is red
```

One review is published, by one step, whichever provider wrote it. A review written by Codex says
so in its first line. The job log (and the run summary) names the provider every time:
`AI reviewer provider: Claude`, or `Claude unavailable: <reason>` followed by
`AI reviewer provider: Codex (fallback)`.

## When the fallback runs

Codex runs only when the Claude run **failed** and its execution file shows a provider problem
(`.github/ai-review/classify-claude-failure.jq`, covered by tests):

| Claude result | Falls back to Codex? |
|---|---|
| Review produced (approve, or findings of any kind) | No, never |
| `CLAUDE_CODE_OAUTH_TOKEN` not set | Yes (`not_configured`) |
| Login rejected or expired, account on hold (`authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `verification_required`, `cloud_credential_error`) | Yes |
| Usage limit or billing problem (`rate_limit`, `billing_error`) | Yes |
| Service overloaded or erroring (`overloaded`, `server_error`) | Yes |
| Bad request, unknown model, out of turns, no structured output, no execution file, anything else | **No.** The job stays red with the Claude error visible; this is our configuration, not an outage |
| A failure in our own steps (diff, budget, prompt, a script) | **No.** Those steps fail the job on their own |

If Codex is also unavailable (`not_configured`, `bad_credential`, `credential_rejected`,
`usage_limit`, `timeout`, `sandbox_failed`, `invalid_output`, `output_leak`, `error`), the review
posts a comment naming both reasons, approves nothing, dismisses this bot's earlier approval of the
commit and fails the job. That is the existing policy for a review that could not run; branch
protection keeps the PR unmergeable until you re-run the job or review by hand.

## Secrets

| Secret | Required | Purpose |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Yes | Primary reviewer, on your Claude subscription |
| `CODEX_AUTH_JSON` | No (without it there is no fallback) | Fallback reviewer, on your ChatGPT subscription |
| `ANTHROPIC_API_KEY` | No | Only the manual backtest and PR-Agent workflows use it; the live review does not |

There is deliberately **no** `OPENAI_API_KEY`. The live review never calls a paid API: the Codex
step refuses a credential that holds an API key (`bad_credential`), so a mistake cannot start
billing. If you later want a paid emergency fallback, that is a separate, explicit change.

## Claude token

```bash
claude setup-token        # prints a long-lived token; copy it once
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo solarssk/admitto
```

## Codex credential

Codex stores a ChatGPT login in `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`) when
`cli_auth_credentials_store` is `file`. The secret holds that whole file.

```bash
CODEX_HOME="$(mktemp -d)" npx --yes @openai/codex@0.160.0 login   # sign in with ChatGPT, not an API key
gh secret set CODEX_AUTH_JSON --repo solarssk/admitto < "$CODEX_HOME/auth.json"
rm -rf "$CODEX_HOME"
```

A throwaway `CODEX_HOME` keeps this login separate from your own Codex sessions, so using Codex
yourself does not rotate the token the workflow holds. Treat the file like a password: never paste
it into a PR, an issue or a log.

### Renewal

ChatGPT logins expire and their refresh tokens rotate. Codex refreshes the login when it is old and
writes the new one back to `auth.json`, but the runner is discarded, so the secret is not updated
and can go stale. Plan on repeating the commands above when you see `Codex unavailable:
credential_rejected` in the run summary, or the warning `Codex refreshed its login during this
run`. Because Codex only runs as a fallback, a stale credential costs nothing until Claude is down.

## Security notes

- The workflow is `pull_request_target`, limited to same-repository PRs by the repository owner;
  forks and Dependabot never reach the secrets.
- Nothing from the PR is checked out or run. Codex runs in a read-only sandbox, with web search
  off, no session files and no user config, in the base-branch checkout, with no GitHub token.
- The credential is written to a `0600` file in a temp directory, never passed as an argument,
  removed when the script exits, and each token in it is masked in the log individually.
- The model could be prompt-injected by the diff. Before anything is published, the review text is
  checked for the stored tokens (a hit drops the Codex review, `output_leak`) and for token-shaped
  strings (the Submit step refuses to post them).
- Codex is installed from `.github/ai-review/codex/package-lock.json` (exact version, integrity
  hashes, no lifecycle scripts) and updated by Dependabot like any other dependency.
