/**
 * The process monitor's route and platform parsers.
 *
 * The handlers are exercised directly (no harness, no socket — the same way
 * `mcp-debug.test.mjs` does it) against a scripted sampler, so what is pinned
 * here is the plumbing: which path the route claims, what a reading of each
 * shape turns into on the wire, and that the differencing baseline lives
 * between requests — the whole "the poll is the sampling window" contract.
 *
 * The parsers get canned output of the exact shape each platform's command
 * emits, because those shapes are the parsers' entire job: a Windows frame is
 * one JSON line of `Win32_Process` rows (100 ns CPU units), a POSIX table is
 * positional `pid ppid rss time args` lines whose `args` contains spaces.
 * Neither test owns a real OS call, so both run on any CI runner.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

// lib/index.js derives MCP state from homedir() at module evaluation, so
// point HOME at a scratch directory *before* the dynamic import below.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-pm-api-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = process.env.HOME
mkdirSync(join(scratchHome, '.dsh'), { recursive: true })

const {
  createProcessMonitorHandlers,
  parseCpuTimeToMs,
  parsePosixOutput,
  parseWindowsFrame,
  clearRegisteredProcesses,
  registerProcess,
} = await import('../lib/index.js')
after(() => {
  clearRegisteredProcesses()
  rmSync(scratchHome, { recursive: true, force: true })
})

/** A logger that records warns, for the one case that logs. */
const logger = { info() {}, warn() {}, error() {} }

/** Call one handler with a minimal req/res pair; the facts the route builds. */
async function call(handlers, method, path) {
  const req = {
    method,
    url: path,
    headers: { host: '127.0.0.1:3080' },
    async *[Symbol.asyncIterator]() {},
  }
  const res = {
    code: 0,
    body: '',
    writeHead(code) {
      this.code = code
    },
    end(chunk) {
      this.body = chunk ?? ''
    },
  }
  const facts = { url: new URL(path, 'http://127.0.0.1:3080'), rest: path, origin: '', idMatch: null }
  for (const handler of handlers) {
    const claimed = await handler(req, res, facts)
    if (claimed) return { code: res.code, json: res.body === '' ? undefined : JSON.parse(res.body) }
  }
  return { unhandled: true }
}

/** A sampler whose readings play back in order and never touch an OS. */
function scriptedSampler(readings) {
  let at = 0
  return {
    async read() {
      const reading = readings[Math.min(at, readings.length - 1)]
      at += 1
      return typeof reading === 'function' ? reading() : reading
    },
    excludePids: () => new Set(),
    dispose() {},
  }
}

const HOST_PID = 4321
const deps = (sampler) => ({ logger, sampler, hostPid: HOST_PID, cores: 4, platform: 'test' })

it('claims its one path and nothing else', async () => {
  const handlers = createProcessMonitorHandlers(deps(scriptedSampler([{ warmingUp: true }])))
  const other = await call(handlers, 'GET', '/process-monitor')
  assert.equal(other.unhandled, true, 'a sibling path must stay available')
  const wrongMethod = await call(handlers, 'POST', '/process-monitor/sample')
  assert.equal(wrongMethod.unhandled, true)
})

it('first read has no percentages; the second differences the pair it carries', async () => {
  const entriesOf = (cpuMs) => [{ pid: HOST_PID, ppid: 1, name: 'node', cmdline: 'dsh', memBytes: 1024, cpuMs }]
  const sampler = scriptedSampler([
    { entries: entriesOf(1_000), sampledAt: 10_000, baseline: null },
    { entries: entriesOf(3_000), sampledAt: 11_000, baseline: { entries: entriesOf(1_000), sampledAt: 10_000 } },
  ])
  const handlers = createProcessMonitorHandlers(deps(sampler))

  const first = await call(handlers, 'GET', '/process-monitor/sample')
  assert.equal(first.code, 200)
  assert.equal(first.json.entries[0].cpuPct, null)
  assert.equal(first.json.intervalMs, 1_000)
  assert.equal(first.json.hostPid, HOST_PID)
  assert.equal(first.json.platform, 'test')

  const second = await call(handlers, 'GET', '/process-monitor/sample')
  assert.equal(second.json.entries[0].cpuPct, 50, '2000 ms CPU / 1000 ms / 4 cores')
  assert.equal(second.json.totals.cpuPct, 50)
})

it('a poll that lands between frames re-serves the pair, not a zero window', async () => {
  // The regression this pins: the Windows helper frames every ~1.2 s while
  // the page polls every 1.0 s, so some polls see no new frame. When the
  // differential lived in the route, those polls differed the same frame
  // against itself — window 0 — and blanked the page's whole CPU column. The
  // pair travels with the reading now, so the second serving of one pair
  // answers the same numbers as the first.
  const entriesOf = (cpuMs) => [{ pid: HOST_PID, ppid: 1, name: 'node', cmdline: 'dsh', memBytes: 1024, cpuMs }]
  const pair = { entries: entriesOf(3_000), sampledAt: 11_000, baseline: { entries: entriesOf(1_000), sampledAt: 10_000 } }
  const sampler = scriptedSampler([pair, pair, pair])
  const handlers = createProcessMonitorHandlers(deps(sampler))

  const answers = []
  for (let i = 0; i < 3; i += 1) {
    answers.push(await call(handlers, 'GET', '/process-monitor/sample'))
  }
  for (const answer of answers) {
    assert.equal(answer.json.entries[0].cpuPct, 50, 'every serving of one pair shows the same window')
    assert.equal(answer.json.totals.cpuPct, 50)
  }
})

