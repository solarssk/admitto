import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readExecutionEvents } from './ai-review-outcome.mjs'

// One comment per pull request says what the AI review did to the current commit: which commit,
// which model, how much of the diff it read, where the attempt budget stands and, when a run did
// not finish, what to do about it. The verdict and the findings stay a GitHub review; this comment
// carries no model prose, only facts read from the workflow and from the tool calls in the
// execution log. It is edited in place and found by a hidden marker.

export const STATUS_MARKER = '<!-- admitto-ai-review-status -->'

const BOT_LOGIN = 'github-actions[bot]'
const DIFF_PATH = '.ai-review/pr.diff'
// The pattern the review step applies before it posts anything: this repository is public and the
// reviewer's process holds a credential, so text that looks like one is never posted.
export const CREDENTIAL = /sk-ant-|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|-----BEGIN/

const STATES = {
  reviewing: ['⏳', 'reviewing'],
  approved: ['✅', 'approved'],
  findings: ['💬', 'comments, not approved'],
  'docs-only': ['✅', 'approved by a path rule, no model review'],
  'too-large': ['⏭️', 'skipped, the diff is too large'],
  unreadable: ['⚠️', 'not approved, a changed file has no readable diff'],
  budget: ['⚠️', 'policy approval, budget used up, no AI review ran'],
  'no-provider': ['⚠️', 'policy approval, no AI review completed'],
  'codex-clean': ['✅', 'approved through the Codex fallback'],
  'codex-findings': ['💬', 'Codex reported findings, not approved'],
  failed: ['❌', 'failed, nothing approved'],
  'codex-error': ['❌', 'Codex fallback failed, nothing approved'],
  withheld: ['❌', 'result withheld, nothing approved'],
  stale: ['⏭️', 'superseded by a newer commit'],
  cancelled: ['⏹️', 'cancelled by the maintainer'],
}

export async function githubRequest(token, method, path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw Object.assign(new Error(`GitHub ${method} ${path} failed with ${response.status}`), { status: response.status })
  const text = await response.text()
  return text ? JSON.parse(text) : {}
}

// `request` is injectable so tests can stand in for GitHub.
export function createApi(token, request = githubRequest) {
  const call = (method) => (path, body) => request(token, method, path, body)
  return {
    get: call('GET'),
    post: call('POST'),
    patch: call('PATCH'),
    put: call('PUT'),
    // `key` names the array inside an object answer (workflow runs come as { workflow_runs: [] }).
    async list(path, key) {
      const results = []
      for (let page = 1; page <= 20; page++) {
        const data = await request(token, 'GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
        const items = key ? data?.[key] : data
        if (!Array.isArray(items)) throw new Error(`GitHub list ${path} is not a list`)
        results.push(...items)
        if (items.length < 100) return results
      }
      throw new Error(`GitHub list ${path} is longer than 20 pages`)
    },
  }
}

export function checkTarget(repository, number) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[1-9]\d*$/.test(String(number ?? ''))) {
    throw new Error('Invalid pull request reference')
  }
}

// `comments` is the pull request's comment list when the caller has it already.
export async function findComment(api, { repository, number, marker, comments }) {
  checkTarget(repository, number)
  const all = comments ?? await api.list(`/repos/${repository}/issues/${number}/comments`)
  return all.find((comment) => comment.user?.login === BOT_LOGIN &&
    typeof comment.body === 'string' && comment.body.includes(marker))
}

export async function upsertComment(api, { repository, number, marker, body, comments }) {
  const existing = await findComment(api, { repository, number, marker, comments })
  return existing
    ? api.patch(`/repos/${repository}/issues/comments/${existing.id}`, { body })
    : api.post(`/repos/${repository}/issues/${number}/comments`, { body })
}

function mergeRanges(ranges) {
  const merged = []
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1)
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to)
    else merged.push([from, to])
  }
  return merged
}

// The tools the review workflow offers on purpose; a call to anything else is reported. The last
// one is no way to look at the diff: it is how the answer is delivered when a JSON schema is given.
const REVIEW_TOOLS = new Set(['Read', 'Grep', 'Glob', 'StructuredOutput'])

const textOf = (content) => (Array.isArray(content) ? content.map((part) => part?.text ?? '').join('\n') : String(content ?? ''))

// The workspace-relative path of a file the reviewer named, or null when it is missing or outside.
function insideOf(workspace, path) {
  if (typeof path !== 'string' || path === '') return null
  const inside = relative(workspace, resolve(workspace, path))
  return inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside) ? null : inside
}

