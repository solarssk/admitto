import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { LIVE_MARKER, countAttempts, main, newestRun, parseCommand, readLimits, renderLive, runCommand } from './ai-review-command.mjs'
import { STATUS_MARKER } from './ai-review-status.mjs'

const hasJq = existsSync('/usr/bin/jq')
const head = 'a'.repeat(40)
const now = Date.UTC(2026, 9, 7, 14, 3)
const env = (over = {}) => ({ COMMENT_BODY: '/ai-review', COMMENT_ID: '55', COMMENT_USER_ID: '7', OWNER_ID: '7',
  GITHUB_REPOSITORY: 'maintainer/project', PR_NUMBER: '7', ...over })
const run = (id, status, conclusion, over = {}) => ({ id, status, conclusion, event: 'pull_request_target', run_attempt: 1,
  created_at: '2026-10-07T13:00:00Z', run_started_at: '2026-10-07T13:00:05Z', updated_at: '2026-10-07T13:05:00Z',
  html_url: `https://github.com/maintainer/project/actions/runs/${id}`, ...over })
const workflowText = '      PER_PR_LIMIT: 6\n      DAILY_LIMIT: 80\n      DEBOUNCE_SECONDS: 60\n'

// A small stand-in for GitHub: it answers the calls the command makes and records every call.
function github({ pr = {}, runs = [], reviews = [], comments = [], stopAfter = 1, failOn = '', failStatus } = {}) {
  const calls = []
  const board = [...comments]
  let polls = 0
  const route = (method, path, body) => {
    calls.push({ method, path, body })
    if (failOn && `${method} ${path}`.includes(failOn)) throw Object.assign(new Error('GitHub refused'), { status: failStatus })
    if (method === 'GET' && path.endsWith('/pulls/7')) {
      return { state: 'open', draft: false, user: { login: 'maintainer' }, base: { ref: 'main', sha: 'b'.repeat(40) },
        head: { ref: 'feature/x', sha: head, repo: { full_name: 'maintainer/project' } }, ...pr }
    }
    if (method === 'GET' && path.includes('/actions/runs/')) return { status: ++polls >= stopAfter ? 'completed' : 'in_progress' }
    if (method === 'LIST' && path.includes('/actions/workflows/')) return runs
    if (method === 'LIST' && path.endsWith('/issues/7/comments')) return board
    if (method === 'LIST' && path.endsWith('/pulls/7/reviews')) return reviews
    if (method === 'POST' && path.endsWith('/issues/7/comments')) board.push({ id: 900 + board.length, user: { login: 'github-actions[bot]' }, body: body.body, html_url: 'https://example.test/c' })
    if (method === 'PATCH') board.find((comment) => path.endsWith(`/${comment.id}`)).body = body.body
    return {}
  }
  const api = { get: async (p) => route('GET', p), post: async (p, b) => route('POST', p, b), patch: async (p, b) => route('PATCH', p, b),
    put: async (p, b) => route('PUT', p, b), list: async (p) => route('LIST', p) }
  const written = () => board.map((comment) => comment.body)
  const reactions = () => calls.filter((call) => call.path.endsWith('/reactions')).map((call) => call.body.content)
  return { api, calls, board, written, reactions }
}

const command = (fake, over = {}, options = {}) => runCommand({ env: env(over), api: fake.api, sleep: async () => {}, now, count: () => 2, workflowText, ...options })

test('only the exact commands are understood', () => {
  assert.deepEqual(parseCommand('/ai-review'), { action: 'review' })
  assert.deepEqual(parseCommand('  /ai-review  \r\nthanks'), { action: 'review' })
  assert.deepEqual(parseCommand('/ai-review status'), { action: 'status' })
  assert.deepEqual(parseCommand('/ai-review cancel'), { action: 'cancel' })
  assert.deepEqual(parseCommand('/ai-review help'), { action: 'help' })
  assert.deepEqual(parseCommand('/ai-review please'), { action: 'unknown' })
  assert.deepEqual(parseCommand('/ai-review status now'), { action: 'unknown' })
  assert.equal(parseCommand('/ai-reviewer'), null)
  assert.equal(parseCommand('please /ai-review'), null)
  assert.equal(parseCommand('/review'), null)
  assert.equal(parseCommand(undefined), null)
})

