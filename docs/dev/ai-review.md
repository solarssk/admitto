# Automated AI review

The live workflow (`.github/workflows/ai-review.yml`) reviews the repository owner's
same-repository, non-draft PRs with Claude Code on the maintainer's subscription.
It reads the base branch and a text diff; it never checks out or runs PR code.
Both findings and approvals go through one publication step, bound to the reviewed commit.

| If you want to | Read |
|---|---|
| Run it: commands, credentials, what to do when it fails | This page |
| See how it is built: the flow, the files, what is trusted | [ai-review-how-it-works.md](ai-review-how-it-works.md) |
| Learn from it for a similar tool: lessons and a build order | [ai-review-lessons.md](ai-review-lessons.md) |

## Manually review a dependency update

When a human pushes a fix to a Dependabot PR, branch protection can require approval from
another identity. Automatic AI review still skips Dependabot PRs. The repository owner can
request the same reviewer manually:

1. Open **Actions → AI review → Run workflow**.
2. Select the repository's default branch and enter the open PR number.
3. Wait for the review and check its published verdict before merging.

The dispatch and any rerun must be initiated by the repository owner. The target must be an
open, non-draft PR authored by the owner or Dependabot, with both branches in this repository
and the default branch as its base. Forks and other authors are rejected before reading a
provider credential. The workflow reads only trusted workflow code and a text diff; it never
checks out or runs the PR head. Manual runs share the default branch's attempt budget and
the existing daily budget. Both reviewed commits, the base branch and PR eligibility are checked again before publication.

## Status comment and commands

Every review run keeps one comment on the pull request, edited in place and headed
"AI review" with the state: reviewing, approved, comments, a policy approval, failed and so
on. It shows the commit, the size of the change, the model and its turns (and any other model
that billed tokens), how much of the diff the reviewer actually saw, the tools it used, the
other files it opened, the run and where the attempt budget stands. Coverage is counted from the results of the reviewer's tool
calls in the execution log, not from what the model says about itself: the lines a Read
returned (taken from the tool's own structured result, so a big file cut to its first page
counts as that page) and the lines a content search printed. A file that was not read in full
is listed, and an approval that rests on a partly seen diff carries a warning. If the reviewer
used a tool beyond Read, Grep and Glob, or a subagent, what it saw that way cannot be counted:
the figure then says "at least" and the comment names the tools. The workflow limits the
session to those three tools, and the comment warns if the log shows that more were offered.
The verdict and any findings stay in the GitHub review; the comment carries no model text. When a run does not finish, the
comment says why and what to do. The job log of the submit step also prints the shape of the
execution log (event kinds, tool names and counts, never content) in a group called "AI review
execution log shape", so the figures can be checked against what the action really writes.

The repository owner can control a review from a comment on the pull request:

| Command | What it does |
|---|---|
| `/ai-review` | Reviews the current commit again. A running review is stopped first, and the attempt budget is bypassed. |
| `/ai-review status` | Writes a live status comment: the latest run, where the attempt budget stands and a link to the last report. |
| `/ai-review cancel` | Stops a running review and withdraws the bot's approval of that commit. |

Only the owner can use them: the workflow (`ai-review-command.yml`) compares the commenter's
immutable user id with the repository owner's, and the script checks it again. The person who
started the run must be the owner too, so re-running an old command from the Actions page does
nothing for anyone else. A reaction
shows the command was seen, and a refusal is answered with a comment saying why. `/ai-review`
is a GitHub re-run of the latest run, the same manual re-run the workflow treats as attempt
two, so it needs no extra secret. The re-run reads the pull request again, so it reviews the
commit that is there now, but it uses the workflow file of the run it repeats: a run that
started before a workflow change was merged re-runs the old version, and a fresh run (a push,
or closing and reopening the pull request) takes the new one. A Dependabot pull request is
reviewed from **Actions, AI review, Run workflow**, because that dispatch has to be started
by the owner themselves, so a comment cannot do it.

The model step is stopped after 15 minutes, well inside the 30 minute job limit, so a hung
reviewer ends with a failed run and a status comment instead of a silent timeout.

| What the comment says | What to do |
|---|---|
| The reviewer did not finish within 15 minutes | Comment `/ai-review`. |
| Claude unavailable, the login was rejected | Run `claude setup-token`, replace `CLAUDE_CODE_OAUTH_TOKEN`, comment `/ai-review`. |
| Claude unavailable, a usage limit or no model response | Wait until the limit resets (a new token does not reset it), then comment `/ai-review`. |
| Claude unavailable, a service problem | Comment `/ai-review` in a few minutes. |
| Budget used up (policy approval) | Review the diff yourself, or comment `/ai-review` for a real review that bypasses the budget. |
| The diff is too large, or a file has no readable diff | Split the pull request or review by hand; `/ai-review` does not help. |
| Failed with a reason such as `missing_execution_file` | A CI problem, not a provider outage: comment `/ai-review`, and open the run log if it repeats. |

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
| Recognized provider authentication, usage or service failure | Policy approval explaining that no review ran; manual review required | Success |
| Empty error result before any model response, with explicit zero cost and no model usage | Policy approval stating `no_model_response`; manual review required | Success |
| Automated review budget exhausted | Policy approval explaining the budget skip; manual review required | Success |
| Missing or unreadable execution file, malformed verdict, turn limit, unknown failure | No approval | Failure |
| The model step runs longer than 15 minutes and is stopped | No approval | Failure |