// The first and last line numbers in the text of a Read result (`cat -n` style, a tab or an arrow
// after the number).
function returnedRange(content) {
  const numbers = textOf(content).split('\n').flatMap((line) => {
    const match = /^\s*(\d+)[\t→]/.exec(line)
    return match ? [Number(match[1])] : []
  })
  return numbers.length > 0 ? [Math.min(...numbers), Math.max(...numbers)] : null
}

// The lines a Read returned. The tool's own structured result comes first (startLine and numLines
// are exact even when a big file was cut to its first page); the numbered text is the fallback.
function readRange(result, structured) {
  const file = structured?.file
  if (Number.isInteger(file?.startLine) && Number.isInteger(file?.numLines) && file.numLines > 0) {
    return [file.startLine, file.startLine + file.numLines - 1]
  }
  return returnedRange(result.content)
}

// The diff lines a content-mode search printed: `N:text` for a match and `N-text` for context, with
// the file name in front when the search covered more than the diff.
function grepLineNumbers(text, workspace, bare) {
  const prefixes = [DIFF_PATH, `./${DIFF_PATH}`, join(workspace, DIFF_PATH)]
  const numbers = []
  for (const line of text.split('\n')) {
    const prefix = bare ? '' : prefixes.find((candidate) => line.startsWith(candidate))
    const match = prefix === undefined ? null : /^[:-]?(\d+)[:-]/.exec(line.slice(prefix.length))
    if (match) numbers.push(Number(match[1]))
  }
  return numbers
}

// The totals of a finished session. The result lists every model that billed tokens, so a helper
// model shows up there even when the main one is the only one named elsewhere.
function noteTotals(run, entry) {
  if (Number.isFinite(entry.num_turns)) run.turns = entry.num_turns
  if (Number.isFinite(entry.duration_ms)) run.durationMs = entry.duration_ms
  if (entry.modelUsage && typeof entry.modelUsage === 'object') run.models = Object.keys(entry.modelUsage)
}

// The first event of a session names its model and every tool it was offered.
function noteInit(run, entry) {
  if (typeof entry.model === 'string') run.model = entry.model
  if (Array.isArray(entry.tools)) run.offered = entry.tools.filter((name) => typeof name === 'string')
}

// The model, the tools on offer and the totals, from the events that carry them.
function noteEvent(run, entry) {
  if (entry.type === 'system' && entry.subtype === 'init') noteInit(run, entry)
  else if (entry.type === 'assistant' && !run.model && typeof entry.message?.model === 'string') run.model = entry.message.model
  else if (entry.type === 'result') noteTotals(run, entry)
}

// A tool call, counted by name, and whether it ran inside a subagent.
function noteCall(run, block, nested) {
  const name = typeof block.name === 'string' ? block.name : 'unknown'
  const entry = run.tools.get(name) ?? { calls: 0, failed: 0, nested: 0 }
  entry.calls++
  if (nested) entry.nested++
  run.tools.set(name, entry)
  return { name, input: block.input, nested }
}

function noteRead(run, workspace, call, result, structured) {
  const inside = insideOf(workspace, call.input?.file_path)
  if (inside === null) run.outside++
  else if (inside === DIFF_PATH) {
    const range = readRange(result, structured)
    if (range) run.ranges.push(range)
    else run.unmeasured++
  } else if (!inside.startsWith('.ai-review/')) run.opened.add(inside)
}

function noteGrep(run, workspace, call, result, structured) {
  if (call.input?.output_mode !== 'content') return
  const onDiff = insideOf(workspace, call.input.path) === DIFF_PATH
  const text = typeof structured?.content === 'string' ? structured.content : textOf(result.content)
  const numbers = grepLineNumbers(text, workspace, onDiff)
  for (const line of numbers) run.ranges.push([line, line])
  if (onDiff && numbers.length === 0 && text.trim() !== '') run.unmeasured++
}

// One finished tool call. A call that ran inside a subagent only counts as a call: what the
// subagent read is not what the reviewer itself was shown.
function noteResult(run, workspace, call, result, structured) {
  run.results++
  if (result.is_error) run.tools.get(call.name).failed++
  else if (call.nested) return
  else if (call.name === 'Read') noteRead(run, workspace, call, result, structured)
  else if (call.name === 'Grep') noteGrep(run, workspace, call, result, structured)
}

// The tool's own structured result, only from a message that holds a single tool result.
function structuredResult(event, blocks) {
  const results = blocks.filter((block) => block?.type === 'tool_result')
  return results.length === 1 ? (event.tool_use_result ?? event.toolUseResult) : undefined
}