test('the newest review run of the pull request event is the one to act on', () => {
  const runs = [run(1, 'completed', 'success'), run(2, 'completed', 'failure', { created_at: '2026-10-07T13:30:00Z' }),
    run(3, 'completed', 'success', { created_at: '2026-10-07T13:30:00Z' }), run(4, 'completed', 'success', { event: 'workflow_dispatch', created_at: '2026-10-07T14:00:00Z' })]
  assert.equal(newestRun(runs).id, 3, 'a tie goes to the later id, a dispatch run is not a push review')
  assert.equal(newestRun([]), undefined)
})

test('a run that belongs to another pull request of the same branch is not acted on', () => {
  const other = run(9, 'completed', 'success', { created_at: '2026-10-07T15:00:00Z', pull_requests: [{ number: 8 }] })
  const mine = run(5, 'completed', 'success', { pull_requests: [{ number: 7 }, { number: 8 }] })
  const silent = run(4, 'completed', 'success', { created_at: '2026-10-07T12:00:00Z', pull_requests: [] })
  assert.equal(newestRun([other, mine, silent], '7').id, 5)
  assert.equal(newestRun([other, silent], '7').id, 4, 'a run that names no pull request is kept')
  assert.equal(newestRun([other], '7'), undefined)
})

test('a run of a fork that happens to use the same branch name is never acted on', () => {
  const fork = run(9, 'completed', 'skipped', { created_at: '2026-10-07T15:00:00Z', head_repository: { full_name: 'someone/fork' } })
  const ours = run(5, 'completed', 'success', { head_repository: { full_name: 'maintainer/project' } })
  const unsaid = run(4, 'completed', 'success', { created_at: '2026-10-07T12:00:00Z' })
  assert.equal(newestRun([fork, ours, unsaid], '7', 'maintainer/project').id, 5)
  assert.equal(newestRun([fork, unsaid], '7', 'maintainer/project').id, 4, 'a run that names no repository is kept')
  assert.equal(newestRun([fork], '7', 'maintainer/project'), undefined)
})

test('a skipped run of a fork does not hide the real run from /ai-review and /ai-review cancel', async () => {
  const fork = run(90, 'completed', 'skipped', { created_at: '2026-10-07T15:00:00Z', head_repository: { full_name: 'someone/fork' } })
  const fake = github({ runs: [run(42, 'completed', 'success', { head_repository: { full_name: 'maintainer/project' } }), fork] })
  assert.deepEqual(await command(fake), { outcome: 'rerun', runId: 42 })
})

test('the limits are read from the review workflow itself', () => {
  assert.deepEqual(readLimits(readFileSync(new URL('../.github/workflows/ai-review.yml', import.meta.url), 'utf8')), { perPr: 6, daily: 80, settle: 60 })
  assert.deepEqual(readLimits(''), { perPr: null, daily: null, settle: null })
})

test('attempts are counted by the same jq rules the workflow uses', { skip: !hasJq }, () => {
  const runs = [run(1, 'completed', 'success'), run(2, 'completed', 'failure'), run(3, 'in_progress', null), run(4, 'completed', 'skipped'),
    run(5, 'completed', 'cancelled', { run_started_at: '2026-10-07T13:00:05Z', updated_at: '2026-10-07T13:00:20Z' })]
  assert.equal(countAttempts(runs, 60), 3, 'a run cancelled during the wait is free, a skipped one did not run')
  assert.throws(() => countAttempts(runs, 60, '/no/such/filter.jq'), /Could not count/)
  assert.throws(() => countAttempts(runs, 60, undefined, '/no/such/jq'), /Could not count/)
})

