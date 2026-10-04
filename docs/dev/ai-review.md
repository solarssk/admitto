# Automated AI review

The live workflow (`.github/workflows/ai-review.yml`) reviews the repository owner's
same-repository, non-draft PRs with Claude Code on the maintainer's subscription.
It reads the base branch and a text diff; it never checks out or runs PR code.
Both findings and approvals go through one publication step, bound to the reviewed commit.

## Credentials

| Secret | Purpose |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude subscription login, generated with `claude setup-token` |
| `ANTHROPIC_API_KEY` | Separate manual backtest and PR-Agent workflows only |

Run `claude setup-token`, then set `CLAUDE_CODE_OAUTH_TOKEN` in the repository's
Actions secrets. Repeat this when authentication fails. Never paste a token into a PR,
issue, log, cache or artifact. Renewing a token does not reset a subscription usage limit.

## Outcomes and recovery

| Outcome | Publication | Workflow result |
|---|---|---|
| Valid review without blocking findings | Approval | Success |
| Valid review with findings | Comment with findings; no approval | Success |
| Recognized provider authentication, usage or service failure | Comment explaining that no review ran; no approval | Success |
| Empty error result before any model response, with explicit zero cost and no model usage | Comment stating `no_model_response`; no approval | Success |
| Missing or unreadable execution file, malformed verdict, turn limit, unknown failure | No approval | Failure |

An empty result does not prove the exact cause: a quota or rejected login can produce it.
The workflow reports `no_model_response` rather than inventing a quota diagnosis.
Explicit configuration errors take precedence over provider errors. A review with findings
never causes another provider to run. An earlier bot approval of the reviewed commit is
removed when the current result does not approve it.

Documentation-only approvals, diff limits, budget controls and fork restrictions retain
their existing behavior. A newer PR commit makes a running review stale; stale runs publish
nothing. When a provider is unavailable, wait until access returns and re-run the job.

A green unavailable-review run is not an approval. Repository protection can still require
an independent approval before merge; this workflow does not bypass that requirement.

## Codex subscription fallback

Codex subscription fallback is deferred. No `CODEX_AUTH_JSON`, `CODEX_CACHE_KEY` or
`OPENAI_API_KEY` is consumed by this workflow, and there is no paid API fallback.

[OpenAI's CI/CD authentication guide](https://learn.chatgpt.com/docs/auth/ci-cd-auth)
describes preserving the login refreshed by Codex and using one serialized credential stream
on trusted private infrastructure. It explicitly excludes public or open-source repositories.
An eventual subscription fallback needs a separate trusted private execution environment,
a durable login and verified isolation from PR-controlled input. Restoring an unchanged
secret on every ephemeral runner loses refreshed credentials; an Actions cache is not used
as the credential store here.

The manual backtest measures reviewer prompts on historical changes and posts nothing.
PR-Agent responds to explicit commands. Their API credentials and behavior are independent
of the live review and are unchanged.