// One content block: a tool call is remembered, a tool result is noted.
function noteBlock(run, workspace, calls, block, event, structured) {
  if (block?.type === 'tool_use' && typeof block.id === 'string') {
    if (!calls.has(block.id)) calls.set(block.id, noteCall(run, block, Boolean(event.parent_tool_use_id)))
    return
  }
  if (block?.type !== 'tool_result') return
  const call = calls.get(block.tool_use_id)
  if (call) noteResult(run, workspace, call, block, structured)
  else run.unmatched++
}

function noteBlocks(run, workspace, calls, event) {
  const blocks = Array.isArray(event.message?.content) ? event.message.content : []
  const structured = structuredResult(event, blocks)
  for (const block of blocks) noteBlock(run, workspace, calls, block, event, structured)
}

// What the model did, read from the tool calls in the execution log: the model, the turns, the
// lines of the diff it was shown, the other files it opened and every tool it called. Nothing here
// is the model's own claim: only the events themselves and the content blocks of their messages
// are read, because a tool call's input and a structured answer are written by the model, and an
// object nested in them could otherwise pose as a tool result.
export function summarizeExecution(events, workspace) {
  const calls = new Map()
  const run = { model: '', models: [], offered: [], turns: null, durationMs: null, ranges: [], opened: new Set(), outside: 0,
    results: 0, unmatched: 0, unmeasured: 0, tools: new Map() }
  for (const event of Array.isArray(events) ? events : [events]) {
    if (!event || typeof event !== 'object') continue
    noteEvent(run, event)
    noteBlocks(run, workspace, calls, event)
  }
  const tools = [...run.tools].map(([name, entry]) => ({ name, ...entry })).sort((a, b) => a.name.localeCompare(b.name, 'en'))
  const otherTools = tools.filter((tool) => !REVIEW_TOOLS.has(tool.name))
  // What a subagent, Bash, an unreadable result or a result with no call behind it showed the
  // reviewer cannot be counted here.
  const unmeasurable = otherTools.length > 0 || tools.some((tool) => tool.nested > 0) || run.unmeasured > 0 || run.unmatched > 0
  const otherModels = run.models.filter((model) => model !== run.model).sort((a, b) => a.localeCompare(b, 'en'))
  const offeredExtra = [...new Set(run.offered)].filter((name) => !REVIEW_TOOLS.has(name)).sort((a, b) => a.localeCompare(b, 'en'))
  return { ...run, tools, otherTools, otherModels, offeredExtra, unmeasurable, ranges: mergeRanges(run.ranges),
    opened: [...run.opened].sort((a, b) => a.localeCompare(b, 'en')) }
}

// A name from the log (an event kind, a block kind, a tool) is printed only when it is a short plain
// identifier, so nothing the model wrote can reach the job log through the shape report below.
const identifier = (value) => (typeof value === 'string' && /^[\w./-]{1,48}$/.test(value) ? value : '?')

const tally = (counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1)

function tallied(counts) {
  const entries = [...counts].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, count]) => `${key} ${count}`)
  return entries.length === 0 ? 'none' : entries.slice(0, 20).join(', ')
}

function offeredTools(names) {
  if (names === null) return 'not in the log'
  const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'en'))
  const shown = sorted.slice(0, 40).join(', ')
  return sorted.length > 40 ? `${shown} and ${sorted.length - 40} more` : shown
}

function noteShape(shape, event) {
  tally(shape.kinds, event.subtype ? `${identifier(event.type)}/${identifier(event.subtype)}` : identifier(event.type))
  if (event.parent_tool_use_id) shape.subagent++
  if (event.type === 'system' && event.subtype === 'init' && Array.isArray(event.tools)) shape.offered = event.tools.map(identifier)
  const blocks = Array.isArray(event.message?.content) ? event.message.content : []
  for (const block of blocks) tally(shape.blocks, identifier(block?.type))
  if (blocks.some((block) => block?.type === 'tool_result')) {
    shape.carriers++
    if (event.tool_use_result ?? event.toolUseResult) shape.structured++
  }
}

// The shape of the execution log without any of its content: how many events and content blocks of
// each kind it holds, how many tool results come with the tool's structured answer, how many events
// belong to a subagent and which tools the session offered. The coverage figure is only as good as
// the reading of this shape, so the job log shows it for the maintainer to check against.
export function describeShape(events) {
  const shape = { kinds: new Map(), blocks: new Map(), carriers: 0, structured: 0, subagent: 0, offered: null }
  for (const event of Array.isArray(events) ? events : [events]) {
    if (event && typeof event === 'object') noteShape(shape, event)
  }
  return [
    `events: ${tallied(shape.kinds)}`,
    `content blocks: ${tallied(shape.blocks)}`,
    `events with a tool result: ${shape.carriers}, of which with the tool's structured answer: ${shape.structured}`,
    `events that belong to a subagent: ${shape.subagent}`,
    `tools offered at the start: ${offeredTools(shape.offered)}`,
  ]
}