test('a comment that is not a command, or not from the owner, does nothing at all', async () => {
  for (const over of [{ COMMENT_BODY: 'looks good' }, { COMMENT_USER_ID: '8' }, { OWNER_ID: '' }, { OWNER_ID: 'abc', COMMENT_USER_ID: 'abc' }]) {
    const fake = github()
    assert.deepEqual(await command(fake, over), { outcome: 'ignored' }, JSON.stringify(over))
    assert.deepEqual(fake.calls, [])
  }
})

test('help and an unknown command answer with the list of commands', async () => {
  const help = github()
  assert.equal((await command(help, { COMMENT_BODY: '/ai-review help' })).outcome, 'help')
  assert.match(help.written()[0], /\| `\/ai-review cancel` \|.*withdraws the approval/)
  assert.deepEqual(help.reactions(), ['eyes', '+1'])
  const unknown = github()
  assert.equal((await command(unknown, { COMMENT_BODY: '/ai-review sideways' })).outcome, 'unknown')
  assert.deepEqual(unknown.reactions(), ['eyes', 'confused'])
})

test('/ai-review re-runs the latest run and marks the status comment as started again', async () => {
  const fake = github({ runs: [run(41, 'completed', 'failure', { created_at: '2026-10-07T12:00:00Z' }), run(42, 'completed', 'failure', { run_attempt: 2 })] })
  assert.deepEqual(await command(fake), { outcome: 'rerun', runId: 42 })
  assert.deepEqual(fake.calls.filter((call) => call.method === 'POST').map((call) => call.path), [
    '/repos/maintainer/project/issues/comments/55/reactions', '/repos/maintainer/project/actions/runs/42/rerun',
    '/repos/maintainer/project/issues/7/comments', '/repos/maintainer/project/issues/comments/55/reactions'])
  assert.deepEqual(fake.reactions(), ['eyes', 'rocket'])
  assert.ok(fake.calls.some((call) => call.path.includes('branch=feature%2Fx')), 'runs are looked up by the branch of the pull request')
  const [status] = fake.written()
  assert.ok(status.startsWith(STATUS_MARKER))
  assert.match(status, /AI review: reviewing/)
  assert.match(status, /\[run 42\].*attempt 3/)
  assert.match(status, /not counted, this is a manual re-run/)
})

test('/ai-review first stops a run that is still going, then re-runs it', async () => {
  const fake = github({ runs: [run(42, 'in_progress', null)], stopAfter: 3 })
  let slept = 0
  assert.equal((await command(fake, {}, { sleep: async () => { slept++ } })).outcome, 'rerun')
  const paths = fake.calls.filter((call) => call.method === 'POST').map((call) => call.path)
  assert.ok(paths.indexOf('/repos/maintainer/project/actions/runs/42/cancel') < paths.indexOf('/repos/maintainer/project/actions/runs/42/rerun'))
  assert.equal(slept, 2, 'it waited until the run had really stopped')
})

test('/ai-review does not re-run a run it could not stop', async () => {
  const fake = github({ runs: [run(42, 'in_progress', null)], stopAfter: 1000 })
  const result = await command(fake)
  assert.equal(result.outcome, 'refused')
  assert.match(fake.written()[0], /did not stop within 90 seconds/)
  assert.ok(!fake.calls.some((call) => call.path.endsWith('/rerun')))
  assert.deepEqual(fake.reactions(), ['eyes', 'confused'])
})

