import { readFileSync, appendFileSync } from 'node:fs'

const providerErrors = new Set([
  'authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'verification_required',
  'billing_error', 'rate_limit', 'overloaded', 'server_error', 'cloud_credential_error',
])

function isValidReview(structured) {
  if (typeof structured !== 'string') return false
  try {
    const review = JSON.parse(structured)
    return (review?.verdict === 'approve' || review?.verdict === 'comment') &&
      typeof review.summary === 'string' && review.summary.trim().length > 0 &&
      Array.isArray(review.blocking_findings) &&
      review.blocking_findings.every((finding) =>
        typeof finding?.file === 'string' && typeof finding.issue === 'string')
  } catch {
    return false
  }
}

// The action writes its execution log as one JSON array, or as one JSON object per line.
export function readExecutionEvents(executionFile) {
  const contents = readFileSync(executionFile, 'utf8')
  try {
    return JSON.parse(contents)
  } catch {
    return contents.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  }
}

// Only explicit provider errors or the observed empty pre-model error are unavailable.
// Invalid output, exhausted turns and errors in our own CI remain failures.
export function classifyClaudeReview({ outcome, structured, executionFile, credentialPresent }) {
  if (credentialPresent === 'false') return { status: 'unavailable', reason: 'not_configured' }
  if (outcome === 'success' && isValidReview(structured)) return { status: 'reviewed', reason: '' }

  if (!executionFile) return { status: 'error', reason: 'missing_execution_file' }
  let events
  try {
    events = readExecutionEvents(executionFile)
  } catch {
    return { status: 'error', reason: 'unreadable_execution_file' }
  }
  const results = []
  const errors = []
  const visit = (entry) => {
    if (!entry || typeof entry !== 'object') return
    if (entry.type === 'result') results.push(entry)
    if (entry.type === 'assistant' && typeof entry.error === 'string') errors.push(entry.error)
    for (const value of Object.values(entry)) visit(value)
  }
  visit(events)
  const result = results.at(-1)
  if (result?.is_error !== true ||
      !['success', 'error_during_execution'].includes(result.subtype)) {
    return { status: 'error', reason: 'no_usable_review' }
  }
  // Never hide an explicit configuration/unknown error behind an earlier provider error.
  if (errors.some((error) => !providerErrors.has(error))) {
    return { status: 'error', reason: 'non_provider_error' }
  }
  if (errors.length > 0) return { status: 'unavailable', reason: errors.at(-1) }

  const detail = [result.result, ...(Array.isArray(result.errors) ? result.errors : [])]
    .filter((part) => typeof part === 'string').join(' ').trim()
  const providerNamed = /\b(claude|anthropic|oauth|subscription)\b/i.test(detail)
  const reasons = [
    [/\b(authentication|unauthorized|invalid (?:oauth )?token|expired (?:oauth )?token|(?:oauth )?token expired)\b/i, 'authentication'],
    [/\b(quota|usage limit|rate limit|billing limit)\b/i, 'usage_limit'],
    [/\b(overloaded|service unavailable|temporarily unavailable|bad gateway|gateway timeout)\b/i, 'provider_service'],
  ]
  const reason = providerNamed ? reasons.find(([pattern]) => pattern.test(detail))?.[1] : undefined
  if (reason) return { status: 'unavailable', reason }

  // This exact shape occurred on the live action while the maintainer's quota was exhausted.
  // Do not label it a quota failure: the result does not identify the cause.
  if (!detail && result.subtype === 'success' && result.total_cost_usd === 0 &&
      result.num_turns === 1 && result.modelUsage &&
      typeof result.modelUsage === 'object' && !Array.isArray(result.modelUsage) &&
      Object.keys(result.modelUsage).length === 0) {
    return { status: 'unavailable', reason: 'no_model_response' }
  }
  return { status: 'error', reason: 'unrecognized_failure' }
}

if (process.argv[1]?.endsWith('/ai-review-outcome.mjs')) {
  const result = classifyClaudeReview({
    outcome: process.env.CLAUDE_OUTCOME,
    structured: process.env.CLAUDE_STRUCTURED,
    executionFile: process.env.CLAUDE_EXECUTION_FILE,
    credentialPresent: process.env.CLAUDE_CREDENTIAL_PRESENT,
  })
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `status=${result.status}\nreason=${result.reason}\n`)
  }
  const reasonSuffix = result.reason ? ` (${result.reason})` : ''
  console.log(`Claude review status: ${result.status}${reasonSuffix}`)
}