// The file sections of pr.diff as 1-based line ranges. A patch line always starts with a space, +,
// - or @, so a line that starts with "diff --git" is always a file header.
export function diffSections(diffText) {
  const lines = diffText.split('\n')
  const starts = lines.flatMap((line, index) => {
    const split = line.startsWith('diff --git a/') ? line.lastIndexOf(' b/') : -1
    return split > 0 ? [{ file: line.slice(split + 3), start: index + 1 }] : []
  })
  return starts.map((section, index) => {
    let end = (starts[index + 1]?.start ?? lines.length + 1) - 1
    while (end > section.start && lines[end - 1].trim() === '') end--
    return { ...section, end, unavailable: lines[section.start]?.startsWith('UNAVAILABLE:') ?? false }
  })
}

export function diffCoverage(sections, ranges) {
  const files = sections.filter((section) => !section.unavailable).map((section) => {
    const total = section.end - section.start + 1
    const covered = ranges.reduce((sum, [from, to]) =>
      sum + Math.max(0, Math.min(to, section.end) - Math.max(from, section.start) + 1), 0)
    return { file: section.file, total, covered }
  })
  const total = files.reduce((sum, file) => sum + file.total, 0)
  const covered = files.reduce((sum, file) => sum + file.covered, 0)
  return { files, total, covered, complete: files.filter((file) => file.covered === file.total).length }
}

