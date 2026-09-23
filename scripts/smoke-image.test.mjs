import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const image = `ghcr.io/solarssk/admitto@sha256:${'a'.repeat(64)}`

function runSmoke(imageRef) {
  const directory = mkdtempSync(join(tmpdir(), 'admitto-smoke-image-'))
  try {
    const deploy = join(directory, 'deploy')
    const bin = join(directory, 'bin')
    mkdirSync(join(deploy, 'scripts'), { recursive: true })
    mkdirSync(bin)
    for (const file of ['.env.example', 'validate-env.mjs']) {
      copyFileSync(join(root, 'deploy', file), join(deploy, file))
    }
    copyFileSync(join(root, 'deploy/scripts/smoke-image.sh'), join(deploy, 'scripts/smoke-image.sh'))

    const docker = join(bin, 'docker')
    writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MOCK_DOCKER_LOG"\n')
    chmodSync(docker, 0o755)
    const sudo = join(bin, 'sudo')
    writeFileSync(sudo, '#!/bin/sh\nexit 0\n')
    chmodSync(sudo, 0o755)
    const curl = join(bin, 'curl')
    writeFileSync(curl, [
      '#!/bin/sh',
      'case " $* " in *"127.0.0.1:3000/healthz"*) exit 7;; esac',
      'output=""',
      'previous=""',
      'for arg in "$@"; do',
      '  if [ "$previous" = "-o" ]; then output="$arg"; fi',
      '  previous="$arg"',
      'done',
      'case " $* " in',
      '  *"-X POST"*) printf "Invalid email or password" > "$output"; printf 401;;',
      '  *"/login"*) printf "200\\n";;',
      '  *) printf \'{"status":"ok"}\';;',
      'esac',
      '',
    ].join('\n'))
    chmodSync(curl, 0o755)

    const log = join(directory, 'docker.log')
    const result = spawnSync('bash', [join(deploy, 'scripts/smoke-image.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        ADMITTO_IMAGE: imageRef,
        MOCK_DOCKER_LOG: log,
      },
    })
    return {
      ...result,
      dockerCalls: existsSync(log) ? readFileSync(log, 'utf8') : '',
      envLeftBehind: existsSync(join(deploy, '.env')),
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('smoke checks pull and run the exact digest without a source build', () => {
  const result = runSmoke(image)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.dockerCalls, new RegExp(`pull ${image}`))
  assert.match(result.dockerCalls, /compose up -d --no-build --pull missing/)
  assert.doesNotMatch(result.dockerCalls, /compose.*--build(?!\S)/)
  assert.equal(result.envLeftBehind, false)
})

test('smoke rejects unrelated image references before touching Docker', () => {
  const result = runSmoke('docker.io/unrelated/image:latest')
  assert.equal(result.status, 1)
  assert.equal(result.dockerCalls, '')
})
