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
| `CODEX_AUTH_JSON` | No (without it there is no fallback) | Fallback reviewer, on your ChatGPT subscription; the seed login |
| `CODEX_CACHE_KEY` | Recommended with `CODEX_AUTH_JSON` | Encrypts the refreshed Codex login that is kept between runs (see Renewal) |
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

### Keeping the login alive

A ChatGPT refresh token is **single use**, and Codex swaps it for a new one when it refreshes (after
8 days, or when the token is rejected). A runner is thrown away, so a plain secret would stop
working after the first refresh. To avoid that:

```bash
openssl rand -hex 32 | gh secret set CODEX_CACHE_KEY --repo solarssk/admitto
```

- After every Codex run, if the login changed, it is encrypted (AES-256, key `CODEX_CACHE_KEY`) and
  saved to the Actions cache; the next run restores it and uses the newer of the cached login and
  `CODEX_AUTH_JSON`. A freshly pasted secret therefore always wins over an older cache entry, and
  an entry that cannot be decrypted is ignored. The cache is encrypted because caches of the default
  branch are readable by other workflows.
- The `AI review Codex keep-alive` workflow runs every 4 days and makes one trivial Codex request.
  Without it the fallback, which only runs when Claude is down, would never refresh the login, and
  the cache entry would be evicted after 7 days unused. It uses a tiny part of your subscription.
- A red keep-alive run (`Codex login is not usable`) is the signal to renew.

Without `CODEX_CACHE_KEY` the fallback still works until the first refresh, after which the secret
may go stale (the run warns about it).

### Renewal

Repeat the login commands above and replace `CODEX_AUTH_JSON`. This is needed when the keep-alive
run is red, or the run summary says `Codex unavailable: credential_rejected`. Known limit: if two
runs refresh at the same moment (the keep-alive and a fallback review), one of them can burn the
token the other saved; that needs a renewal and is rare, because refreshes happen about once every
8 days.

## Security notes

- The workflow is `pull_request_target`, limited to same-repository PRs by the repository owner;
  forks and Dependabot never reach the secrets.
- Nothing from the PR is checked out or run. Codex runs in the base-branch checkout with no GitHub
  token, web search off, no session files and no user config.
- A plain read-only Codex sandbox can still read every file, including its own login. So the sandbox
  uses a profile that is read-only and hides the login, the token list and the cache directory, and
  before any model runs the script proves it on the real runner: the sandbox starts, reads the
  repository, cannot write and cannot read the login. Otherwise nothing runs (`sandbox_failed`).
  The sandbox also has its own process namespace, so the model cannot read the script's environment.
- The credential is written to a `0600` file in a temp directory, never passed as an argument,
  removed when the script exits, and each token in it is masked in the log individually.
- The model could be prompt-injected by the diff. Before anything is published, the review text is
  checked for the stored tokens (a hit drops the Codex review, `output_leak`) and for token-shaped
  strings (the Submit step refuses to post them).
- Codex is installed from `.github/ai-review/codex/package-lock.json` (exact version, integrity
  hashes, no lifecycle scripts) and updated by Dependabot like any other dependency.