test('/ai-review refuses what the review would not do anyway, and says why', async () => {
  const refused = async (setup, text, over = {}) => {
    const fake = github({ runs: [run(42, 'completed', 'success')], ...setup })
    assert.equal((await command(fake, over)).outcome, 'refused')
    assert.match(fake.written()[0], text)
    assert.ok(!fake.calls.some((call) => call.path.endsWith('/rerun')))
  }
  await refused({ pr: { state: 'closed' } }, /is closed/)
  await refused({ pr: { head: { ref: 'x', sha: head, repo: { full_name: 'someone/fork' } } } }, /comes from a fork/)
  await refused({ pr: { draft: true } }, /Draft pull requests are not reviewed/)
  await refused({ pr: { user: { login: 'dependabot[bot]' } } }, /Actions, AI review, Run workflow.*a comment cannot do it/)
  await refused({ pr: { user: { login: 'someone-else' } } }, /only reads pull requests opened by the repository owner/)
  await refused({ runs: [] }, /No AI review run was found.*close and reopen/)
  await refused({ runs: [run(7, 'completed', 'success', { event: 'workflow_dispatch' })] }, /No AI review run was found/)
})

test('/ai-review cancel stops the run, withdraws only this commit\'s bot approval and says so', async () => {
  const bot = { login: 'github-actions[bot]' }
  const reviews = [{ id: 1, user: bot, state: 'APPROVED', commit_id: head }, { id: 2, user: bot, state: 'APPROVED', commit_id: 'c'.repeat(40) },
    { id: 3, user: bot, state: 'COMMENTED', commit_id: head }, { id: 4, user: { login: 'maintainer' }, state: 'APPROVED', commit_id: head }]
  const fake = github({ runs: [run(42, 'in_progress', null)], reviews })
  assert.deepEqual(await command(fake, { COMMENT_BODY: '/ai-review cancel' }), { outcome: 'cancel', runId: 42 })
  assert.deepEqual(fake.calls.filter((call) => call.method === 'PUT').map((call) => call.path), ['/repos/maintainer/project/pulls/7/reviews/1/dismissals'])
  assert.equal(fake.calls.find((call) => call.method === 'PUT').body.event, 'DISMISS')
  assert.match(fake.written()[0], /AI review: cancelled by the maintainer/)
  assert.deepEqual(fake.reactions(), ['eyes', '+1'])
})

test('a run that finishes while it is being cancelled counts as stopped, so the follow-up still happens', async () => {
  const reviews = [{ id: 1, user: { login: 'github-actions[bot]' }, state: 'APPROVED', commit_id: head }]
  const conflict = { failOn: 'POST /repos/maintainer/project/actions/runs/42/cancel', failStatus: 409 }
  const cancel = github({ runs: [run(42, 'in_progress', null)], reviews, ...conflict })
  assert.deepEqual(await command(cancel, { COMMENT_BODY: '/ai-review cancel' }), { outcome: 'cancel', runId: 42 })
  assert.deepEqual(cancel.calls.filter((call) => call.method === 'PUT').map((call) => call.path),
    ['/repos/maintainer/project/pulls/7/reviews/1/dismissals'], 'the approval the run has just posted is withdrawn')
  assert.match(cancel.written()[0], /AI review: cancelled by the maintainer/)
  const again = github({ runs: [run(42, 'in_progress', null)], ...conflict })
  assert.deepEqual(await command(again), { outcome: 'rerun', runId: 42 })
  assert.ok(again.calls.some((call) => call.path.endsWith('/actions/runs/42/rerun')))
})

test('a conflict on cancel is not trusted when the run does not stop, and any other refusal is an error', async () => {
  const cancelPath = 'POST /repos/maintainer/project/actions/runs/42/cancel'
  const stuck = github({ runs: [run(42, 'in_progress', null)], stopAfter: 1000, failOn: cancelPath, failStatus: 409 })
  assert.equal((await command(stuck, { COMMENT_BODY: '/ai-review cancel' })).outcome, 'refused')
  assert.match(stuck.written()[0], /did not stop within 90 seconds/)
  const reviews = [{ id: 1, user: { login: 'github-actions[bot]' }, state: 'APPROVED', commit_id: head }]
  for (const failStatus of [403, 404, 500, undefined]) {
    const refused = github({ runs: [run(42, 'in_progress', null)], reviews, failOn: cancelPath, failStatus })
    assert.equal((await command(refused, { COMMENT_BODY: '/ai-review cancel' })).outcome, 'error', String(failStatus))
    assert.ok(!refused.calls.some((call) => call.method === 'PUT'), 'nothing is dismissed when the cancel itself failed')
  }
})

