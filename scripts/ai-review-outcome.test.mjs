import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { classifyClaudeReview } from './ai-review-outcome.mjs'

const valid = JSON.stringify({
  verdict: 'comment', summary: 'Found a real defect.',
  blocking_findings: [{ file: 'src/a.ts', issue: 'The check is missing.' }],
})
const emptyError = { type: 'result', subtype: 'success', is_error: true,
  num_turns: 1, total_cost_usd: 0, modelUsage: {} }

function classify(events) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-review-outcome-'))
  try {
    const executionFile = join(dir, 'result.json')
    writeFileSync(executionFile, typeof events === 'string' ? events : JSON.stringify(events))
    return classifyClaudeReview({ outcome: 'failure', executionFile })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('valid approval and findings are completed reviews', () => {
  for (const structured of [valid, JSON.stringify({verdict: 'approve', summary: 'Reviewed.', blocking_findings: []})]) {
    assert.deepEqual(classifyClaudeReview({ outcome: 'success', structured }), { status: 'reviewed', reason: '' })
  }
})
test('missing credential is unavailable without running Claude', () => {
  assert.deepEqual(classifyClaudeReview({ credentialPresent: 'false' }), {status: 'unavailable', reason: 'not_configured'})
})
test('typed provider failures are unavailable but configuration errors take precedence', () => {
  for (const error of ['authentication_failed', 'rate_limit', 'overloaded', 'server_error']) {
    assert.equal(classify([{type: 'assistant', error}, emptyError]).reason, error)
    assert.equal(classify([{type: 'assistant', error}, {type: 'assistant', error: 'invalid_request'}, emptyError]).status, 'error')
  }
})
test('provider-named legacy errors are unavailable, GitHub failures stay red', () => {
  for (const subtype of ['success', 'error_during_execution']) {
    for (const [detail, reason] of [['OAuth token expired', 'authentication'], ['Claude usage limit reached', 'usage_limit'], ['Claude service unavailable (503)', 'provider_service']]) {
      assert.equal(classify([{type: 'result', subtype, is_error: true, errors: [detail]}]).reason, reason)
    }
  }
  assert.equal(classify([{...emptyError, errors: ['GitHub API rate limit']}]).status, 'error')
})
test('the observed empty pre-model error is unavailable without guessing its cause', () => {
  assert.deepEqual(classify([emptyError]), {status: 'unavailable', reason: 'no_model_response'})
  assert.equal(classify(JSON.stringify({type: 'system'}) + '\n' + JSON.stringify(emptyError)).status, 'unavailable')
})
test('missing evidence, actual model usage, schema and turn errors stay red', () => {
  for (const patch of [{total_cost_usd: undefined}, {modelUsage: undefined}, {num_turns: 2}, {total_cost_usd: 0.1}, {modelUsage: {model: {}}}, {result: 'Schema validation failed'}, {subtype: 'error_max_turns'}, {subtype: 'error_max_structured_output_retries'}, {is_error: false}]) {
    assert.equal(classify([{...emptyError, ...patch}]).status, 'error', JSON.stringify(patch))
  }
  assert.equal(classifyClaudeReview({outcome: 'failure'}).status, 'error')
  assert.equal(classify('not JSON').status, 'error')
  for (const structured of ['{', 'null', JSON.stringify({verdict: 'approve', summary: 'ok', blocking_findings: [null]})]) {
    assert.equal(classifyClaudeReview({outcome: 'success', structured}).status, 'error')
  }
})

const workflow = readFileSync(new URL('../.github/workflows/ai-review.yml', import.meta.url), 'utf8')
const submit = workflow.split('      - name: Submit the review\n')[1].split('        run: |\n')[1]
  .split('\n').map((line) => line.slice(10)).join('\n')

function publish(overrides = {}, stale = false) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-review-submit-'))
  try {
    writeFileSync(join(dir, 'gh'), `#!/bin/bash\nif [[ "$*" == *'--jq .head.sha'* ]]; then echo '${stale ? 'new' : 'head'}'; exit 0; fi\nif [[ "$*" == *'--paginate'* ]]; then echo 123; exit 0; fi\necho "$*" >> "$CALLS"\n`, {mode: 0o755})
    const run = spawnSync('bash', ['-c', submit], {encoding: 'utf8', env: {
      PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: join(dir, 'summary'),
      GITHUB_REPOSITORY: 'example/repo', PR_NUMBER: '1', HEAD_SHA: 'head', CALLS: join(dir, 'calls'),
      CLAUDE_STATUS: 'unavailable', CLAUDE_REASON: 'no_model_response', BUDGET_REASON: 'budget exhausted', ...overrides,
    }})
    let calls = ''
    try { calls = readFileSync(join(dir, 'calls'), 'utf8') } catch { /* No writes for a stale result. */ }
    let body = ''
    try { body = readFileSync(join(dir, 'review.md'), 'utf8') } catch { /* Failure before publication. */ }
    return {run, calls, body}
  } finally { rmSync(dir, {recursive: true, force: true}) }
}
test('provider unavailability publishes one policy APPROVE with an explicit manual-review warning', () => {
  const {run, calls, body} = publish()
  assert.equal(run.status, 0, run.stderr)
  assert.doesNotMatch(calls, /dismissals/)
  assert.equal((calls.match(/-X POST/g) ?? []).length, 1)
  assert.match(calls, /event=APPROVE/)
  assert.match(body, /no AI code review ran/)
  assert.match(body, /review the diff manually before merging/)
})
test('review findings comment, clean reviews approve, own errors fail and stale results write nothing', () => {
  const findings = publish({CLAUDE_STATUS: 'reviewed', STRUCTURED: valid})
  assert.equal(findings.run.status, 0, findings.run.stderr)
  assert.match(findings.calls, /event=COMMENT/)
  const approved = publish({CLAUDE_STATUS: 'reviewed', STRUCTURED: JSON.stringify({verdict: 'approve', summary: 'Reviewed.', blocking_findings: []})})
  assert.equal(approved.run.status, 0, approved.run.stderr)
  assert.match(approved.calls, /event=APPROVE/)
  const failed = publish({CLAUDE_STATUS: 'error'})
  assert.equal(failed.run.status, 1)
  assert.doesNotMatch(failed.calls, /-X POST/)
  assert.equal(publish({}, true).calls, '')
})
test('path and budget policy approvals keep diff completeness and size guards', () => {
  assert.match(publish({DOCS_ONLY: 'true'}).calls, /event=APPROVE/)
  assert.match(publish({TOO_LARGE: 'true'}).calls, /event=COMMENT/)
  const budget = publish({BUDGET_EXHAUSTED: 'true', BUDGET_REASON: 'budget exhausted'})
  assert.equal(budget.run.status, 0, budget.run.stderr)
  assert.match(budget.calls, /event=APPROVE/)
  assert.match(budget.body, /budget was exhausted/)
  assert.match(budget.body, /no AI code review ran/)
  for (const overrides of [{UNAVAILABLE: 'true'}, {BUDGET_EXHAUSTED: 'true', UNAVAILABLE: 'true'}, {BUDGET_EXHAUSTED: 'true', TOO_LARGE: 'true'}]) {
    const incomplete = publish(overrides)
    assert.equal(incomplete.run.status, 0, incomplete.run.stderr)
    assert.match(incomplete.calls, /event=COMMENT/)
    assert.match(incomplete.calls, /dismissals/)
  }
})
test('the live workflow keeps fork protection and a single publisher without Codex credentials', () => {
  assert.match(workflow, /head\.repo\.full_name == github\.repository/)
  assert.match(workflow, /user\.login == github\.repository_owner/)
  assert.match(workflow, /continue-on-error: true/)
  assert.match(workflow, /if: steps\.claude_credential\.outputs\.present == 'true'/)
  assert.match(workflow, /CLAUDE_CREDENTIAL_PRESENT: \$\{\{ steps\.claude_credential\.outputs\.present \}\}/)
  assert.equal((workflow.match(/-f commit_id=/g) ?? []).length, 1)
  assert.doesNotMatch(workflow, /CODEX_AUTH_JSON|CODEX_CACHE_KEY|OPENAI_API_KEY|actions\/cache\//)
})
