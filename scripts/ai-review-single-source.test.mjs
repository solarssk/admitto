import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoFile = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url))
const read = (path) => readFileSync(repoFile(path), 'utf8')

const live = read('.github/workflows/ai-review.yml')
const backtest = read('.github/workflows/ai-review-backtest.yml')

const hasJq = spawnSync('jq', ['--version']).status === 0

function jq(args, input) {
  const result = spawnSync('jq', args, { input: JSON.stringify(input), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test('the live review reads its prompt, schema and diff builder from .github/ai-review', () => {
  // The backtest measures these same files, so an inline copy in the live workflow would make a
  // backtest of the "live" variant test something other than what actually runs.
  assert.match(live, /\.github\/ai-review\/prompt-live\.md/)
  assert.match(live, /\.github\/ai-review\/schema-live\.json/)
  assert.match(live, /\.github\/ai-review\/build-diff\.jq/)
  assert.match(live, /\.github\/ai-review\/count-attempts\.jq/)
  assert.doesNotMatch(live, /prompt: \|/, 'the reviewer prompt must not be inlined in the workflow')
  assert.doesNotMatch(live, /--json-schema '\{/, 'the output schema must not be inlined in the workflow')
})

test('the backtest can replay exactly the live variant', () => {
  assert.match(backtest, /options:\n\s+- live\n/)
  assert.match(backtest, /default: live/)
})

test('the live prompt and schema are usable', () => {
  const prompt = read('.github/ai-review/prompt-live.md')
  assert.match(prompt, /\.ai-review\/pr\.diff/)
  assert.match(prompt, /\.ai-review\/pr-notes\.md/)
  const schema = JSON.parse(read('.github/ai-review/schema-live.json'))
  assert.deepEqual(schema.required, ['verdict', 'summary', 'blocking_findings'])
  assert.deepEqual(schema.properties.verdict.enum, ['approve', 'comment'])
})

test('count-attempts.jq counts a cancelled run only once it got past the debounce wait', { skip: !hasJq }, () => {
  const filter = repoFile('.github/ai-review/count-attempts.jq')
  // gh run list returns timestamps without milliseconds, e.g. 2026-09-30T10:00:00Z
  const at = (secondsAfterStart) =>
    new Date(Date.parse('2026-09-30T10:00:00Z') + secondsAfterStart * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const run = (databaseId, status, conclusion, lifetimeSeconds) => ({
    databaseId,
    status,
    conclusion,
    createdAt: at(-5),
    startedAt: at(0),
    updatedAt: at(lifetimeSeconds),
  })
  const runs = [
    run(1, 'completed', 'success', 200),
    run(2, 'completed', 'failure', 200),
    run(3, 'completed', 'timed_out', 1200),
    run(4, 'completed', 'cancelled', 200), // cancelled while the reviewer was running: cost tokens
    run(5, 'completed', 'cancelled', 30), // cancelled during the debounce wait: free
    run(6, 'in_progress', null, 10),
    run(7, 'queued', null, 0),
    run(8, 'completed', 'skipped', 1),
    run(99, 'completed', 'success', 200), // this run itself
  ]
  const out = jq(['--argjson', 'self', '99', '--argjson', 'settle', '90', '-f', filter], runs)
  assert.equal(Number(out), 6) // 1, 2, 3, 4, 6, 7
})

test('build-diff.jq leaves lockfiles out by name and marks a file without a patch', { skip: !hasJq }, () => {
  const filter = repoFile('.github/ai-review/build-diff.jq')
  const out = jq(['-r', '-f', filter], [
    { filename: 'package-lock.json', patch: '@@ x' },
    { filename: 'apps/a.ts', patch: '@@ -1 +1 @@\n-a\n+b' },
    { filename: 'img/x.png' },
    { filename: 'docs/new.md', previous_filename: 'docs/old.md', status: 'renamed', changes: 0 },
  ])
  assert.match(out, /^EXCLUDED FROM THIS REVIEW .*package-lock\.json/)
  assert.doesNotMatch(out, /diff --git a\/package-lock\.json/)
  assert.match(out, /diff --git a\/apps\/a\.ts b\/apps\/a\.ts\n@@ -1 \+1 @@/)
  assert.match(out, /diff --git a\/img\/x\.png b\/img\/x\.png\nUNAVAILABLE:/)
  // A pure rename has no patch because nothing changed; it must not read as an unreviewable file.
  assert.match(out, /diff --git a\/docs\/old\.md b\/docs\/new\.md\n\(renamed without content changes\)/)
})
