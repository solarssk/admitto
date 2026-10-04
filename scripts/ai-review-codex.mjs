import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const connectorId = 199175422
const connectorLogin = 'chatgpt-codex-connector[bot]'

function fromConnector(item) {
  return item.user?.id === connectorId && item.user.login === connectorLogin && item.user.type === 'Bot'
}

export function assessCodexResult({ comments, reviews, head, requestedAt }) {
  const findings = reviews.find((review) => fromConnector(review) && review.commit_id === head &&
    review.submitted_at >= requestedAt && ['COMMENTED', 'CHANGES_REQUESTED'].includes(review.state))
  if (findings) return { status: 'findings', reason: '', resultId: findings.id, resultKind: 'review' }
  const fresh = comments.filter((comment) => fromConnector(comment) && comment.created_at >= requestedAt)
  for (const comment of fresh) {
    const match = /^Codex Review: Didn't find any major issues\.[^\n]*\n\n\*\*Reviewed commit:\*\* `([a-f0-9]{10,40})`\n/.exec(comment.body ?? '')
    if (match && head.startsWith(match[1])) {
      return { status: 'candidate', reason: '', resultId: comment.id, resultKind: 'comment', commitRef: match[1] }
    }
  }
  if (fresh.some((comment) => comment.body?.startsWith('To use Codex here,'))) {
    return { status: 'unavailable', reason: 'connector_not_linked', resultId: '', resultKind: '' }
  }
  return { status: 'pending', reason: '', resultId: '', resultKind: '' }
}

function currentOwnerPr(pr, repository, head) {
  return pr.state === 'open' && pr.head?.sha === head && pr.head.repo?.full_name === repository &&
    pr.user?.login === repository.split('/')[0]
}

export async function runCodexFallback({ repository, number, head, triggerToken, readToken,
  api, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 48 }) {
  if (!triggerToken) return { status: 'unavailable', reason: 'trigger_not_configured' }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^\d+$/.test(String(number)) || !/^[a-f0-9]{40}$/.test(head)) {
    throw new Error('Invalid request')
  }
  const root = `/repos/${repository}`
  const prPath = `${root}/pulls/${number}`
  const commentPath = `${root}/issues/${number}/comments`
  const requester = await api('/user', triggerToken)
  if (requester.login !== repository.split('/')[0]) throw new Error('Trigger identity must be repository owner')
  if (!currentOwnerPr(await api(prPath, readToken), repository, head)) return { status: 'stale', reason: '' }
  const body = `@codex review\n\n<!-- admitto-codex-fallback:${head} -->`
  const existing = await api(commentPath, readToken, 'GET', undefined, true)
  const request = existing.find((comment) => comment.user?.id === requester.id && comment.body === body) ??
    await api(commentPath, triggerToken, 'POST', { body })
  return waitForCodex({api, readToken, root, prPath, commentPath, repository, head, request, attempts, sleep})
}

function waitForCodex(config) {
  return pollCodex({...config, deadline: Date.now() + 8 * 60 * 1000}, 0)
}

async function pollCodex(config, attempt) {
  const {api, readToken, root, prPath, commentPath, repository, head, request, attempts, sleep, deadline} = config
  if (attempt >= attempts || Date.now() >= deadline) return { status: 'unavailable', reason: 'review_timeout' }
  if (!currentOwnerPr(await api(prPath, readToken), repository, head)) return { status: 'stale', reason: '' }
  const [comments, reviews] = await Promise.all([
    api(commentPath, readToken, 'GET', undefined, true),
    api(`${prPath}/reviews`, readToken, 'GET', undefined, true),
  ])
  const result = assessCodexResult({ comments, reviews, head, requestedAt: request.created_at })
  if (result.status === 'candidate') {
    const commit = await api(`${root}/commits/${result.commitRef}`, readToken)
    if (commit.sha === head) return { status: 'clean', reason: '', resultId: result.resultId, resultKind: 'comment' }
  } else if (result.status !== 'pending') return result
  await sleep(10000)
  return pollCodex(config, attempt + 1)
}

export async function githubApi(path, token, method, body, paginated = false) {
  const results = []
  for (let page = 1; page <= 20; page++) {
    const suffix = paginated ? `?per_page=100&page=${page}` : ''
    const response = await fetch(`https://api.github.com${path}${suffix}`, {
      method: method ?? 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error('GitHub request failed')
    const data = await response.json()
    if (!paginated) return data
    if (!Array.isArray(data)) throw new Error('Invalid GitHub list')
    results.push(...data)
    if (data.length < 100) return results
  }
  throw new Error('GitHub pagination limit reached')
}

export async function main(env = process.env, api = githubApi) {
  try {
    const result = await runCodexFallback({ repository: env.GITHUB_REPOSITORY,
      number: env.PR_NUMBER, head: env.HEAD_SHA,
      triggerToken: env.CODEX_REVIEW_TRIGGER_TOKEN, readToken: env.GH_TOKEN, api })
    const outputs = ['status', 'reason', 'resultId', 'resultKind'].map((key) => `${key}=${result[key] ?? ''}`).join('\n')
    appendFileSync(env.GITHUB_OUTPUT, `${outputs}\n`)
    console.log(`Codex connector status: ${result.status}`)
    return 0
  } catch {
    appendFileSync(env.GITHUB_OUTPUT, 'status=error\nreason=connector_setup_or_api_error\n')
    console.error('Codex connector failed; no approval may be based on this result.')
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