// A killed step leaves no execution file, which looks like any other setup failure, so a failure
// that took as long as the step's limit is called a timeout.
export function reviewTimedOut({ outcome, startedAt, now, timeoutMinutes }) {
  if (!outcome || outcome === 'success' || outcome === 'skipped' || !startedAt || !timeoutMinutes) return false
  return now - startedAt >= timeoutMinutes * 60 - 15
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
const shortSha = (sha) => (/^[a-f0-9]{40}$/.test(sha ?? '') ? sha.slice(0, 7) : '')
const stamp = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
const percent = (part, whole) => (whole > 0 ? Math.floor((part / whole) * 100) : 0)

// Text that came from a tool call or the API is shown only inside a code span, stripped of
// anything that could end the span or break a table.
function code(text) {
  const clean = String(text ?? '').replace(/[\p{Cc}`|]/gu, ' ').trim()
  const shown = clean.length > 100 ? `${clean.slice(0, 99)}…` : clean
  return `\`${shown}\``
}

function plain(text) {
  return String(text ?? '').replace(/[\p{Cc}`|]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}

function duration(ms) {
  const seconds = Math.round(ms / 1000)
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`
}

function providerAdvice(reason = '') {
  if (/auth|oauth_org|cloud_credential/.test(reason)) {
    return ['the login was rejected', 'Run `claude setup-token` and replace the `CLAUDE_CODE_OAUTH_TOKEN` secret.']
  }
  if (/usage|rate_limit|billing|no_model_response/.test(reason)) {
    return ['a usage limit, or no model response', 'Wait until the limit resets; a new token does not reset it.']
  }
  if (/account_on_hold|verification/.test(reason)) {
    return ['the account needs attention', 'Resolve it in the Claude account.']
  }
  if (reason === 'not_configured') {
    return ['no login is configured', 'Run `claude setup-token` and add the `CLAUDE_CODE_OAUTH_TOKEN` secret.']
  }
  return ['a service problem', 'This usually passes within minutes.']
}

const again = (f) => (f.trigger === 'workflow_dispatch'
  ? 'start **Actions, AI review, Run workflow** with this PR number'
  : 'comment `/ai-review`')

function commitCell(f) {
  const head = shortSha(f.head)
  if (!head) return ''
  const link = `[\`${head}\`](${f.server}/${f.repository}/commit/${f.head})`
  const base = shortSha(f.base)
  if (!base) return link
  return f.baseRef ? `${link} on ${code(f.baseRef)} (\`${base}\`)` : `${link} on base \`${base}\``
}

function changesCell(f) {
  if (!f.files) return ''
  const { count, additions, deletions, excluded } = f.files
  const size = `${plural(count, 'file')}, +${additions} -${deletions}`
  return excluded.length > 0 ? `${size}; lockfiles left out: ${excluded.map(code).join(', ')}` : size
}

function reviewerCell(f) {
  const helpers = f.log?.otherModels?.length > 0 ? `also ${f.log.otherModels.map(code).join(', ')}` : ''
  const claude = ['Claude', f.log?.model && code(f.log.model), helpers, f.log?.turns != null && plural(f.log.turns, 'turn'),
    f.log?.durationMs != null && duration(f.log.durationMs)].filter(Boolean).join(', ')
  const unavailable = `Claude unavailable (${code(f.claudeReason || 'unknown')})`
  switch (f.state) {
    case 'docs-only': return 'none, approved by a path rule'
    case 'too-large': return 'none, no model ran'
    case 'budget': return 'none, the budget was used up'
    case 'no-provider': return `${unavailable}; Codex fallback: ${code(f.codexReason || 'not run')}`
    case 'codex-clean':
    case 'codex-findings': return `${unavailable}; the Codex connector reviewed this commit`
    case 'codex-error': return `${unavailable}; Codex fallback error (${code(f.codexReason || 'unknown')})`
    case 'failed':
      if (f.detail === 'timeout') return 'Claude, did not finish in time'
      return f.detail && f.detail !== 'publication_error' ? `Claude returned no usable review (${code(f.detail)})` : claude
    case 'reviewing': return 'Claude, running now'
    case 'stale':
    case 'cancelled':
    case 'withheld': return ''
    default: return claude
  }
}

function coverageCell(f) {
  if (!f.log) return ''
  if (f.coverage === 'unknown') {
    return f.log.unmatched > 0
      ? `not available, ${plural(f.log.unmatched, 'tool result')} in the execution log could not be matched to a tool call`
      : 'not available, the execution log has no tool results'
  }
  const lead = f.coverage?.atLeast ? 'saw at least' : 'saw'
  const read = f.coverage
    ? `${lead} ${f.coverage.covered.toLocaleString('en-US')} of ${f.coverage.total.toLocaleString('en-US')} diff lines (${percent(f.coverage.covered, f.coverage.total)}%), ` +
      `${f.coverage.complete} of ${plural(f.coverage.files.length, 'file')} in full`
    : ''
  const opened = f.log.opened.length > 0 ? `${plural(f.log.opened.length, 'base-branch file')} opened` : ''
  return [read, opened].filter(Boolean).join('; ')
}

const failedNote = (tool) => (tool.failed > 0 ? ` (${tool.failed} failed)` : '')

function toolsCell(f) {
  if (!f.log || f.log.tools.length === 0) return ''
  const used = f.log.tools.map((tool) => `${code(tool.name)} ${tool.calls}${failedNote(tool)}`).join(', ')
  const nested = f.log.tools.reduce((sum, tool) => sum + tool.nested, 0)
  return nested > 0 ? `${used}; ${plural(nested, 'call')} ran inside a subagent` : used
}

function runCell(f) {
  if (!f.runId) return ''
  return `[run ${f.runId}](${f.server}/${f.repository}/actions/runs/${f.runId}), attempt ${f.attempt ?? 1}`
}

function budgetCell(f) {
  if (f.attempt > 1) return 'not counted, this is a manual re-run'
  if (f.prRuns == null || f.dayRuns == null) return ''
  return `earlier attempts: this PR ${f.prRuns} of ${f.perPrLimit}, today ${f.dayRuns} of ${f.dailyLimit}`
}

function resultLink(f) {
  const anchor = f.codexResultKind === 'review' ? 'pullrequestreview' : 'issuecomment'
  return /^\d+$/.test(f.codexResultId ?? '')
    ? `[the connector result](${f.server}/${f.repository}/pull/${f.number}#${anchor}-${f.codexResultId})`
    : 'the connector result'
}

function outcomeLines(f) {
  const retry = again(f)
  const withdrawn = 'Nothing was approved, and an earlier approval of this commit was withdrawn.'
  switch (f.state) {
    case 'reviewing':
      return [`The reviewer is reading the diff. This comment updates when it finishes, and the run stops itself after ${f.timeoutMinutes ?? 15} minutes. If it looks stuck, ${retry}.`]
    case 'approved':
      return ['Verdict: approve, no blocking findings. The review itself is posted on this commit as a GitHub review.']
    case 'findings': {
      const where = f.findingFiles?.length > 0 ? ` in ${f.findingFiles.map(code).join(', ')}` : ''
      return [`${plural(f.findingCount ?? 0, 'blocking finding')}${where}. The details are in the review posted on this commit. Nothing is approved.`]
    }
    case 'docs-only':
      return ['Every changed file is documentation (Markdown under `docs/` or `CHANGELOG.md`), so no model reviewed it. Required checks still apply.']
    case 'too-large':
      return ['The diff is larger than the automated reviewer accepts, so nothing was approved. Split the PR or review it by hand.']
    case 'unreadable':
      return ['GitHub sent no readable diff for at least one changed file, so nothing was approved. Review that file by hand.']
    case 'budget': {
      const why = f.detail ? ` (${plain(f.detail)})` : ''
      return [`The automated review budget was used up${why}. GitHub counts the approval as a full one, but no AI read this code, so review the diff yourself before merging. To run a real review anyway, ${retry}; that bypasses the budget.`]
    }
    case 'no-provider': {
      const [what, fix] = providerAdvice(f.claudeReason)
      return [`Claude was unavailable (${what}) and the Codex fallback gave no usable result. GitHub counts the approval as a full one, but no AI read this code, so review the diff yourself before merging.`,
        `**What to do:** ${fix} Then ${retry}.`]
    }
    case 'codex-clean':
      return [`Claude was unavailable. The Codex connector reviewed this exact commit and reported no major issues: ${resultLink(f)}. That is a narrower check than a full review.`]
    case 'codex-findings':
      return [`Claude was unavailable. The Codex connector reported findings for this commit: ${resultLink(f)}. Nothing is approved; address them before merging.`]
    case 'codex-error': {
      const [, fix] = providerAdvice(f.claudeReason)
      return [`Claude was unavailable and the Codex fallback failed (${code(f.codexReason || 'unknown')}). ${withdrawn}`,
        `**What to do:** ${fix} Then ${retry}.`]
    }
    case 'failed': {
      if (f.detail === 'timeout') {
        return [`The reviewer did not finish within ${f.timeoutMinutes ?? 15} minutes and was stopped. ${withdrawn}`, `**What to do:** ${retry}.`]
      }
      if (f.detail === 'publication_error') {
        return ['The review could not be published because a GitHub request failed, so this run posted nothing new. Check the reviews on this pull request for what still stands.', `**What to do:** ${retry}.`]
      }
      return [`Claude did not return a usable review (${code(f.detail || 'unknown')}), and no provider outage was confirmed, so this is a CI problem and not a quota or login problem. ${withdrawn}`,
        `**What to do:** ${retry}. If it fails again, open the run log.`]
    }
    case 'withheld':
      return [`The result looked like it contained a credential, so it was not posted. ${withdrawn}`, `**What to do:** open the run log, then ${retry}.`]
    case 'stale':
      return ['The pull request changed while this review ran (a new commit, a new base, or it was closed), so nothing was submitted for this commit. A new commit or a new base starts its own review.']
    case 'cancelled':
      return ['The review was cancelled with `/ai-review cancel`, and any approval of this commit was withdrawn.', `**What to do:** ${retry}.`]
    default:
      return ['The review ended in a state this comment does not know. Open the run log.']
  }
}

function details(summary, items) {
  return ['', '<details>', `<summary>${summary}</summary>`, '', ...items.map((item) => `- ${item}`), '', '</details>']
}

// An approval from a reviewer that did not see the whole diff says little about the rest of it.
function coverageWarning(f) {
  const c = f.coverage
  if (f.state !== 'approved' || !c || c === 'unknown' || c.covered >= c.total) return []
  const seen = `${c.covered.toLocaleString('en-US')} of ${c.total.toLocaleString('en-US')} diff lines`
  if (c.atLeast) return ['', `⚠️ The reviewer's own reads cover ${seen}. The rest may have been seen through the other tools it used, which cannot be counted, or not at all: treat this approval accordingly.`]
  const unread = plural(c.files.length - c.complete, 'file')
  return ['', `⚠️ The reviewer saw ${seen} (${percent(c.covered, c.total)}%), so this approval says little about the ${unread} it did not read in full. Review ${unread === '1 file' ? 'it' : 'them'} yourself.`]
}

// The workflow limits the session to three tools; the log of the session shows whether that held.
function offeredWarning(f) {
  const extra = f.log?.offeredExtra ?? []
  if (extra.length === 0) return []
  const shown = extra.slice(0, 8).map(code).join(', ') + (extra.length > 8 ? `, and ${extra.length - 8} more` : '')
  return ['', `⚠️ The reviewer's session was offered tools beyond Read, Grep and Glob (${shown}). The workflow is meant to allow only those three, so check the tool flags of the model step in ai-review.yml.`]
}

function warningLines(f) {
  const lines = [...coverageWarning(f), ...offeredWarning(f)]
  if (f.log?.outside > 0) {
    lines.push('', `⚠️ The reviewer opened ${plural(f.log.outside, 'path')} outside the repository checkout. Check the run log.`)
  }
  if (f.log?.otherTools.length > 0) {
    const used = f.log.otherTools.map((tool) => `${code(tool.name)} ${tool.calls}`).join(', ')
    lines.push('', `⚠️ The reviewer used tools beyond Read, Grep and Glob (${used}). The workflow offers only those three, and what was seen through the others is not counted.`)
  }
  return lines
}

function detailLines(f) {
  const lines = []
  const partial = f.coverage && f.coverage !== 'unknown'
    ? f.coverage.files.filter((file) => file.covered < file.total) : []
  if (partial.length > 0) {
    const noun = f.coverage.atLeast ? 'not covered by its own reads' : 'not read in full'
    lines.push(...details(`${plural(partial.length, 'file')} ${noun}`, [
      ...partial.slice(0, 15).map((file) => `${code(file.file)} (${percent(file.covered, file.total)}% read)`),
      ...(partial.length > 15 ? [`and ${partial.length - 15} more`] : []),
    ]))
  }
  if (f.log?.opened.length > 0) {
    lines.push(...details(`Base-branch files the reviewer opened (${f.log.opened.length})`,
      f.log.opened.slice(0, 20).map(code).concat(f.log.opened.length > 20 ? [`and ${f.log.opened.length - 20} more`] : [])))
  }
  return lines
}

const logLines = (f) => [...warningLines(f), ...detailLines(f)]

function footer(f) {
  const commands = f.trigger === 'workflow_dispatch'
    ? 'To review again, start Actions, AI review, Run workflow with this PR number.'
    : 'Commands for the repository owner: `/ai-review` reviews again, `/ai-review status` shows the budget, `/ai-review cancel` stops a run.'
  const docs = f.server && f.repository ? ` [How this works](${f.server}/${f.repository}/blob/main/docs/dev/ai-review.md).` : ''
  return ['', `<sub>github-actions[bot] is a second identity: its approval is formal and does not replace human review. ${commands}${docs} Updated ${stamp(f.now)}.</sub>`]
}

export function renderStatus(f, stripped = false) {
  const [icon, title] = STATES[f.state] ?? STATES.failed
  const rows = [['Commit', commitCell(f)], ['Changes', changesCell(f)], ['Reviewer', reviewerCell(f)],
    ['Coverage', coverageCell(f)], ['Tools', toolsCell(f)], ['Run', runCell(f)], ['Budget', budgetCell(f)]].filter(([, value]) => value)
  const body = [STATUS_MARKER, `## ${icon} AI review: ${title}`, '', '| | |', '|:--|:--|',
    ...rows.map(([label, value]) => `| **${label}** | ${value} |`), '', outcomeLines(f).join('\n\n'),
    ...(stripped ? ['', 'Some details were left out because they looked like a credential.'] : []), ...logLines(f), ...footer(f)].join('\n')
  if (!CREDENTIAL.test(body)) return body
  // Whatever matched came from a tool call or the API. The state is the workflow's own and the
  // review may already be posted, so it stays as it is: show it without those details, and if even
  // that matches, say only that the details were withheld.
  if (stripped) return `${STATUS_MARKER}\n## ${icon} AI review: ${title}\n\nThe details of this status looked like they contained a credential, so they were not posted. The review itself is unaffected: see the review posted on this commit, or the run log.`
  return renderStatus({ ...f, log: null, coverage: null, files: null, baseRef: '', findingFiles: [] }, true)
}

function intOrNull(value) {
  return /^\d+$/.test(value ?? '') ? Number(value) : null
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function readFiles(workspace, diffText) {
  const changed = readJson(join(workspace, '.ai-review/files.json'), null)
  if (!Array.isArray(changed)) return null
  const first = diffText.split('\n', 1)[0]
  const excluded = /^EXCLUDED FROM THIS REVIEW \([^)]*\): (.*)$/.exec(first)?.[1]?.split(', ') ?? []
  return {
    count: changed.length,
    additions: changed.reduce((sum, file) => sum + (Number(file.additions) || 0), 0),
    deletions: changed.reduce((sum, file) => sum + (Number(file.deletions) || 0), 0),
    excluded,
  }
}

function readDiff(workspace) {
  const path = join(workspace, DIFF_PATH)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function readLog(env, workspace) {
  if (!env.CLAUDE_EXECUTION_FILE || !existsSync(env.CLAUDE_EXECUTION_FILE)) return null
  try {
    const events = readExecutionEvents(env.CLAUDE_EXECUTION_FILE)
    return { ...summarizeExecution(events, workspace), shape: describeShape(events) }
  } catch {
    return null
  }
}

export function buildFacts(env, nowMs) {
  const workspace = env.GITHUB_WORKSPACE || process.cwd()
  const log = readLog(env, workspace)
  const diffText = readDiff(workspace)
  const sections = diffSections(diffText)
  let coverage = null
  if (log && sections.length > 0) coverage = log.results === 0 ? 'unknown' : { ...diffCoverage(sections, log.ranges), atLeast: log.unmeasurable }
  let detail = env.STATUS_DETAIL ?? ''
  const timeoutMinutes = intOrNull(env.REVIEW_TIMEOUT_MINUTES) ?? 15
  if (env.STATUS_STATE === 'failed' && !detail.startsWith('publication') && reviewTimedOut({
    outcome: env.REVIEW_OUTCOME, startedAt: intOrNull(env.REVIEW_STARTED), now: Math.floor(nowMs / 1000), timeoutMinutes })) {
    detail = 'timeout'
  }
  const structured = parseStructured(env.STRUCTURED)
  return {
    state: env.STATUS_STATE, detail, timeoutMinutes, now: nowMs, trigger: env.EVENT_NAME,
    server: env.GITHUB_SERVER_URL || 'https://github.com', repository: env.GITHUB_REPOSITORY, number: env.PR_NUMBER,
    head: env.HEAD_SHA, base: env.BASE_SHA, baseRef: env.BASE_REF,
    runId: intOrNull(env.GITHUB_RUN_ID), attempt: intOrNull(env.GITHUB_RUN_ATTEMPT),
    prRuns: intOrNull(env.PR_RUNS), dayRuns: intOrNull(env.DAY_RUNS),
    perPrLimit: intOrNull(env.PER_PR_LIMIT), dailyLimit: intOrNull(env.DAILY_LIMIT),
    claudeReason: env.CLAUDE_REASON, codexReason: env.CODEX_REASON,
    codexResultId: env.CODEX_RESULT_ID, codexResultKind: env.CODEX_RESULT_KIND,
    files: readFiles(workspace, diffText), log, coverage,
    findingCount: structured?.blocking_findings?.length ?? 0,
    findingFiles: [...new Set((structured?.blocking_findings ?? []).map((finding) => finding.file))].slice(0, 10),
  }
}

function parseStructured(text) {
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed?.blocking_findings) ? parsed : null
  } catch {
    return null
  }
}

// The shape of the execution log goes to the job log, never to the pull request. The job log of a
// public repository is public, so text that looks like a credential is not printed here either.
function printShape(lines) {
  if (!lines) return
  if (lines.some((line) => CREDENTIAL.test(line))) {
    console.log('The execution log shape looked like it contained a credential, so it was not printed.')
    return
  }
  console.log('::group::AI review execution log shape (structure only, no content)')
  for (const line of lines) console.log(line)
  console.log('::endgroup::')
}

// The status comment must never hold up a verdict, so the whole update has a deadline.
const DEADLINE_MS = 60000

function withDeadline(work, ms) {
  let timer
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`took longer than ${ms / 1000} seconds`)), ms)
  })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

