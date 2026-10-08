# Building an AI code reviewer: lessons from this one

What we learned building Admitto's reviewer, written as advice for building a similar tool. Each
lesson says where to see it in this repository. How the pieces fit is in
[ai-review-how-it-works.md](ai-review-how-it-works.md).

1. **Run the rules from the trusted branch.** Trigger on `pull_request_target`, so the workflow
   definition comes from the base branch, and never check out or run the pull request. A change
   that could edit its own reviewer could approve itself. (`ai-review.yml`, header comment)

2. **Treat what goes in and what comes out as hostile.** The diff, the description and file
   names can carry instructions, and the answer can carry anything. Give the model read-only
   tools and a fixed JSON schema, tell it the diff is data, and scan what you post for
   credential-shaped text. Then injected text can at worst skew a verdict. (`prompt-live.md`,
   the credential scan in the submit step)

3. **Bind the verdict to a commit and check again before publishing.** A review of commit A says
   nothing about commit B. Publish with `commit_id`, re-read the pull request just before, and
   publish nothing if it moved. (`current_review_target`, the submit step)

4. **Fail closed, and tell failures apart.** Only a valid `approve` with no blocking finding is
   a review approval, and an approval the policy grants without a review says so in its first
   words. "The model did not answer" is several different things (login rejected, usage limit,
   provider outage, a bug in your own CI) with different fixes, so classify them, say which one
   it was, and do not invent a cause the evidence does not show: an empty result is reported as
   `no_model_response`, not as "quota". (`ai-review-outcome.mjs`)

5. **Cap spend and time.** Wait briefly so a burst of pushes costs one review, keep a budget per
   pull request and per day (count failed and timed-out runs too), and stop the model step
   before the job timeout so the run can still report what happened. (`PER_PR_LIMIT`,
   `DAILY_LIMIT`, `count-attempts.jq`, `timeout-minutes` on the model step)

6. **Measure what the reviewer did from the log, never from what it says.** A model will happily
   claim it read everything. Count its tool calls and their results instead. And let every
   metric answer "cannot tell": our first coverage figure said "read 0 of 1,522 lines" about a
   review that had plainly read the diff, because it assumed one log format and counted
   everything it did not recognise as unread. It now takes the lines from the tool's structured
   result, says "at least" when a subagent or another tool is involved, says "not available"
   when nothing matches, and sits next to the raw tool counts so a reader can cross-check it.
   (`summarizeExecution`)

7. **Know the difference between asking and enforcing.** In Claude Code, `--allowedTools` only
   pre-approves tools; it does not take the others away. We found out by listing what the
   session was offered: with `--allowedTools "Read,Grep,Glob"` alone it was about twenty tools,
   among them a subagent, a shell, file writes and web access (the permission system refused only
   the ones that need approval, in a headless run). `--tools "Read,Grep,Glob"` leaves exactly
   those three, plus the tool that carries the structured answer. It limits built-in tools only:
   tools from MCP servers need a restriction of their own (this workflow configures none). Check
   what your setup really offers, restrict it, and make every run show the evidence: the status
   comment warns if the log shows more was offered. (`ai-review.yml`, the Tools row)

8. **Give people one place to look, made of facts.** One status comment per pull request, edited
   in place and found by a hidden marker and the bot's login, with the commit, the model, the
   size, the coverage, the tools, the budget and what to do next. No model prose in it, and
   anything that came from a tool call shows only inside a sanitized code span.
   (`ai-review-status.mjs`)

9. **Give the owner a way out.** Automation hangs, fails and runs out of tokens. Add commands
   (`/ai-review`, `status`, `cancel`) authorized by the immutable user id, a concurrency group
   that someone else's comment cannot displace, and a timeout so a stuck run ends by itself.
   (`ai-review-command.yml`)

10. **Keep the logic in scripts you can test.** The workflow only wires steps together. Decisions
    live in small modules with unit tests, and the riskiest step is tested by running its real
    bash with `gh` and `node` stubbed. (`scripts/ai-review-*.test.mjs`)

11. **Measure the reviewer, not only the code.** A reviewer that approves everything looks
    perfect. An early backtest of ours approved all eight past pull requests it replayed and
    raised none of the twelve defects a second reviewer had found in them, so its approval is
    treated as formal and not as proof, and a prompt change is measured on past changes first.
    (`ai-review-backtest.yml`)

12. **Write down what only a live run can prove.** Some behaviour of GitHub Actions cannot be run
    locally (permissions, re-run rules, what an action writes into its log). List those
    assumptions in the pull request, and make the first live run print the evidence that settles
    them: the shape of the execution log is printed to the job log for this reason.

## If you start from zero

Build in this order, and ship each step alone:

1. The trust boundary: a trigger from the trusted branch, a target validated through the API,
   no pull request code run.
2. The input: the diff as a text file, lockfiles dropped by exact name, anything it could not
   show marked as such.
3. The model step: read-only tools, a prompt that treats the diff as data, a JSON schema and a
   timeout.
4. Publication: validate the answer, scan it, re-check the pull request, publish bound to the
   commit.
5. Failure handling and budgets.
6. The status comment and the measurement of what the reviewer saw.
7. Commands for the owner.
