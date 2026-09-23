import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('./check-ci-pii.sh', import.meta.url))

function runGuard(mode, files, untracked = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'admitto-pii-guard-'))
  try {
    const gitInit = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' })
    assert.equal(gitInit.status, 0, gitInit.stderr)

    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(repo, name, '..'), { recursive: true })
      writeFileSync(join(repo, name), content)
    }
    const gitAdd = spawnSync('git', ['add', '--', '.'], { cwd: repo, encoding: 'utf8' })
    assert.equal(gitAdd.status, 0, gitAdd.stderr)

    for (const [name, content] of Object.entries(untracked)) {
      writeFileSync(join(repo, name), content)
    }

    return spawnSync('bash', [script, mode], { cwd: repo, encoding: 'utf8' })
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}

test('email guard blocks a tracked match without logging the address', () => {
  const address = 'person@sample.invalid'
  const result = runGuard('email', { 'data.json': `{"email":"${address}"}` })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Matches are hidden/)
  assert.doesNotMatch(result.stdout + result.stderr, /person@sample\.invalid/)
})

test('email guard keeps test domains and package-lock metadata exempt', () => {
  const result = runGuard('email', {
    'data.json': '{"email":"person@example.com"}',
    'package-lock.json': '{"email":"person@sample.invalid"}',
  }, { 'untracked.json': '{"email":"person@sample.invalid"}' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('phone guard blocks a tracked match without logging the number', () => {
  const number = '+99999999999'
  const result = runGuard('phone', { 'data.yaml': `phone: ${number}` })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Matches are hidden/)
  assert.doesNotMatch(result.stdout + result.stderr, /\+99999999999/)
})

test('phone guard ignores an untracked match', () => {
  const result = runGuard('phone', { 'data.yaml': 'status: ok' }, { 'untracked.yaml': 'phone: +99999999999' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
