import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { errorText, migrateLoadedState, normalizeEnvPairs, quoteWindowsToken } from '../lib/index.js'

describe('normalizeEnvPairs (legacy [{ name, value }] support)', () => {
  it('converts the legacy list into a flat map', () => {
    assert.deepEqual(
      normalizeEnvPairs([{ name: 'UV_CACHE_DIR', value: '/tmp/uv' }, { name: 'A', value: '1' }]),
      { UV_CACHE_DIR: '/tmp/uv', A: '1' },
    )
  })

  it('accepts { key, value } entries and coerces values to strings', () => {
    assert.deepEqual(normalizeEnvPairs([{ key: 'N', value: 2 }]), { N: '2' })
    assert.deepEqual(normalizeEnvPairs([{ name: 'E', value: undefined }]), { E: '' })
  })

  it('drops entries without a usable name', () => {
    assert.deepEqual(normalizeEnvPairs([{ value: 'x' }, null, 'nope', 7, { name: '', value: 'x' }]), {})
  })

  it('passes the current object form through and rejects anything else', () => {
    const object = { A: '1' }
    assert.equal(normalizeEnvPairs(object), object)
    assert.deepEqual(normalizeEnvPairs(undefined), {})
    assert.deepEqual(normalizeEnvPairs('A=1'), {})
  })
})

describe('migrateLoadedState', () => {
  it('backfills a missing id on every legacy server', () => {
    const state = { servers: [{ name: 'docker' }, { name: 'github' }, { name: 'github-write' }] }
    let assigned = 0
    const changed = migrateLoadedState(state, () => `id-${++assigned}`)
    assert.equal(changed, true)
    // Distinct ids are what keep the live-status map from cross-wiring errors.
    assert.deepEqual(state.servers.map((server) => server.id), ['id-1', 'id-2', 'id-3'])
  })

  it('keeps existing unique ids and assigns only the missing ones', () => {
    const state = { servers: [{ id: 'keep', name: 'a' }, { name: 'b' }] }
    assert.equal(migrateLoadedState(state, () => 'fresh'), true)
    assert.deepEqual(state.servers.map((server) => server.id), ['keep', 'fresh'])
  })

  it('reassigns a duplicated id so status can no longer cross over', () => {
    const state = { servers: [{ id: 'dup', name: 'a' }, { id: 'dup', name: 'b' }] }
    assert.equal(migrateLoadedState(state, () => 'new'), true)
    assert.deepEqual(state.servers.map((server) => server.id), ['dup', 'new'])
  })

  it('normalizes legacy env/header arrays in place', () => {
    const state = {
      servers: [{
        id: 'a',
        env: [{ name: 'UV_CACHE_DIR', value: '/tmp/uv' }],
        headers: [{ name: 'X-Tenant', value: 't1' }],
        headerEnv: [],
      }],
    }
    assert.equal(migrateLoadedState(state), true)
    assert.deepEqual(state.servers[0].env, { UV_CACHE_DIR: '/tmp/uv' })
    assert.deepEqual(state.servers[0].headers, { 'X-Tenant': 't1' })
    assert.deepEqual(state.servers[0].headerEnv, {})
  })

  it('reports no change for an already-migrated state', () => {
    const state = { servers: [{ id: 'a', env: { A: '1' } }], workspaceTokens: {} }
    assert.equal(migrateLoadedState(state), false)
  })

  it('tolerates malformed servers and a missing list', () => {
    assert.equal(migrateLoadedState({}), false)
    assert.equal(migrateLoadedState(undefined), false)
    assert.equal(migrateLoadedState({ servers: { nope: true } }), false)
    const state = { servers: [null, 'nope', { id: 'ok' }] }
    assert.equal(migrateLoadedState(state), false)
    assert.equal(state.servers[2].id, 'ok')
  })
})

describe('quoteWindowsToken (cmd.exe command line)', () => {
  it('quotes a command path containing spaces', () => {
    assert.equal(
      quoteWindowsToken('C:\\Users\\me\\AppData\\Local\\GitHub CLI\\extensions\\gh-mcp.exe'),
      '"C:\\Users\\me\\AppData\\Local\\GitHub CLI\\extensions\\gh-mcp.exe"',
    )
  })

  it('leaves a token without whitespace or quotes untouched', () => {
    assert.equal(quoteWindowsToken('npx'), 'npx')
    assert.equal(quoteWindowsToken('C:\\tools\\uvx.cmd'), 'C:\\tools\\uvx.cmd')
    assert.equal(quoteWindowsToken('-y'), '-y')
  })

  it('is idempotent for a token the user already quoted', () => {
    const quoted = '"C:\\path with space\\server.exe"'
    assert.equal(quoteWindowsToken(quoted), quoted)
    assert.equal(quoteWindowsToken(quoteWindowsToken(quoted)), quoted)
  })

  it('quotes an empty token and escapes inner quotes', () => {
    assert.equal(quoteWindowsToken(''), '""')
    assert.equal(quoteWindowsToken('say "hi"'), '"say \\"hi\\""')
  })

  it('produces the command line the issue reporter verified', () => {
    const command = quoteWindowsToken('C:\\path with space\\server.exe')
    const args = ['--flag', 'a b', 'plain'].map(quoteWindowsToken)
    assert.equal([command, ...args].join(' '), '"C:\\path with space\\server.exe" --flag "a b" plain')
  })
})

describe('errorText (cause chain)', () => {
  it('appends the cause, which is where fetch() keeps the real reason', () => {
    // undici 把 ECONNREFUSED 藏在 cause 里，只报 message 的话设置页只显示 "fetch failed"。
    const error = new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:8793') })
    assert.equal(errorText(error), 'fetch failed (connect ECONNREFUSED 127.0.0.1:8793)')
  })

  it('prefers an AggregateError entry over its useless own message', () => {
    // 主机名解析出多个地址时 undici 对每个地址各试一次，失败原因在 errors 里。
    const cause = new AggregateError(
      [new Error('connect ECONNREFUSED ::1:8793'), new Error('connect ECONNREFUSED 127.0.0.1:8793')],
      'aggregate error',
    )
    assert.equal(errorText(new TypeError('fetch failed', { cause })), 'fetch failed (connect ECONNREFUSED ::1:8793)')
  })

  it('caps the chain so one error cannot produce a wall of text', () => {
    const error = new Error('e1', { cause: new Error('e2', { cause: new Error('e3', { cause: new Error('e4') }) }) })
    assert.equal(errorText(error), 'e1 (e2 → e3)')
  })

  it('cannot loop on a self-referencing or repeated cause', () => {
    const selfReferencing = new Error('loop')
    selfReferencing.cause = selfReferencing
    assert.equal(errorText(selfReferencing), 'loop')
    assert.equal(errorText(new Error('boom', { cause: new Error('boom') })), 'boom')
  })

  it('keeps the old rendering for a bare message and for non-errors', () => {
    assert.equal(errorText(new Error('failed')), 'failed')
    assert.equal(errorText('boom'), 'boom')
    assert.equal(errorText(undefined), 'undefined')
    assert.equal(errorText(null), 'null')
  })
})
