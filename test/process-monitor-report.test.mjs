/**
 * The process monitor's report builder, pinned.
 *
 * The builder is pure: a sample and its predecessor in, JSON out. That is
 * what makes these cases worth their length — every rule the page's numbers
 * stand on (which processes exist at all, which group a row lands in, when a
 * CPU percentage exists and when it must not) is a rule of this one function,
 * and a wrong number on a dashboard is a bug nobody can reproduce from a
 * screenshot.
 *
 * The rules asserted here, in the order the code walks them:
 *
 * - the subtree: only the host pid and its descendants; a pid reuse loop and
 *   a vanished root both degrade instead of hanging;
 * - the differential: null without a baseline, a real percentage between two
 *   samples inside one window, null again when the window is too short, too
 *   long, or the total went backwards (a reused pid);
 * - the grouping: the host is the host, a registered wrapper and everything
 *   below it are "mcp", everything else under the tree is "other", and the
 *   sampler's own helpers are hidden with their subtrees;
 * - the shape: totals add up, ordering is stable and readable.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

// lib/index.js derives MCP state from homedir() at module evaluation, so
// point HOME at a scratch directory *before* the dynamic import below.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-pm-report-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = process.env.HOME
mkdirSync(join(scratchHome, '.dsh'), { recursive: true })

const { buildProcessReport, clearRegisteredProcesses, registerProcess } = await import('../lib/index.js')
after(() => {
  clearRegisteredProcesses()
  rmSync(scratchHome, { recursive: true, force: true })
})

/** One normalized OS row; every field the builder reads, nothing more. */
function row(pid, ppid, { cpuMs = 0, memBytes = 1024, name = '', cmdline = 'node server.js' } = {}) {
  return { pid, ppid, name, cmdline, memBytes, cpuMs }
}

const OPTIONS = {
  hostPid: 10,
  cores: 4,
  sampledAt: 10_000,
  platform: 'test',
  registered: [],
}

/** The predecessor of a sample, as a sampler would hand it over. */
const baselineOf = (entries, sampledAt) => ({ entries, sampledAt })

it('collects the host and its descendants, and nothing else', () => {
  const raw = [
    row(10, 1), // the host
    row(11, 10), // an MCP wrapper
    row(12, 11), // the server below the wrapper
    row(99, 1), // another process's child — same parent as the host, not ours
    row(13, 12), // a grandchild of the host
  ]
  const report = buildProcessReport(raw, null, OPTIONS)
  assert.deepEqual(
    report.entries.map((entry) => entry.pid).sort((a, b) => a - b),
    [10, 11, 12, 13],
  )
  assert.equal(report.totals.count, 4)
  assert.equal(report.hostPid, 10)
  assert.equal(report.intervalMs, 1_000)
})

it('answers an empty report when the host pid is gone from the table', () => {
  const report = buildProcessReport([row(11, 10)], null, OPTIONS)
  assert.deepEqual(report.entries, [])
  assert.equal(report.totals.count, 0)
})

it('differences a sample against its baseline into whole-machine percentages', () => {
  const first = buildProcessReport([row(10, 1, { cpuMs: 1_000 })], null, {
    ...OPTIONS,
    sampledAt: 10_000,
  })
  assert.equal(first.entries[0].cpuPct, null, 'no baseline means no window')

  // 2000 ms of CPU over 1000 ms of wall clock on 4 cores = half a machine.
  const second = buildProcessReport(
    [row(10, 1, { cpuMs: 3_000 })],
    baselineOf([row(10, 1, { cpuMs: 1_000 })], 10_000),
    { ...OPTIONS, sampledAt: 11_000 },
  )
  assert.equal(second.entries[0].cpuPct, 50)
  assert.equal(second.totals.cpuPct, 50)

  // The same pair read twice answers the same numbers — a poll that lands
  // between frames re-serves the pair, it must not zero the window out.
  const repeat = buildProcessReport(
    [row(10, 1, { cpuMs: 3_000 })],
    baselineOf([row(10, 1, { cpuMs: 1_000 })], 10_000),
    { ...OPTIONS, sampledAt: 11_000 },
  )
  assert.deepEqual(repeat, second)
})

it('refuses a window that is too short, too long, or went backwards', () => {
  const at = (sampledAt, cpuMs, baseCpuMs) =>
    buildProcessReport(
      [row(10, 1, { cpuMs })],
      baselineOf([row(10, 1, { cpuMs: baseCpuMs })], 10_000),
      { ...OPTIONS, sampledAt },
    )

  // Too short: two frames closer than a poll cycle — clock noise, not a window.
  assert.equal(at(10_100, 1_200, 1_000).entries[0].cpuPct, null)

  // Too long: the pair spans a closed page; minutes are not one second.
  assert.equal(at(60_000, 40_000, 1_000).entries[0].cpuPct, null)

  // Backwards: the pid was recycled under us. NaN-grade noise, not -300%.
  assert.equal(at(11_000, 500, 1_000).entries[0].cpuPct, null)

  // The pair *after* a too-long gap recovers: 1000 ms of CPU in 1000 ms on
  // 4 cores.
  assert.equal(
    buildProcessReport(
      [row(10, 1, { cpuMs: 41_000 })],
      baselineOf([row(10, 1, { cpuMs: 40_000 })], 60_000),
      { ...OPTIONS, sampledAt: 61_000 },
    ).entries[0].cpuPct,
    25,
  )
})

