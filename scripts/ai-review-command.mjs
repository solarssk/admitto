import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { STATUS_MARKER, checkTarget, createApi, findComment, renderStatus, upsertComment } from './ai-review-status.mjs'

// Comment commands for the AI review, for the repository owner only (the workflow checks the
// commenter's immutable user id, and this file checks it again):
//   /ai-review          review the current commit again (stops a stuck run, bypasses the budget)
//   /ai-review status   show the latest run and where the attempt budget stands
//   /ai-review cancel   stop a running review and withdraw the approval of this commit
// A re-run is a GitHub re-run of the latest run, which is the manual re-run the workflow already
// treats as "attempt 2": no wait for further pushes and no budget check. The re-run resolves the
// pull request again from the API, so it always reviews the commit that is there now.

export const LIVE_MARKER = '<!-- admitto-ai-review-live -->'

const WORKFLOW = 'ai-review.yml'
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending'])
const COUNT_FILTER = fileURLToPath(new URL('../.github/ai-review/count-attempts.jq', import.meta.url))
// By absolute path, not a bare "jq" that the OS would search PATH for (SonarCloud javascript:S4036,
// as in scripts/check-pr-docs-impact.mjs). Every GitHub-hosted Ubuntu runner has it here.
const JQ = '/usr/bin/jq'
const WORKFLOW_FILE = fileURLToPath(new URL(`../.github/workflows/${WORKFLOW}`, import.meta.url))

const HELP = [
  '**AI review commands** (repository owner only, as a comment on a pull request)', '',
  '| Command | What it does |', '|:--|:--|',
  '| `/ai-review` | Reviews the current commit again. A stuck run is stopped first, and the attempt budget is bypassed. |',
  '| `/ai-review status` | Shows the latest run, where the attempt budget stands and a link to the last report. |',
  '| `/ai-review cancel` | Stops a running review and withdraws the approval of this commit. |', '',
  'A Dependabot pull request is reviewed from **Actions, AI review, Run workflow** with its number.',
].join('\n')

export function parseCommand(body) {
  const first = String(body ?? '').split('\n', 1)[0].trim()
  const match = /^\/ai-review(?:\s+(status|cancel|help))?$/.exec(first)
  if (match) return { action: match[1] ?? 'review' }
  return /^\/ai-review(\s|$)/.test(first) ? { action: 'unknown' } : null
}

// Runs are looked up by the name of the head branch, which two pull requests can share, and a fork
// can use any name: a run from another repository never counts, and when a run says which pull
// requests it belongs to, only the one that was commented on does (a run that says nothing is kept).
export function newestRun(runs, number, repository) {
  const belongs = (run) => !Array.isArray(run.pull_requests) || run.pull_requests.length === 0 ||
    run.pull_requests.some((pull) => pull.number === Number(number))
  const ours = (run) => !run.head_repository?.full_name || run.head_repository.full_name === repository
  return runs.filter((run) => run.event === 'pull_request_target' && ours(run) && belongs(run))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0]
}

// The limits live in the workflow's own env block, so this reads them from there.
export function readLimits(workflowText) {
  const read = (pattern) => Number(pattern.exec(workflowText)?.[1]) || null
  return {
    perPr: read(/^ +PER_PR_LIMIT: (\d+)/m),
    daily: read(/^ +DAILY_LIMIT: (\d+)/m),
    settle: read(/^ +DEBOUNCE_SECONDS: (\d+)/m),
  }
}

