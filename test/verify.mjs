/**
 * Offline verification for dsh-smkit — run by `pnpm verify` and
 * `prepack`, after `tsc` has emitted lib/index.js.
 *
 * Exercises the plugin the same way the Cordis loader would:
 *   1. import lib/index.js as the loader does (bare ESM import),
 *   2. check the named exports (`name` display metadata + function-form
 *      `apply`),
 *   3. mount the plugin against a fake context and capture the tutorial's
 *      expected log line,
 *   4. confirm the bundle patch/manifest wiring still points at this
 *      package.
 *
 * Exits non-zero with a clear message on any failure, so `prepack` can never
 * ship a broken build.
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

const failure = (message) => {
  console.error(`verify: ${message}`)
  process.exit(1)
}

/** 1. The build must exist and import cleanly, exporting the tutorial plugin. */
let mod
try {
  mod = await import(pathToFileURL(require.resolve('../lib/index.js')).href)
} catch (error) {
  failure(`cannot import lib/index.js — run \`pnpm build\` first: ${error?.stack ?? error}`)
}

/** 2. Named exports: `name` display metadata + function-form `apply`. */
assert.equal(mod.name, 'hello', 'the plugin must export name = "hello"')
assert.equal(typeof mod.apply, 'function', 'the plugin must export a function-form apply()')

/** 3. Mount against a fake context; the tutorial's log line must come out. */
const logs = []
const originalLog = console.log
console.log = (...parts) => logs.push(parts.join(' '))
try {
  mod.apply({})
} finally {
  console.log = originalLog
}
assert.deepEqual(logs, ['hello from my first plugin'], 'apply must log the tutorial greeting exactly once')

/** 4. cordis.patch.yml must exist and insert this package by name. */
const patch = require('node:fs').readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
assert.ok(patch.includes(`name: '${pkg.name}'`), 'cordis.patch.yml must insert the package by name')
assert.ok(pkg.dsh.bundle.patch === './cordis.patch.yml', 'package.json must declare dsh.bundle.patch')

console.log('verify: ok — dsh-smkit builds, mounts, and logs.')