it('a warming sampler and a failing sampler are both 200-with-a-flag', async () => {
  const warming = createProcessMonitorHandlers(deps(scriptedSampler([{ warmingUp: true }])))
  const warm = await call(warming, 'GET', '/process-monitor/sample')
  assert.equal(warm.code, 200)
  assert.equal(warm.json.warmingUp, true)
  assert.deepEqual(warm.json.entries, [])

  const failing = createProcessMonitorHandlers(deps(scriptedSampler([{ error: 'ps is missing' }])))
  const failed = await call(failing, 'GET', '/process-monitor/sample')
  assert.equal(failed.code, 200)
  assert.equal(failed.json.error, 'ps is missing')
})

it('reads the process registry per request, so MCP tagging is live', async () => {
  const entries = () => [
    { pid: HOST_PID, ppid: 1, name: 'node', cmdline: 'dsh', memBytes: 1024, cpuMs: 0 },
    { pid: 77, ppid: HOST_PID, name: 'cmd.exe', cmdline: 'cmd /c srv.js', memBytes: 1024, cpuMs: 0 },
  ]
  const handlers = createProcessMonitorHandlers(deps(scriptedSampler([
    { entries: entries(), sampledAt: 10_000, baseline: null },
    { entries: entries(), sampledAt: 11_000, baseline: null },
    { entries: entries(), sampledAt: 12_000, baseline: null },
  ])))

  const before = await call(handlers, 'GET', '/process-monitor/sample')
  assert.equal(before.json.entries.find((entry) => entry.pid === 77).kind, 'other')

  registerProcess({ pid: 77, kind: 'mcp-server', label: 'srv' })
  try {
    const after = await call(handlers, 'GET', '/process-monitor/sample')
    const tagged = after.json.entries.find((entry) => entry.pid === 77)
    assert.equal(tagged.kind, 'mcp')
    assert.equal(tagged.mcpServer, 'srv')
  } finally {
    clearRegisteredProcesses()
    // And the next read sees the withdrawal — the registry is read per call.
    const withdrawn = await call(handlers, 'GET', '/process-monitor/sample')
    assert.equal(withdrawn.json.entries.find((entry) => entry.pid === 77).kind, 'other')
  }
})

/* --------------------------------------------------------- platform parsers */

it('parses a Windows frame: 100 ns CPU units, JSON line, single row or array', () => {
  const single = parseWindowsFrame(
    '{"ProcessId":10,"ParentProcessId":1,"Name":"node.exe","CommandLine":"node a.js","WorkingSetSize":2048,"KernelModeTime":10000000,"UserModeTime":10000000}',
  )
  assert.equal(single.length, 1)
  assert.equal(single[0].cpuMs, 2_000, '1e7 * 2 / 1e4')
  assert.equal(single[0].memBytes, 2048)
  assert.equal(single[0].pid, 10)
  assert.equal(single[0].ppid, 1)
  assert.equal(single[0].name, 'node.exe')

  const array = parseWindowsFrame(
    `[{"ProcessId":1,"ParentProcessId":0,"Name":"a.exe","CommandLine":null,"WorkingSetSize":1,"KernelModeTime":0,"UserModeTime":0},{"ProcessId":2,"ParentProcessId":1,"Name":"b.exe","CommandLine":"b 中文参数","WorkingSetSize":2,"KernelModeTime":0,"UserModeTime":0}]`,
  )
  assert.equal(array.length, 2)
  assert.equal(array[0].cmdline, '')
  assert.equal(array[1].cmdline, 'b 中文参数')

  assert.equal(parseWindowsFrame('not json at all'), null)
  assert.equal(parseWindowsFrame('[]').length, 0)
})

it('parses a POSIX table positionally, with spaces inside args', () => {
  const table = [
    '   10      1  1024  1:02.33 /usr/bin/node /home/me/项目/server.js --flag with space',
    '   11     10   512      3:04 node worker.js',
    '   12     10   256  1-02:03:04 [kworker] <defunct>',
    'garbage line',
    '',
  ].join('\n')
  const rows = parsePosixOutput(table)
  assert.equal(rows.length, 3)
  assert.deepEqual(
    rows.map((r) => r.pid),
    [10, 11, 12],
  )
  const first = rows[0]
  assert.equal(first.ppid, 1)
  assert.equal(first.memBytes, 1024 * 1024, 'rss is KiB')
  assert.equal(first.cpuMs, 62_330, '1:02.33')
  assert.equal(first.name, 'node')
  assert.equal(first.cmdline, '/usr/bin/node /home/me/项目/server.js --flag with space')
  assert.equal(rows[2].cpuMs, ((1 * 24 + 2) * 3600 + 3 * 60 + 4) * 1000, '1-02:03:04')
})

it('parses every CPU time shape ps emits', () => {
  assert.equal(parseCpuTimeToMs('0:00.00'), 0)
  assert.equal(parseCpuTimeToMs('1:02.33'), 62_330)
  assert.equal(parseCpuTimeToMs('01:02:03'), 3_723_000)
  assert.equal(parseCpuTimeToMs('1-01:00:00'), 90_000_000)
  assert.equal(parseCpuTimeToMs('nonsense'), 0)
  assert.equal(parseCpuTimeToMs('12'), 0)
})