it('groups the host, tagged MCP subtrees, and everything else', () => {
  registerProcess({ pid: 20, kind: 'mcp-server', label: 'srv' })
  try {
    const raw = [
      row(10, 1, { name: 'node.exe', cmdline: 'dsh' }),
      row(20, 10, { name: 'cmd.exe', cmdline: 'cmd /c npx srv.js' }),
      row(21, 20, { name: 'node.exe', cmdline: 'node srv.js' }),
      row(30, 10, { name: 'git.exe', cmdline: 'git status' }),
    ]
    const report = buildProcessReport(raw, null, {
      ...OPTIONS,
      registered: [{ pid: 20, kind: 'mcp-server', label: 'srv', at: 0 }],
    })
    const byPid = new Map(report.entries.map((entry) => [entry.pid, entry]))
    assert.equal(byPid.get(10).kind, 'host')
    assert.equal(byPid.get(10).mcpServerId, undefined)
    assert.equal(byPid.get(20).kind, 'mcp')
    assert.equal(byPid.get(20).mcpServerId, 'srv')
    // Inheritance: the wrapper's child is the actual server.
    assert.equal(byPid.get(21).kind, 'mcp')
    assert.equal(byPid.get(21).mcpServerId, 'srv')
    assert.equal(byPid.get(30).kind, 'other')
    // Ordering: host, then mcp, then other.
    assert.deepEqual(
      report.entries.map((entry) => entry.kind),
      ['host', 'mcp', 'mcp', 'other'],
    )
  } finally {
    clearRegisteredProcesses()
  }
})

it('excludes the sampler subtree from the rows and reports it as the meter footprint', () => {
  const raw = [
    row(10, 1, { cpuMs: 100 }),
    row(40, 10, { name: 'powershell.exe', cpuMs: 1_000, memBytes: 100 * 1024 * 1024 }),
    row(41, 40, { name: 'conhost.exe', cpuMs: 0 }),
  ]
  const report = buildProcessReport(
    raw,
    baselineOf(
      [row(10, 1), row(40, 10, { cpuMs: 0, memBytes: 100 * 1024 * 1024 }), row(41, 40)],
      10_000,
    ),
    { ...OPTIONS, sampledAt: 11_000, excludePids: new Set([40]) },
  )
  // 行里只剩宿主，合计也不含采样器
  assert.deepEqual(
    report.entries.map((entry) => entry.pid),
    [10],
  )
  assert.equal(report.totals.count, 1)
  assert.equal(report.totals.memBytes, 1024)
  // 足迹：两个进程；1000 ms CPU / 1000 ms / 4 核 = 25%；内存 100 MB + 1 KB
  assert.notEqual(report.meter, null)
  assert.equal(report.meter.count, 2)
  assert.equal(report.meter.cpuPct, 25)
  assert.equal(report.meter.memBytes, 100 * 1024 * 1024 + 1024)
})

it('a null meter when nothing is excluded; a null meter CPU before a window exists', () => {
  const plain = buildProcessReport([row(10, 1)], null, OPTIONS)
  assert.equal(plain.meter, null)

  const firstFrame = buildProcessReport(
    [row(10, 1), row(40, 10, { name: 'powershell.exe' })],
    null,
    { ...OPTIONS, excludePids: new Set([40]) },
  )
  assert.notEqual(firstFrame.meter, null)
  assert.equal(firstFrame.meter.count, 1)
  assert.equal(firstFrame.meter.cpuPct, null, 'no baseline means no window, same as a row')
})

it('sorts each group by CPU desc, then memory, then pid — nulls last', () => {
  const report = buildProcessReport(
    [
      row(10, 1, { cpuMs: 100 }),
      row(31, 10, { cpuMs: 900, memBytes: 2048 }),
      row(32, 10, { cpuMs: 400, memBytes: 8192 }),
      row(33, 10, { cpuMs: 400, memBytes: 1024 }),
    ],
    baselineOf(
      [row(10, 1), row(31, 10), row(32, 10), row(33, 10)],
      10_000,
    ),
    { ...OPTIONS, sampledAt: 11_000 },
  )
  // All "other": cpu 80 (31) → cpu 40 mem 8K (32) → cpu 40 mem 1K (33) →
  // cpu 10 (host 10, but the host kind always sorts first).
  assert.deepEqual(
    report.entries.map((entry) => entry.pid),
    [10, 31, 32, 33],
  )
})

it('trims command lines and falls back to a name from the first token', () => {
  const long = `node ${'x'.repeat(400)}`
  const report = buildProcessReport([row(10, 1, { name: '', cmdline: long })], null, OPTIONS)
  const host = report.entries[0]
  assert.equal(host.name, 'node')
  assert.ok(host.cmdline.length <= 200, `trimmed to ${host.cmdline.length}`)
  assert.ok(host.cmdline.endsWith('…'))
})

it('totals add up over the entries the page can see', () => {
  const report = buildProcessReport(
    [
      row(10, 1, { cpuMs: 1_000, memBytes: 100 }),
      row(11, 10, { cpuMs: 500, memBytes: 300 }),
    ],
    null,
    OPTIONS,
  )
  assert.equal(report.totals.count, 2)
  assert.equal(report.totals.memBytes, 400)
  assert.equal(report.totals.cpuPct, 0, 'no window yet, so the CPU total is zero — never null')
})
