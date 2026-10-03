import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('count-attempts.jq counts a cancelled run once it lived past the debounce wait', { skip: !hasJq }, () => {
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
    run(9, 'completed', 'cancelled', 75), // 15 s past the wait: checkout and diff preparation are quick, so the reviewer may have started
    run(6, 'in_progress', null, 10),
    run(7, 'queued', null, 0),
    run(8, 'completed', 'skipped', 1),
    run(99, 'completed', 'success', 200), // this run itself
  ]
  const out = jq(['--argjson', 'self', '99', '--argjson', 'settle', '60', '-f', filter], runs)
  assert.equal(Number(out), 7) // 1, 2, 3, 4, 6, 7, 9
})

test('the live review waits and counts against one debounce number', () => {
  // A cancelled run counts once it lived longer than the wait, so the wait and the count must read
  // the same value; a second literal for either would let them drift apart.
  assert.match(live, /DEBOUNCE_SECONDS: \d+/)
  assert.match(live, /sleep "\$DEBOUNCE_SECONDS"/)
  assert.equal((live.match(/--argjson settle "\$DEBOUNCE_SECONDS"/g) ?? []).length, 2)
  assert.doesNotMatch(live, /--argjson settle \d/)
  assert.doesNotMatch(live, /sleep \d/)
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

// ---- Claude -> Codex fallback ----

const execFile = (messages) => messages // the execution file is an array of SDK messages
const assistantError = (error) => ({ type: 'assistant', error, message: { type: 'message', content: [] } })
const resultMessage = (fields) => ({ type: 'result', subtype: 'success', is_error: false, ...fields })

function classify(messages) {
  const filter = repoFile('.github/ai-review/classify-claude-failure.jq')
  return jq(['-r', '-f', filter], execFile(messages)).trim()
}

test('classify-claude-failure.jq falls back only for provider problems', { skip: !hasJq }, () => {
  // Provider problems: typed errors from the SDK.
  for (const error of ['authentication_failed', 'billing_error', 'rate_limit', 'overloaded', 'server_error', 'oauth_org_not_allowed']) {
    assert.equal(classify([assistantError(error), resultMessage({ is_error: true })]), error)
  }
  // The same, only visible in the result text (older wording).
  assert.equal(classify([resultMessage({ is_error: true, result: 'Claude AI usage limit reached|1760000000' })]), 'provider_error')
  assert.equal(classify([resultMessage({ is_error: true, result: 'API Error: 529 Overloaded' })]), 'provider_error')
  // Not provider problems: our own configuration, or a review that did not finish.
  assert.equal(classify([assistantError('invalid_request'), resultMessage({ is_error: true })]), '')
  assert.equal(classify([assistantError('model_not_found'), resultMessage({ is_error: true })]), '')
  assert.equal(classify([assistantError('unknown'), resultMessage({ is_error: true })]), '')
  assert.equal(classify([resultMessage({ subtype: 'error_max_turns', is_error: true })]), '')
  assert.equal(classify([resultMessage({ subtype: 'error_max_structured_output_retries', is_error: true })]), '')
  assert.equal(classify([resultMessage({ is_error: true, result: 'Schema validation failed' })]), '')
  assert.equal(classify([resultMessage({ result: 'The diff has blocking findings (port 5290)' })]), '')
  assert.equal(classify([]), '')
})

// A step's lines, without the comment lines that precede the next step.
const stepBody = (name) =>
  (live.split(`- name: ${name}\n`)[1]?.split(/\n      - /)[0] ?? '')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')

test('the Codex fallback runs only after a provider failure and publishes through the one Submit step', () => {
  // Claude stays the primary reviewer and its failure is inspected, not assumed.
  assert.match(live, /id: review\n[\s\S]*?continue-on-error: true\n[\s\S]*?uses: anthropics\/claude-code-action@/)
  assert.match(live, /classify-claude-failure\.jq/)
  assert.match(live, /steps\.review\.outcome != 'success'/)
  // Every Codex step is gated on the classifier, and no Codex step swallows its own failure.
  for (const step of ['Install the Codex CLI', 'Review the diff with Codex']) {
    const block = stepBody(step)
    assert.match(block, /steps\.claude_status\.outputs\.fallback == 'true'/, step)
    assert.doesNotMatch(block, /continue-on-error/, step)
  }
  // One publication: nothing but the Submit step may call the review/comment API, and it takes
  // either provider's structured output.
  assert.equal((live.match(/pulls\/\$\{PR_NUMBER\}\/reviews" \\\n\s+-f commit_id/g) ?? []).length, 1)
  assert.match(live, /STRUCTURED: \$\{\{ steps\.review\.outputs\.structured_output \|\| steps\.codex\.outputs\.structured \}\}/)
  // The Codex credential and no GitHub token go to the Codex step; the credential goes nowhere else.
  const codexStep = stepBody('Review the diff with Codex')
  assert.match(codexStep, /CODEX_AUTH_JSON: \$\{\{ secrets\.CODEX_AUTH_JSON \}\}/)
  assert.doesNotMatch(codexStep, /GH_TOKEN|github\.token|GITHUB_TOKEN/)
  assert.equal((live.match(/secrets\.CODEX_AUTH_JSON/g) ?? []).length, 1)
  // No paid OpenAI API key anywhere in the review.
  assert.doesNotMatch(live, /OPENAI_API_KEY/)
})

test('the Codex CLI is pinned by an exact version and a lockfile', () => {
  const pkg = JSON.parse(read('.github/ai-review/codex/package.json'))
  assert.match(pkg.dependencies['@openai/codex'], /^\d+\.\d+\.\d+$/)
  const lock = JSON.parse(read('.github/ai-review/codex/package-lock.json'))
  assert.equal(lock.packages['node_modules/@openai/codex'].version, pkg.dependencies['@openai/codex'])
  assert.match(live, /npm ci --ignore-scripts/)
  assert.doesNotMatch(live, /npm (i|install) -g|@openai\/codex@/)
})

const hasBash = spawnSync('bash', ['--version']).status === 0

function runCodexScript({ authJson, stub }) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-review-test-'))
  try {
    const bin = join(dir, 'codex')
    writeFileSync(bin, `#!/usr/bin/env bash\n${stub}\n`, { mode: 0o755 })
    const out = join(dir, 'github-output')
    writeFileSync(out, '')
    const env = { PATH: process.env.PATH, RUNNER_TEMP: dir, GITHUB_OUTPUT: out, CODEX_BIN: bin }
    if (authJson !== undefined) env.CODEX_AUTH_JSON = authJson
    const run = spawnSync('bash', [repoFile('.github/ai-review/run-codex-review.sh')], { cwd: repoFile(''), env, encoding: 'utf8' })
    const outputs = Object.fromEntries(readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
    return { run, outputs, leftovers: existsSync(join(dir, 'codex-home')) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const subscriptionLogin = JSON.stringify({
  auth_mode: 'chatgpt',
  OPENAI_API_KEY: null,
  tokens: { id_token: 'id-token-value-0123456789', access_token: 'access-token-value-0123456789', refresh_token: 'refresh-token-value-0123456789' },
})
const goodReview = '{"verdict":"approve","summary":"Looks fine.","blocking_findings":[]}'
// The stub finds the -o target the way the script passes it and writes its answer there.
const writeResult = (json) => `OUT=""; while [ $# -gt 0 ]; do [ "$1" = "--output-last-message" ] && OUT="$2"; shift; done; printf '%s' '${json}' > "$OUT"`

test('run-codex-review.sh reports every unavailable case as ok=false and cleans up', { skip: !(hasJq && hasBash) }, () => {
  const cases = [
    ['no secret', { authJson: undefined, stub: 'exit 0' }, 'not_configured'],
    ['an API-key login is refused', { authJson: JSON.stringify({ OPENAI_API_KEY: 'sk-test-0123456789abcdef' }), stub: 'exit 0' }, 'bad_credential'],
    ['login rejected', { authJson: subscriptionLogin, stub: 'echo "401 Unauthorized: refresh token was revoked" >&2; exit 1' }, 'credential_rejected'],
    ['usage limit', { authJson: subscriptionLogin, stub: 'echo "You have hit your usage limit" >&2; exit 1' }, 'usage_limit'],
    ['no usable output', { authJson: subscriptionLogin, stub: 'echo not json > /dev/null; exit 0' }, 'invalid_output'],
    ['output carries the login', { authJson: subscriptionLogin, stub: writeResult('{"verdict":"comment","summary":"refresh-token-value-0123456789","blocking_findings":[]}') }, 'output_leak'],
  ]
  for (const [name, input, reason] of cases) {
    const { run, outputs, leftovers } = runCodexScript(input)
    assert.equal(run.status, 0, `${name}: ${run.stderr}`)
    assert.equal(outputs.ok, 'false', name)
    assert.equal(outputs.reason, reason, name)
    assert.equal(outputs.structured, undefined, name)
    assert.equal(leftovers, false, `${name}: the temp credential directory must be removed`)
    // The only place a token may appear in the log is the ::add-mask:: line that hides it.
    assert.doesNotMatch(run.stdout + run.stderr, /^(?!::add-mask::).*refresh-token-value-0123456789/m, name)
  }
})

test('run-codex-review.sh passes a good review through as structured output', { skip: !(hasJq && hasBash) }, () => {
  const { run, outputs } = runCodexScript({ authJson: subscriptionLogin, stub: writeResult(goodReview) })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(outputs.ok, 'true')
  assert.deepEqual(JSON.parse(outputs.structured), JSON.parse(goodReview))
})