test('/ai-review cancel with nothing running, or a run that will not stop, changes nothing', async () => {
  const idle = github({ runs: [run(42, 'completed', 'success')] })
  assert.equal((await command(idle, { COMMENT_BODY: '/ai-review cancel' })).outcome, 'refused')
  assert.match(idle.written()[0], /Nothing is running/)
  assert.equal((await command(github({ runs: [] }), { COMMENT_BODY: '/ai-review cancel' })).outcome, 'refused')
  const stuck = github({ runs: [run(42, 'queued', null)], stopAfter: 1000 })
  assert.equal((await command(stuck, { COMMENT_BODY: '/ai-review cancel' })).outcome, 'refused')
  assert.ok(!stuck.calls.some((call) => call.method === 'PUT'))
})

test('/ai-review status writes one live comment with the run, the budget and the last report', async () => {
  const report = { id: 3, user: { login: 'github-actions[bot]' }, body: `${STATUS_MARKER}\nold`, html_url: 'https://example.test/report' }
  const fake = github({ runs: [run(42, 'in_progress', null, { run_started_at: '2026-10-07T14:00:00Z' })], comments: [report] })
  assert.equal((await command(fake, { COMMENT_BODY: '/ai-review status' })).outcome, 'status')
  assert.equal(fake.calls.filter((call) => call.method === 'LIST' && call.path.endsWith('/issues/7/comments')).length, 1,
    'the comments are listed once for both lookups')
  const live = fake.written().find((body) => body.startsWith(LIVE_MARKER))
  assert.match(live, /\*\*Pull request\*\* \| #7, head `aaaaaaa`/)
  assert.match(live, /\*\*Latest run\*\* \| running, attempt 1, started 3 min ago/)
  assert.match(live, /\*\*Earlier attempts\*\* \| this PR 2 of 6, today 2 of 80 \(a `\/ai-review` re-run bypasses both\)/)
  assert.match(live, /\*\*Last report\*\* \| \[status comment\]\(https:\/\/example\.test\/report\)/)
  assert.ok(fake.written().includes(`${STATUS_MARKER}\nold`), 'the review report itself is left alone')
  assert.equal((await command(fake, { COMMENT_BODY: '/ai-review status' })).outcome, 'status')
  assert.equal(fake.written().filter((body) => body.startsWith(LIVE_MARKER)).length, 1, 'asking again edits the same comment')
})

test('the live status copes with no run, unknown limits and every run state', () => {
  const base = { number: '7', head, now, limits: { perPr: null, daily: null }, prRuns: null }
  const none = renderLive({ ...base, run: undefined })
  assert.match(none, /none found for this branch/)
  assert.match(none, /none yet/)
  assert.doesNotMatch(none, /Earlier attempts/)
  assert.match(renderLive({ ...base, prRuns: 1, dayRuns: 4, run: run(1, 'completed', 'success') }), /this PR 1, today 4 /)
  const state = (status, conclusion, started = '2026-10-07T14:03:00Z') => /Latest run\*\* \| ([^,]+),/.exec(renderLive({ ...base, run: run(1, status, conclusion, { run_started_at: started }) }))[1]
  assert.equal(state('queued', null), 'queued')
  assert.equal(state('completed', 'failure'), 'failed')
  assert.equal(state('completed', 'cancelled'), 'cancelled')
  assert.equal(state('completed', 'timed_out'), 'timed out')
  assert.equal(state('completed', 'skipped'), 'skipped')
  assert.equal(state('completed', 'neutral'), 'neutral')
  assert.match(renderLive({ ...base, run: run(1, 'completed', 'success', { run_started_at: '2026-10-07T10:00:00Z' }) }), /started 4 h ago/)
  assert.match(renderLive({ ...base, run: run(1, 'completed', 'success', { run_started_at: undefined, created_at: '2026-10-07T14:03:00Z' }) }), /started just now/)
})

test('without the limits in the workflow the status still answers, without the counts', async () => {
  const fake = github({ runs: [run(42, 'completed', 'success')] })
  assert.equal((await command(fake, { COMMENT_BODY: '/ai-review status' }, { workflowText: 'nothing here' })).outcome, 'status')
  assert.doesNotMatch(fake.written()[0], /Earlier attempts/)
})

test('a GitHub call that fails is answered on the pull request and fails the job', async () => {
  const fake = github({ runs: [run(42, 'completed', 'success')], failOn: 'POST /repos/maintainer/project/actions/runs/42/rerun' })
  const result = await command(fake)
  assert.equal(result.outcome, 'error')
  assert.match(fake.written()[0], /did not complete \(GitHub refused\).*Actions, AI review, Run workflow/)
  assert.deepEqual(fake.reactions(), ['eyes', 'confused'])
  assert.equal(await main(env(), fake.api), 1)
  assert.equal(await main(env({ COMMENT_BODY: 'thanks' }), github().api), 0)
})

test('a failing reaction or comment reply never hides the outcome', async () => {
  const noReactions = github({ runs: [run(42, 'completed', 'success')], failOn: '/reactions' })
  assert.equal((await command(noReactions)).outcome, 'rerun')
  const noComments = github({ runs: [run(42, 'completed', 'success')], failOn: 'POST /repos/maintainer/project/issues/7/comments' })
  assert.equal((await command(noComments)).outcome, 'rerun', 'the re-run happened, the status comment is only a courtesy')
  const nothingWorks = github({ pr: { draft: true }, failOn: 'POST' })
  assert.equal((await command(nothingWorks)).outcome, 'error')
  assert.equal((await command(github(), { COMMENT_ID: 'x', COMMENT_BODY: '/ai-review help' })).outcome, 'help')
})

test('run as a program, the command script ignores a comment that is not a command', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ai-review-command.mjs', import.meta.url))], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...env({ COMMENT_BODY: 'thanks' }), GH_TOKEN: 'x' } })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /AI review command: ignored/)
})

