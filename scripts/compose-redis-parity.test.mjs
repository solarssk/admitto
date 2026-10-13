import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const consumers = ['app', 'migrate', 'worker']
const password = 'synthetic-redis-secret'

function configuration(redisPassword, redisUrl) {
  const directory = mkdtempSync(join(tmpdir(), 'admitto-compose-redis-'))
  try {
    // Copy the shipped file unchanged: its env_file resolves only to our synthetic .env.
    copyFileSync(join(root, 'deploy/docker-compose.yml'), join(directory, 'docker-compose.yml'))
    const fixture = join(directory, '.env')
    const values = {
      POSTGRES_USER: 'admitto_app', POSTGRES_DB: 'admitto',
      POSTGRES_PASSWORD: 'synthetic-postgres-secret',
      DATABASE_URL: 'postgresql://admitto_app:synthetic-postgres-secret@db:5432/admitto',
      ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      BASE_URL: 'https://tickets.example.com', REDIS_PASSWORD: redisPassword,
      ...(redisUrl === undefined ? {} : { REDIS_URL: redisUrl }),
    }
    // Single quotes preserve literal dollar signs in Compose's env-file parsing.
    writeFileSync(fixture, Object.entries(values).map(([key, value]) => `${key}='${value}'`).join('\n'))
    const options = { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME,
      NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }, timeout: 20_000 }
    const validation = spawnSync(process.execPath, [join(root, 'deploy/validate-env.mjs'), fixture], options)
    const rendered = spawnSync('docker', ['compose', '--project-directory', directory, '--env-file', fixture,
      '-f', join(directory, 'docker-compose.yml'), 'config', '--format', 'json'], options)
    // Report only categories/booleans on failure, never the rendered credential values.
    assert.equal(rendered.status, 0, 'synthetic Compose configuration must render without starting services')
    // Compose escapes every literal dollar when serializing config for reuse. Decode that layer.
    return { validation, services: JSON.parse(rendered.stdout.replaceAll('$$', '$')).services }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const cases = [
  ['a stale reference password', password, 'redis://:CHANGE_ME@redis:6379', 'password differs'],
  ['matching credentials', password, `redis://:${password}@redis:6379`],
  ['an unset reference URL', password, undefined, 'is unset'],
  ['a passwordless reference URL', password, 'redis://redis:6379', 'has no password'],
  ...[['colon and at sign', 'synthetic:redis@secret'], ['literal dollar signs', 'synthetic$redis$secret'],
    ['plus and equals signs', 'synthetic+redis=secret']].map(([name, value]) =>
    [name, value, `redis://:${encodeURIComponent(value)}@redis:6379`]),
]
for (const [name, redisPassword, redisUrl, warning] of cases) {
  test(`Compose gives all Redis consumers the server password with ${name}`, () => {
    const { validation, services } = configuration(redisPassword, redisUrl)
    assert.equal(validation.status, 0, 'real validator must accept the synthetic configuration')
    for (const service of consumers) {
      const url = new URL(services[service].environment.REDIS_URL)
      assert.ok(decodeURIComponent(url.password) === redisPassword, `${service} must authenticate with the server password`)
      assert.equal(url.hostname, 'redis')
      assert.equal(url.port, '6379')
    }
    assert.ok(services.redis.environment.REDIS_PASSWORD === redisPassword, 'Redis server must use the same password')
    if (warning) {
      assert.ok(validation.stderr.includes(warning), 'reference URL warning must remain observable')
      assert.ok(validation.stderr.includes('app, migrate and worker'), 'warning must cover every Compose consumer')
    } else {
      assert.equal(validation.stderr, '', 'matching reference URL must not warn')
    }
    assert.ok(!validation.stderr.includes(redisPassword), 'warnings must not expose the configured password')
  })
}
