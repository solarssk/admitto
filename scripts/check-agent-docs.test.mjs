import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { BUDGETS, checkAgentDocs, slug } from './check-agent-docs.mjs'

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'admitto-agent-docs-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  return root
}

function check(files) {
  const root = repo(files)
  try {
    return checkAgentDocs(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const good = {
  'AGENTS.md': '# Rules\n\nSee [loading](standards/admin-spa/loading.md#the-standard) and [index](standards/README.md).\n',
  'CLAUDE.md': '@AGENTS.md\n',
  'standards/README.md': '# Standards\n\n- [admin](admin-spa/README.md)\n',
  'standards/admin-spa/README.md': '# Admin\n\n- [loading](loading.md)\n',
  'standards/admin-spa/loading.md': '# Loading\n\n## The standard\n\ntext\n',
}

test('a consistent set passes', () => {
  assert.deepEqual(check(good), [])
})

test('slug follows GitHub heading anchors', () => {
  assert.equal(slug('Admin SPA feedback (toast vs inline)'), 'admin-spa-feedback-toast-vs-inline')
  assert.equal(slug('Use `Button loading`'), 'use-button-loading')
})

test('an oversized root file is reported', () => {
  const problems = check({ ...good, 'AGENTS.md': good['AGENTS.md'] + 'x'.repeat(BUDGETS.root) })
  assert.equal(problems.length, 1)
  assert.match(problems[0], new RegExp(`AGENTS\\.md is \\d+ bytes, over its ${BUDGETS.root} byte budget`))
})

test('a nested AGENTS.md has the smaller budget', () => {
  const problems = check({ ...good, 'apps/admin/AGENTS.md': 'x'.repeat(BUDGETS.nested + 1) })
  assert.match(problems.join('\n'), /apps\/admin\/AGENTS\.md is/)
})

test('a broken file link and a broken anchor are reported', () => {
  const problems = check({ ...good, 'AGENTS.md': '[a](standards/missing.md) [b](standards/README.md#nope)\n' })
  assert.equal(problems.length, 2)
  assert.match(problems[0], /does not resolve/)
  assert.match(problems[1], /heading that does not exist/)
})

test('links inside code spans and fences, and external links, are ignored', () => {
  const text = '`[x](nope.md)`\n\n```\n[y](nope.md)\n```\n\n[z](https://example.com/a.md)\n[idx](standards/README.md)\n'
  assert.deepEqual(check({ ...good, 'AGENTS.md': text }), [])
})

test('a standards file that no index lists is reported', () => {
  const problems = check({ ...good, 'standards/orphan.md': '# Orphan\n' })
  assert.deepEqual(problems, ['standards/orphan.md is not listed in standards/README.md.'])
})
