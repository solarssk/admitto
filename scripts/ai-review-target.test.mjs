import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const workflow = readFileSync(new URL('../.github/workflows/ai-review.yml', import.meta.url), 'utf8')
const step = workflow.split('      - name: Resolve review target\n')[1].split('      # Debounce:')[0]
const script = step.split('        run: |\n')[1].split('\n').map(line => line.replace(/^ {10}/, '')).join('\n')
const sha = 'a'.repeat(40)
const pull = () => ({
  number: 1574, state: 'open', draft: false, user: { login: 'dependabot[bot]' },
  head: { sha, ref: 'dependabot/vite', repo: { full_name: 'maintainer/project' } },
  base: { ref: 'main', repo: { full_name: 'maintainer/project' } },
})

function resolve(target, env = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ai-review-target-'))
  try {
    writeFileSync(join(directory, 'gh'), '#!/bin/sh\ncase "$2" in users/*) printf "%s" "$REQUESTER_ID";; *) printf "%s" "$TARGET_JSON";; esac\n', { mode: 0o755 })
    const output = join(directory, 'output')
    writeFileSync(output, '')
    const run = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, RUNNER_TEMP: directory,
        GITHUB_OUTPUT: output, GITHUB_REPOSITORY: 'maintainer/project', GITHUB_REPOSITORY_OWNER: 'maintainer',
        DEFAULT_BRANCH: 'main', REQUESTED_PR: '1574', EVENT_NAME: 'workflow_dispatch',
        OWNER_ID: '7', REQUESTER_ID: '7', TRIGGERING_ACTOR: 'maintainer',
        TARGET_JSON: JSON.stringify(target), ...env },
    })
    return { status: run.status, stderr: run.stderr, output: readFileSync(output, 'utf8') }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('manual review resolves the current same-repository Dependabot head', () => {
  const result = resolve(pull())
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.output, `pr_number=1574\nhead_sha=${sha}\nhead_ref=dependabot/vite\n`)
})

test('automatic reviews still resolve owner PRs and exclude Dependabot', () => {
  const owner = pull()
  owner.user.login = 'maintainer'
  assert.equal(resolve(owner, { EVENT_NAME: 'pull_request_target' }).status, 0)
  assert.notEqual(resolve(pull(), { EVENT_NAME: 'pull_request_target' }).status, 0)
})

test('invalid targets fail without publishing a review target', () => {
  const cases = [
    target => { target.head.repo.full_name = 'external/fork' },
    target => { target.head.repo = null },
    target => { target.base.repo.full_name = 'external/project' },
    target => { target.base.ref = 'feature/unsafe-base' },
    target => { target.user.login = 'external-contributor' },
    target => { target.state = 'closed' },
    target => { target.draft = true },
    target => { target.number = 1573 },
    target => { target.head.sha = 'invalid\nhead_sha=other' },
  ]
  for (const mutate of cases) {
    const target = pull()
    mutate(target)
    const result = resolve(target)
    assert.notEqual(result.status, 0, JSON.stringify(target))
    assert.equal(result.output, '')
  }
  for (const REQUESTED_PR of ['0', '-1', '1574/../reviews', '1574\nhead_sha=other', '']) {
    const result = resolve(pull(), { REQUESTED_PR })
    assert.notEqual(result.status, 0)
    assert.equal(result.output, '')
  }
})

test('manual dispatch is restricted to the owner and trusted default branch', () => {
  const guard = workflow.split('    if: >-\n')[1].split('    permissions:')[0]
  assert.match(guard, /github\.event_name == 'workflow_dispatch'/)
  assert.match(guard, /github\.actor_id == github\.event\.repository\.owner\.id/)
  assert.match(guard, /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/)
  assert.doesNotMatch(workflow, /ref:.*steps\.target\.outputs\.head/)
  assert.equal((workflow.match(/-f commit_id=/g) ?? []).length, 1)
  for (const env of [{ REQUESTER_ID: '8' }, { TRIGGERING_ACTOR: '../foreign' }]) {
    const result = resolve(pull(), env)
    assert.notEqual(result.status, 0, JSON.stringify({ env, result }))
    assert.equal(result.output, '')
  }
})
