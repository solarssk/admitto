import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('./verify-lockfile-resolutions.py', import.meta.url))

// The script has a dash in its name, so load it by path and print what override_pins makes of the overrides.
function pins(overrides) {
  const code = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("verify", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(json.dumps(module.override_pins(json.loads(sys.argv[2]))))',
  ].join('\n')
  // -B: do not leave a __pycache__ next to the script
  const run = spawnSync('python3', ['-I', '-B', '-c', code, script, JSON.stringify(overrides)], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout)
}

test('a bare override key pins its package', () => {
  assert.deepEqual(pins({ uuid: '^14.0.0', '@scope/pkg': '2.0.0' }), { uuid: ['^14.0.0'], '@scope/pkg': ['2.0.0'] })
})

test('a key that carries the range of requests it applies to pins the package by its name', () => {
  assert.deepEqual(
    pins({ 'minimatch@>=7.0.0 <11.0.1': '^11.0.1', 'glob@>=9.0.0 <14.0.2': '^14.0.2', '@scope/pkg@^1': '1.2.3' }),
    { minimatch: ['^11.0.1'], glob: ['^14.0.2'], '@scope/pkg': ['1.2.3'] },
  )
})

test('two keys for one package keep both pins, and an object value is left to its parent', () => {
  assert.deepEqual(
    pins({ 'minimatch@^9': '^11.0.1', 'minimatch@^10': '^11.0.2', svgtofont: { svgo: '^3.3.4' } }),
    { minimatch: ['^11.0.1', '^11.0.2'] },
  )
})
