import assert from 'node:assert/strict'
import test from 'node:test'
import { assessCodexResult, runCodexFallback, githubApi, main } from './ai-review-codex.mjs'

const head = 'a'.repeat(40)
const user = { id: 199175422, login: 'chatgpt-codex-connector[bot]', type: 'Bot' }
const date = '2026-01-01T12:00:00Z'
const clean = { id: 10, user, created_at: date,
  body: `Codex Review: Didn't find any major issues. Good.\n\n**Reviewed commit:** \`${head.slice(0, 10)}\`\n\n<details>Help</details>` }
const review = { id: 20, user, commit_id: head, submitted_at: date, state: 'COMMENTED' }
function assess(comments = [clean], reviews = []) {
  return assessCodexResult({ comments, reviews, head, requestedAt: date })
}

test('only a fresh official connector result for the expected commit is a clean candidate', () => {
  assert.equal(assess().status, 'candidate')
  for (const patch of [{user: {...user, id: 1}}, {user: {...user, type: 'User'}},
    {user: {...user, login: 'other-bot'}}, {created_at: '2025-01-01T12:00:00Z'},
    {body: clean.body.replace(head.slice(0, 10), 'b'.repeat(10))}, {body: '👍'}, {body: 'arbitrary message'}]) {
    assert.equal(assess([{...clean, ...patch}]).status, 'pending')
  }
  assert.equal(assess([{...clean, body: 'To use Codex here, connect.'}]).reason, 'connector_not_linked')
})
test('review findings override a clean comment; stale and foreign reviews do not', () => {
  assert.equal(assess([clean], [review]).status, 'findings')
  assert.equal(assess([clean], [{...review, state: 'CHANGES_REQUESTED'}]).status, 'findings')
  for (const patch of [{commit_id: 'b'.repeat(40)}, {submitted_at: '2025-01-01T12:00:00Z'},
    {state: 'DISMISSED'}, {user: {...user, id: 1}}]) {
    assert.equal(assess([clean], [{...review, ...patch}]).status, 'candidate')
  }
})

function harness(options = {}) {
  const calls = []
  let prReads = 0
  const owner = {login: 'example', id: 1}
  const pr = {state: 'open', head: {sha: head, repo: {full_name: 'example/repo'}}, user: owner}
  return { calls, config: { repository: 'example/repo', number: '1', head,
    triggerToken: 'trigger-token', readToken: 'read-token', attempts: 1, sleep: async () => {},
    api: async (path, token, method = 'GET', body) => {
      calls.push({path, token, method, body})
      if (options.error) throw new Error('Secret-shaped details must never be published')
      if (path === '/user') return options.owner ?? owner
      if (path.endsWith('/pulls/1')) return (++prReads > 1 && options.stale) ? {...pr, state: 'closed'} : pr
      if (path.includes('/commits/')) return {sha: options.resolvedHead ?? head}
      if (method === 'POST') return {id: 30, created_at: date}
      if (path.endsWith('/reviews')) return options.reviews ?? []
      if (path.endsWith('/comments')) {
        const existing = options.existing ? [{id: 30, user: owner, created_at: date,
          body: `@codex review\n\n<!-- admitto-codex-fallback:${head} -->`}] : []
        return [...existing, ...(options.comments ?? [clean])]
      }
      throw new Error('Unexpected API route')
    },
  }}
}

test('request uses the linked owner token, polling uses Actions, full commit resolves before approval', async () => {
  const {config, calls} = harness()
  assert.equal((await runCodexFallback(config)).status, 'clean')
  const post = calls.find((call) => call.method === 'POST')
  assert.equal(post.token, 'trigger-token')
  assert.match(post.body.body, /^@codex review\n/)
  assert.equal(calls.find((call) => call.path.includes('/commits/')).token, 'read-token')
  assert.ok(calls.filter((call) => call.method === 'GET' && call.path !== '/user').every((call) => call.token === 'read-token'))
})
test('duplicate requests reuse the same commit; findings do not approve', async () => {
  const reuse = harness({existing: true})
  assert.equal((await runCodexFallback(reuse.config)).status, 'clean')
  assert.equal(reuse.calls.filter((call) => call.method === 'POST').length, 0)
  assert.equal((await runCodexFallback(harness({reviews: [review]}).config)).status, 'findings')
})
test('missing trigger, stale head, ambiguous SHA and timeout never become a clean review', async () => {
  const noToken = harness()
  assert.equal((await runCodexFallback({...noToken.config, triggerToken: ''})).reason, 'trigger_not_configured')
  assert.equal(noToken.calls.length, 0)
  assert.equal((await runCodexFallback(harness({stale: true}).config)).status, 'stale')
  assert.equal((await runCodexFallback(harness({resolvedHead: 'b'.repeat(40)}).config)).reason, 'review_timeout')
  assert.equal((await runCodexFallback(harness({comments: []}).config)).reason, 'review_timeout')
})
test('bad identities, inputs and GitHub failures are internal errors', async () => {
  await assert.rejects(runCodexFallback(harness({owner: {login: 'wrong'}}).config))
  await assert.rejects(runCodexFallback({...harness().config, head: 'malformed'}))
  await assert.rejects(runCodexFallback(harness({error: true}).config))
})

test('GitHub transport sends scoped auth, reads every page and fails on bad responses', async () => {
  const original = globalThis.fetch
  const calls = []
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({url, options})
      return {ok: true, json: async () => url.endsWith('page=1') ? Array(100).fill({id: 1}) : []}
    }
    assert.equal((await githubApi('/example', 'private-token', 'GET', undefined, true)).length, 100)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].options.headers.Authorization, 'Bearer private-token')
    globalThis.fetch = async () => ({ok: true, json: async () => ({id: 2})})
    assert.equal((await githubApi('/example', 'private-token', 'POST', {body: 'command'})).id, 2)
    await assert.rejects(githubApi('/example', 'private-token', 'GET', undefined, true))
    globalThis.fetch = async () => ({ok: false})
    await assert.rejects(githubApi('/example', 'private-token'))
    globalThis.fetch = async () => ({ok: true, json: async () => Array(100).fill({id: 1})})
    await assert.rejects(githubApi('/example', 'private-token', 'GET', undefined, true))
  } finally { globalThis.fetch = original }
})
test('entrypoint writes fixed outputs and sanitizes setup/API failures', async () => {
  const {mkdtempSync, readFileSync, rmSync} = await import('node:fs')
  const {tmpdir} = await import('node:os')
  const {join} = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'codex-fallback-'))
  try {
    const env = {GITHUB_OUTPUT: join(dir, 'outputs'), GITHUB_REPOSITORY: 'example/repo',
      PR_NUMBER: '1', HEAD_SHA: head, GH_TOKEN: 'read-token', CODEX_REVIEW_TRIGGER_TOKEN: 'trigger-token'}
    assert.equal(await main(env, harness().config.api), 0)
    assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /status=clean/)
    assert.equal(await main(env, harness({error: true}).config.api), 1)
    const output = readFileSync(env.GITHUB_OUTPUT, 'utf8')
    assert.match(output, /status=error/)
    assert.doesNotMatch(output, /Secret-shaped|trigger-token|read-token/)
  } finally { rmSync(dir, {recursive: true, force: true}) }
})
