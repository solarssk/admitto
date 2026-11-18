import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('./audit-gate.sh', import.meta.url))
const ACCEPTED = 'GHSA-aaaa-bbbb-cccc'

const advisory = (name, id, severity = 'high') => ({
  source: 1,
  name,
  title: `${name} problem`,
  url: `https://github.com/advisories/${id}`,
  severity,
})

function report(vulnerabilities) {
  return { auditReportVersion: 2, vulnerabilities }
}

function runGate(content, accepted = ACCEPTED) {
  const dir = mkdtempSync(join(tmpdir(), 'admitto-audit-gate-'))
  try {
    const file = join(dir, 'report.json')
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
    return spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { ...process.env, AUDIT_REPORT: file, ACCEPTED_ADVISORY: accepted },
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const acceptedOnly = {
  picomatch: { name: 'picomatch', severity: 'high', via: [advisory('picomatch', ACCEPTED)] },
  tinyglobby: { name: 'tinyglobby', severity: 'high', via: ['picomatch'] },
}

test('only the accepted advisory (plus transitive via strings) passes', () => {
  const result = runGate(report(acceptedOnly))
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.doesNotMatch(result.stdout, /::notice::/)
})

test('the accepted advisory plus another high advisory fails and names the other one', () => {
  const result = runGate(
    report({ ...acceptedOnly, other: { name: 'other', severity: 'high', via: [advisory('other', 'GHSA-xxxx-yyyy-zzzz')] } }),
  )
  assert.equal(result.status, 1)
  assert.match(result.stdout, /GHSA-xxxx-yyyy-zzzz/)
  assert.doesNotMatch(result.stdout, /GHSA-aaaa-bbbb-cccc/)
})

test('a critical advisory fails; a moderate one passes', () => {
  const critical = runGate(report({ c: { name: 'c', via: [advisory('c', 'GHSA-1111-2222-3333', 'critical')] } }))
  assert.equal(critical.status, 1)
  const moderate = runGate(report({ m: { name: 'm', via: [advisory('m', 'GHSA-1111-2222-3333', 'moderate')] } }))
  assert.equal(moderate.status, 0)
})

test('an id that only shares a suffix with the accepted one is not accepted', () => {
  const result = runGate(report({ x: { name: 'x', via: [advisory('x', `GHSA-zzzz-${ACCEPTED}`)] } }))
  assert.equal(result.status, 1)
})

test('a report without a vulnerabilities key fails', () => {
  assert.equal(runGate({ error: { code: 'ENOAUDIT' } }).status, 1)
  assert.equal(runGate('not json').status, 1)
})

test('an accepted advisory that disappeared passes with a removal notice', () => {
  const result = runGate(report({}))
  assert.equal(result.status, 0)
  assert.match(result.stdout, /::notice::GHSA-aaaa-bbbb-cccc is gone/)
})