// One implementation of the counting rules: the jq filter the workflow itself uses.
export function countAttempts(runs, settleSeconds, filter = COUNT_FILTER, jq = JQ) {
  const input = runs.map((run) => ({ databaseId: run.id, status: run.status, conclusion: run.conclusion,
    createdAt: run.created_at, startedAt: run.run_started_at, updatedAt: run.updated_at }))
  const result = spawnSync(jq, ['--argjson', 'self', '0', '--argjson', 'settle', String(settleSeconds), '-f', filter],
    { input: JSON.stringify(input), encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Could not count the review attempts')
  return Number(result.stdout)
}

function runState(run) {
  if (ACTIVE.has(run.status)) return run.status === 'in_progress' ? 'running' : 'queued'
  const states = { success: 'finished', failure: 'failed', cancelled: 'cancelled', timed_out: 'timed out',
    skipped: 'skipped, the pull request was not eligible' }
  return states[run.conclusion] ?? run.conclusion ?? run.status
}

function ago(from, now) {
  const minutes = Math.max(0, Math.round((now - Date.parse(from)) / 60000))
  if (minutes < 1) return 'just now'
  return minutes < 120 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`
}

const outOf = (count, limit) => (limit ? `${count} of ${limit}` : String(count))

export function renderLive(f) {
  const run = f.run
  const budget = f.prRuns == null ? ''
    : `this PR ${outOf(f.prRuns, f.limits.perPr)}, today ${outOf(f.dayRuns, f.limits.daily)} (a \`/ai-review\` re-run bypasses both)`
  const rows = [
    ['Pull request', `#${f.number}, head \`${String(f.head).slice(0, 7)}\``],
    ['Latest run', run
      ? `${runState(run)}, attempt ${run.run_attempt ?? 1}, started ${ago(run.run_started_at ?? run.created_at, f.now)} ([run](${run.html_url}))`
      : 'none found for this branch'],
    ['Earlier attempts', budget],
    ['Last report', f.reportUrl ? `[status comment](${f.reportUrl})` : 'none yet'],
  ].filter(([, value]) => value)
  return [LIVE_MARKER, '## AI review: live status', '', '| Item | Detail |', '|:--|:--|',
    ...rows.map(([label, value]) => `| **${label}** | ${value} |`), '',
    '`/ai-review` reviews again, `/ai-review cancel` stops a run.', '',
    `<sub>Updated ${new Date(f.now).toISOString().slice(0, 16).replace('T', ' ')} UTC</sub>`].join('\n')
}

// Reads the run until it has completed: 30 reads, three seconds apart.
async function waitUntilStopped(api, repository, run, sleep, reads = 30) {
  if ((await api.get(`/repos/${repository}/actions/runs/${run.id}`)).status === 'completed') return true
  if (reads <= 1) return false
  await sleep(3000)
  return waitUntilStopped(api, repository, run, sleep, reads - 1)
}

async function stopRun(api, repository, run, sleep) {
  try {
    await api.post(`/repos/${repository}/actions/runs/${run.id}/cancel`)
  } catch (error) {
    // A run that finished after it was listed answers 409 Conflict: GitHub's way of saying it is not
    // running any more. The poll below reads the run again and tells which, so the follow-up (the
    // re-run, or withdrawing the approval the run has just posted) goes ahead.
    if (error.status !== 409) throw error
  }
  return waitUntilStopped(api, repository, run, sleep)
}

async function dismissApprovals(api, repository, number, head) {
  const reviews = await api.list(`/repos/${repository}/pulls/${number}/reviews`)
  const approvals = reviews.filter((item) => item.user?.login === 'github-actions[bot]' &&
    item.state === 'APPROVED' && item.commit_id === head)
  await Promise.all(approvals.map((review) => api.put(`/repos/${repository}/pulls/${number}/reviews/${review.id}/dismissals`,
    { message: 'AI review cancelled by the maintainer.', event: 'DISMISS' })))
}

const NOT_STOPPED = 'The running review did not stop within 90 seconds. Try again in a minute.'
const DEPENDABOT = 'A Dependabot pull request is reviewed from **Actions, AI review, Run workflow** with this PR number. That dispatch has to be started by you, so a comment cannot do it.'

// Why a pull request cannot be reviewed at all, or an empty string.
function whyNotReviewable(pr, repository) {
  if (pr.state !== 'open') return 'This pull request is closed, so there is nothing to review.'
  if (pr.head?.repo?.full_name !== repository) {
    return 'This pull request comes from a fork. The AI review only reads pull requests from this repository.'
  }
  return ''
}

// Why a re-review would not run for it (the push review skips drafts and other authors), or an empty string.
function whyNoReview(pr, repository) {
  if (pr.draft) return 'Draft pull requests are not reviewed. Marking it ready for review starts a review.'
  if (pr.user?.login === repository.split('/')[0]) return ''
  return pr.user?.login === 'dependabot[bot]' ? DEPENDABOT : 'The AI review only reads pull requests opened by the repository owner.'
}

const statusFacts = (c) => ({ server: c.server, repository: c.repository, number: c.number, head: c.pr.head.sha, base: c.pr.base?.sha,
  baseRef: c.pr.base?.ref, now: c.now, trigger: 'pull_request_target', runId: c.latest?.id })

async function showStatus(c) {
  const limits = readLimits(c.workflowText ?? readFileSync(WORKFLOW_FILE, 'utf8'))
  const today = new Date(c.now).toISOString().slice(0, 10)
  const created = encodeURIComponent(`>=${today}`)
  const day = await c.api.list(`/repos/${c.repository}/actions/workflows/${WORKFLOW}/runs?created=${created}`, 'workflow_runs')
  const comments = await c.api.list(`/repos/${c.repository}/issues/${c.number}/comments`)
  const report = await findComment(c.api, { repository: c.repository, number: c.number, marker: STATUS_MARKER, comments })
  const counted = (list) => (limits.settle == null ? null : c.count(list, limits.settle))
  await upsertComment(c.api, { repository: c.repository, number: c.number, marker: LIVE_MARKER, comments, body: renderLive({
    number: c.number, head: c.pr.head.sha, now: c.now, run: c.latest, limits, reportUrl: report?.html_url,
    prRuns: counted(c.runs), dayRuns: counted(day) }) })
  await c.react('rocket')
  return { outcome: 'status' }
}

async function cancelReview(c) {
  if (!c.latest || !ACTIVE.has(c.latest.status)) return c.refuse('Nothing is running for this pull request.')
  if (!await stopRun(c.api, c.repository, c.latest, c.sleep)) return c.refuse(NOT_STOPPED)
  await dismissApprovals(c.api, c.repository, c.number, c.pr.head.sha)
  await upsertComment(c.api, { repository: c.repository, number: c.number, marker: STATUS_MARKER,
    body: renderStatus({ ...statusFacts(c), state: 'cancelled', attempt: c.latest.run_attempt ?? 1 }) })
  await c.react('+1')
  return { outcome: 'cancel', runId: c.latest.id }
}

async function reviewAgain(c) {
  const refusal = whyNoReview(c.pr, c.repository)
  if (refusal) return c.refuse(refusal)
  if (!c.latest) return c.refuse('No AI review run was found for this branch. Push a commit, or close and reopen the pull request, to start one.')
  if (ACTIVE.has(c.latest.status) && !await stopRun(c.api, c.repository, c.latest, c.sleep)) return c.refuse(NOT_STOPPED)
  await c.api.post(`/repos/${c.repository}/actions/runs/${c.latest.id}/rerun`)
  // The new attempt writes its own status once it gets to the reviewer; this fills the gap.
  await upsertComment(c.api, { repository: c.repository, number: c.number, marker: STATUS_MARKER,
    body: renderStatus({ ...statusFacts(c), state: 'reviewing', attempt: (c.latest.run_attempt ?? 1) + 1 }) }).catch(() => {})
  await c.react('rocket')
  return { outcome: 'rerun', runId: c.latest.id }
}

const ACTIONS = { status: showStatus, cancel: cancelReview, review: reviewAgain }

export async function runCommand({ env, api, sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  now = Date.now(), count = countAttempts, workflowText }) {
  const command = parseCommand(env.COMMENT_BODY)
  if (!command || !/^\d+$/.test(env.OWNER_ID ?? '') || env.COMMENT_USER_ID !== env.OWNER_ID) return { outcome: 'ignored' }
  const repository = env.GITHUB_REPOSITORY
  const number = env.PR_NUMBER
  checkTarget(repository, number)
  const react = (content) => /^\d+$/.test(env.COMMENT_ID ?? '')
    ? api.post(`/repos/${repository}/issues/comments/${env.COMMENT_ID}/reactions`, { content }).catch(() => {})
    : Promise.resolve()
  const reply = (body) => api.post(`/repos/${repository}/issues/${number}/comments`, { body })
  const refuse = async (text) => {
    await reply(text)
    await react('confused')
    return { outcome: 'refused', reason: text }
  }
  await react('eyes')
  if (command.action === 'help' || command.action === 'unknown') {
    await reply(HELP)
    await react(command.action === 'help' ? '+1' : 'confused')
    return { outcome: command.action }
  }

  try {
    const pr = await api.get(`/repos/${repository}/pulls/${number}`)
    const refusal = whyNotReviewable(pr, repository)
    if (refusal) return await refuse(refusal)
    const runs = await api.list(`/repos/${repository}/actions/workflows/${WORKFLOW}/runs?branch=${encodeURIComponent(pr.head.ref)}`, 'workflow_runs')
    return await ACTIONS[command.action]({ api, repository, number, server: env.GITHUB_SERVER_URL || 'https://github.com', now, sleep, count,
      workflowText, react, refuse, pr, runs, latest: newestRun(runs, number, repository) })
  } catch (error) {
    await reply(`The command did not complete (${error.message}). Open the run log, or use **Actions, AI review, Run workflow**.`).catch(() => {})
    await react('confused')
    return { outcome: 'error', reason: error.message }
  }
}

export async function main(env = process.env, api = createApi(env.GH_TOKEN)) {
  const result = await runCommand({ env, api })
  console.log(`AI review command: ${result.outcome}`)
  return result.outcome === 'error' ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
