import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('./wait-for-release-ci.sh', import.meta.url))

function runWithCiResult(result) {
  const bin = mkdtempSync(join(tmpdir(), 'admitto-release-ci-'))
  try {
    const mockGh = join(bin, 'gh')
    writeFileSync(mockGh, '#!/bin/sh\nprintf "%s\\n" "$MOCK_CI_RESULT"\n')
    chmodSync(mockGh, 0o755)
    return spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        GITHUB_REPOSITORY: 'solarssk/admitto',
        GITHUB_SHA: 'a'.repeat(40),
        CI_WAIT_ATTEMPTS: '2',
        CI_WAIT_INTERVAL: '0',
        MOCK_CI_RESULT: result,
      },
    })
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
}

test('release waits for a successful CI result', () => {
  const result = runWithCiResult('success')
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('release refuses a failed CI result', () => {
  const result = runWithCiResult('failure')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /refusing to create a release tag/)
})

test('release fails closed when CI never completes', () => {
  const result = runWithCiResult('pending')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Timed out waiting for CI/)
})