// Best effort by design: the status comment never decides a verdict or an exit code.
export async function runCli(mode, env = process.env, api = createApi(env.GH_TOKEN), nowMs = Date.now(), deadlineMs = DEADLINE_MS) {
  try {
    const state = mode === 'start' ? 'reviewing' : env.STATUS_STATE
    if (mode !== 'start' && mode !== 'final') throw new Error(`Unknown mode ${mode}`)
    // The start time is what a timeout is told from later; the comment is posted even without it.
    if (mode === 'start' && env.GITHUB_OUTPUT) {
      try {
        appendFileSync(env.GITHUB_OUTPUT, `started=${Math.floor(nowMs / 1000)}\n`)
      } catch (error) {
        console.log(`::warning::AI review start time was not recorded: ${error.code ?? error.message}`)
      }
    }
    const facts = buildFacts({ ...env, STATUS_STATE: state }, nowMs)
    if (mode === 'final') printShape(facts.log?.shape)
    const body = renderStatus(facts)
    await withDeadline(upsertComment(api, { repository: env.GITHUB_REPOSITORY, number: env.PR_NUMBER, marker: STATUS_MARKER, body }), deadlineMs)
    console.log(`AI review status comment updated: ${state}`)
  } catch (error) {
    console.log(`::warning::AI review status comment was not updated: ${error.message}`)
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv[2])
  // A request that is still on its way after the deadline must not keep the step alive.
  process.exit(process.exitCode)
}