An empty result does not prove the exact cause: a quota or rejected login can produce it.
The workflow reports `no_model_response` rather than inventing a quota diagnosis.
Explicit configuration errors take precedence over provider errors. A review with findings
never causes another provider to run. An earlier bot approval of the reviewed commit is
removed when the current result does not approve it.

Documentation-only approvals, diff limits and fork restrictions retain their existing
behavior. Budget controls still prevent additional automatic model calls, but publish
a policy approval when the budget is exhausted. A newer PR commit makes a running review stale; stale runs publish
nothing. When a provider is unavailable, re-run the job after access returns to obtain
a model review.

At the maintainer's explicit request, provider unavailability and budget exhaustion produce
`APPROVE` with a prominent "no AI code review ran" warning. GitHub treats this as a full
approval; "conditional" is explanatory text, not an enforceable GitHub approval state.
The maintainer must review the diff manually before merging. Required status checks remain
in force, and incomplete or oversized diffs and internal errors never gain a policy approval.
The bot never merges. Because the workflow runs from the base branch, this policy takes
effect only after the workflow change is merged.

## Codex subscription fallback

Claude remains primary. Only a classified Claude provider outage starts fallback; valid
Claude findings, docs-only changes, exhausted automatic attempt budgets, oversized or
incomplete diffs and internal Claude errors never request another provider.

Fallback uses the official Codex GitHub connector and the repository owner's linked
ChatGPT subscription. It does not run Codex CLI in Actions, export a ChatGPT login or
use a paid OpenAI API key. The connector posts its own review; it does not issue formal
GitHub approvals. Actions translates a verified clean result into `APPROVE` under
`github-actions[bot]`, a separate identity from the PR author.

### One-time setup

1. Connect the owner's GitHub account to Codex and enable code review for this repository.
   Disable automatic Codex reviews if Codex should run only as fallback.
2. On GitHub, create a **fine-grained personal access token** owned by the same linked
   account. Select only `solarssk/admitto`, grant **Pull requests: Read and write**
   (Metadata read is automatic), and choose a short expiry. Do not grant repository
   administration, workflows, Actions or contents write permissions.
3. Set the token as the Actions repository secret `CODEX_REVIEW_TRIGGER_TOKEN`.
   Never paste it into a PR, chat, log or committed file. Replace it before expiry.

This GitHub token authorizes only the request comment `@codex review` from the linked
owner account. It is not a ChatGPT credential or an OpenAI API key. Live testing showed
that `github-actions[bot]` requests receive a connect-account response, while requests
from the linked owner account receive an actual Codex review. All polling and formal
approvals use the separate, short-lived Actions token.

### Result validation and recovery

The request carries the full commit SHA and is reused on a retry for that same commit.
Actions accepts only the known Codex connector's immutable GitHub user ID, login and
Bot type. A clean result must use the observed connector success format, name the
expected commit and resolve through GitHub to the exact full SHA. Reviews with findings
for that commit override clean comments. Responses predating the request, spoofed
comments, reactions alone, unknown formats and results for another commit do not qualify.
The PR must remain open, same-repository and at the expected head. Automatic requests require
the owner as author; an owner-authorized manual dispatch also permits Dependabot.

The connector is checked every ten seconds for at most eight minutes, plus bounded API
request time. Configuration, identity and GitHub API errors fail the workflow without
approval. If the trigger secret is absent, the connector is not linked, or no usable
result arrives in time, the existing explicit policy approval remains: it states that
no AI review completed and the maintainer must review manually. Codex findings receive
a non-approving comment linking to the findings. A clean result receives an Actions
approval linking to the connector result. Neither provider nor Actions merges.

The connector's GitHub review currently focuses on P0/P1 issues. A clean result means
no major issues were reported, not that every possible defect was excluded. Its text
format is an integration boundary: a format change must be validated before accepting
it, rather than treating arbitrary positive text or a thumbs-up as an approval.

[Official GitHub integration](https://learn.chatgpt.com/docs/third-party/github)
explains account linking and review requests. ChatGPT subscription usage and API billing
are separate. `CODEX_AUTH_JSON`, `CODEX_CACHE_KEY` and `OPENAI_API_KEY` are not consumed;
old subscription-login secrets are unnecessary and can be removed by the maintainer.

The manual backtest measures reviewer prompts on historical changes and posts nothing.
PR-Agent responds to explicit commands. Their API credentials and behavior are independent
of the live review and are unchanged.