test('the command workflow is owner only, reads nothing from the pull request and uses the comment as data', () => {
  const text = readFileSync(new URL('../.github/workflows/ai-review-command.yml', import.meta.url), 'utf8')
  const guard = text.split('    if: >-\n')[1].split('    permissions:')[0]
  assert.match(text, /^on:\n {2}issue_comment:\n {4}types: \[created\]$/m)
  assert.match(guard, /github\.event\.issue\.pull_request/)
  assert.match(guard, /github\.event\.comment\.user\.id == github\.event\.repository\.owner\.id/)
  assert.match(guard, /github\.triggering_actor == github\.repository_owner/, 'a re-run of an old command by someone else does nothing')
  assert.match(guard, /startsWith\(github\.event\.comment\.body, '\/ai-review'\)/)
  const group = /^ {2}group: (.+)$/m.exec(text)[1]
  assert.match(group, /github\.event\.issue\.number/)
  assert.match(group, /github\.event\.comment\.user\.id == github\.event\.repository\.owner\.id/, 'somebody else\'s comment must not share the owner\'s group')
  assert.match(text, /^permissions: \{\}$/m)
  assert.match(text, /contents: read/)
  assert.doesNotMatch(text, /contents: write|issues: write|id-token/)
  assert.doesNotMatch(text, /^\s+ref:/m, 'the checkout is the default branch, never the pull request')
  assert.doesNotMatch(text.split('        run: ')[1], /\$\{\{/, 'no expression inside the script itself')
  assert.match(text, /COMMENT_BODY: \$\{\{ github\.event\.comment\.body \}\}/)
  assert.match(text, /run: node scripts\/ai-review-command\.mjs/)
})
