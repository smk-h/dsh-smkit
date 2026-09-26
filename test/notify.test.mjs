/**
 * The notify feature's decision logic, asserted against a fake clock.
 *
 * Three things have to hold together, and each is what the user actually
 * experiences:
 *
 * 1. **Edges only, ZCode's semantics** — first sighting is a baseline, only
 *    `running true → false` completes, and a run that just errored is
 *    reported as a failure, not also as a completion.
 * 2. **The dedupe window** — one notification per `kind:target` inside 3
 *    seconds; different interactions inside the window still announce each,
 *    which is what approval/question keying buys.
 * 3. **The focus heartbeat** — a fresh `focused` ping suppresses, a `blurred`
 *    ping un-suppresses immediately, and a heartbeat that stopped (browser
 *    closed, page crashed) expires back into notifying.
 *
 * The settings file and the toast script are asserted at their seams too:
 * the toggles' save/restore folding, and the PowerShell the dispatcher
 * actually hands out (XML escaping, silent audio, the optional sound and
 * launch blocks).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

// NOTIFY_STATE_PATH is derived from homedir() when the module is evaluated,
// so point HOME at a scratch directory *before* the dynamic import below.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-notify-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = process.env.HOME // Windows: homedir() 读 USERPROFILE 而非 HOME
const notifyStatePath = join(scratchHome, '.dsh', 'smkit-notify.json')

const {
  createNotifyOrchestrator,
  createNotifyBroadcaster,
  loadNotifySettings,
  saveNotifySettings,
  normalizeToggle,
  normalizeDuration,
  nextSettings,
  buildToastScript,
  DEFAULT_NOTIFY_SETTINGS,
} = await import('../lib/index.js')
after(() => rmSync(scratchHome, { recursive: true, force: true }))

const quietLogger = { info() {}, warn() {}, error() {} }

/** A clock the tests move: `t` is milliseconds since an arbitrary zero. */
function makeClock(start = 10_000) {
  const clock = { t: start }
  clock.now = () => clock.t
  clock.advance = (ms) => {
    clock.t += ms
  }
  return clock
}

describe('notify orchestrator: status edges', () => {
  it('first sighting is a baseline, not an event', () => {
    const clock = makeClock()
    const o = createNotifyOrchestrator({ now: clock.now })
    assert.equal(o.observeStatus('s1', false), null, 'first sighting, idle')
    clock.advance(4_000)
    assert.equal(o.observeStatus('s1', false), null, 'staying idle repeats nothing')
    assert.equal(o.observeStatus('s2', true), null, 'first sighting, running — still a baseline')
    clock.advance(4_000)
    assert.equal(o.observeStatus('s2', false)?.kind, 'completed', 'a run in flight when first seen announces its end')
  })

  it('notifies on the true→false edge and not on starts or repeats', () => {
    const clock = makeClock()
    const o = createNotifyOrchestrator({ now: clock.now })
    assert.equal(o.observeStatus('s1', true), null)
    clock.advance(4_000)
    const done = o.observeStatus('s1', false)
    assert.equal(done?.kind, 'completed')
    assert.equal(done?.title, '任务已完成')
    assert.equal(o.observeStatus('s1', false), null, 'staying idle repeats nothing')
    clock.advance(4_000)
    assert.equal(o.observeStatus('s1', true), null, 'a start never announces')
    clock.advance(4_000)
    assert.equal(o.observeStatus('s1', false)?.kind, 'completed')
  })

  it('a run that just errored is a failure, not also a completion', () => {
    const clock = makeClock()
    const o = createNotifyOrchestrator({ now: clock.now })
    assert.equal(o.observeStatus('s1', true), null)
    clock.advance(4_000)
    const failed = o.observeError('s1', 'boom: provider 500')
    assert.equal(failed?.kind, 'failed')
    assert.equal(failed?.title, '任务出错')
    assert.equal(failed?.body, 'boom: provider 500')
    clock.advance(1_000)
    assert.equal(o.observeStatus('s1', false), null, 'the following idle is quiet inside the error gap')
    clock.advance(40_000)
    assert.equal(o.observeStatus('s1', false), null, 'no new edge — staying idle repeats nothing')
  })

  it('the completed body names the workspace when one was reported', () => {
    const clock = makeClock()
    const o = createNotifyOrchestrator({ now: clock.now })
    o.observeSessionAdded({ sessionId: 's1', cwd: 'E:\\AI\\dsh-smkit' })
    assert.equal(o.observeStatus('s1', true), null)
    clock.advance(4_000)
    assert.equal(o.observeStatus('s1', false)?.body, '工作区：dsh-smkit')
  })

  it('subagent sessions stay quiet for terminal states but not for approvals', () => {
    const clock = makeClock()
    const o = createNotifyOrchestrator({ now: clock.now })
    o.observeSessionAdded({ sessionId: 'sub', origin: 'subagent' })
    assert.equal(o.observeStatus('sub', true), null)
    clock.advance(4_000)
    assert.equal(o.observeStatus('sub', false), null)
    clock.advance(4_000)
    assert.equal(o.observeError('sub', 'x'), null)
    const asked = o.observeApproval({ agent: { id: 'sub' }, toolName: 'write_file' })
    assert.equal(asked?.kind, 'permission', 'an approval blocks the run wherever the agent sits')
  })

  it('session removal drops the tracking row', () => {
    const clock = makeClock()
    const o = createNotifyOrchestrator({ now: clock.now })
    assert.equal(o.observeStatus('s1', true), null)
    o.observeSessionRemoved('s1')
    clock.advance(4_000)
    assert.equal(o.observeStatus('s1', false), null, 'an unknown session re-baselines')
  })
})

describe('notify orchestrator: the dedupe window', () => {
  it('one notification per kind:target inside the window, fresh ones after', () => {
    const clock = makeClock()
    const o = createNotifyOrchestrator({ now: clock.now })
    const first = o.observeApproval({ agent: { id: 's1' }, toolName: 'edit_file', reason: 'needs approval' })
    assert.equal(first?.dedupeKey, 'permission_request:s1:edit_file')
    assert.equal(o.observeApproval({ agent: { id: 's1' }, toolName: 'edit_file' }), null)
    const other = o.observeApproval({ agent: { id: 's1' }, toolName: 'bash' })
    assert.equal(other?.kind, 'permission', 'a different interaction announces even inside the window')
    clock.advance(3_001)
    assert.equal(o.observeApproval({ agent: { id: 's1' }, toolName: 'edit_file' })?.kind, 'permission')
  })

  it('approval copy prefers the reason and falls back to the tool', () => {
    const clock = makeClock()
    const o = createNotifyOrchestrator({ now: clock.now })
    assert.equal(o.observeApproval({ agent: { id: 's1' }, toolName: 'edit_file', reason: '工作区外写入' })?.body, '工作区外写入')
    clock.advance(3_001)
    assert.equal(o.observeApproval({ agent: { id: 's1' }, toolName: 'edit_file' })?.body, '工具：edit_file')
  })

  it('questions dedupe on the caller question id; plan review gets its own copy', () => {
    const clock = makeClock()
    const o = createNotifyOrchestrator({ now: clock.now })
    const plan = o.observeQuestion({
      agent: { id: 's1' },
      questions: [{ id: 'q1', question: '这样继续吗', intent: { kind: 'plan-review' } }],
    })
    assert.equal(plan?.title, '计划等待确认')
    assert.equal(plan?.body, '请确认计划后继续执行')
    clock.advance(3_001)
    const ask = o.observeQuestion({
      agent: { id: 's1' },
      questions: [{ id: 'q2', question: '选哪个数据库？' }],
    })
    assert.equal(ask?.title, '需要你的回复')
    assert.equal(ask?.body, '选哪个数据库？')
    assert.equal(o.observeQuestion({ agent: { id: 's1' }, questions: [{ id: 'q2', question: '选哪个数据库？' }] }), null)
  })
})

describe('notify orchestrator: the focus heartbeat', () => {
  it('a fresh focused heartbeat suppresses; blurred ends it; staleness expires it', () => {
    const clock = makeClock()
    const o = createNotifyOrchestrator({ now: clock.now })
    assert.equal(o.isSuppressed(), false, 'no page ever reported: notify')
    o.touchHeartbeat('focused')
    assert.equal(o.isSuppressed(), true)
    clock.advance(7_000)
    assert.equal(o.isSuppressed(), true, 'still fresh inside the window')
    clock.advance(2_000)
    assert.equal(o.isSuppressed(), false, 'a page that died without a goodbye expires')
    o.touchHeartbeat('focused')
    o.touchHeartbeat('blurred')
    assert.equal(o.isSuppressed(), false, 'the blur ends suppression at once')
  })
})

describe('notify settings', () => {
  it('defaults on, round-trips, and restores on garbage', () => {
    assert.deepEqual(loadNotifySettings(), DEFAULT_NOTIFY_SETTINGS)
    saveNotifySettings({ enabled: false, soundEnabled: true, duration: 'reminder' })
    assert.deepEqual(loadNotifySettings(), { enabled: false, soundEnabled: true, duration: 'reminder' })
    writeFileSync(notifyStatePath, '{not json')
    assert.deepEqual(loadNotifySettings(), DEFAULT_NOTIFY_SETTINGS)
  })

  it('normalizeToggle: booleans pass, null restores, garbage keeps', () => {
    assert.equal(normalizeToggle(false, true), false)
    assert.equal(normalizeToggle(null, false), true)
    assert.equal(normalizeToggle('yes', true), true)
  })

  it('normalizeDuration: spelled words pass, null restores, garbage keeps', () => {
    assert.equal(normalizeDuration('long', 'short'), 'long')
    assert.equal(normalizeDuration('reminder', 'short'), 'reminder')
    assert.equal(normalizeDuration(null, 'reminder'), 'short')
    assert.equal(normalizeDuration('forever', 'short'), 'short')
    assert.equal(normalizeDuration(25, 'short'), 'short')
  })

  it('nextSettings folds a PATCH-shaped body onto the current values', () => {
    const current = { enabled: true, soundEnabled: true, duration: 'short' }
    assert.deepEqual(nextSettings({ enabled: false }, current), { enabled: false, soundEnabled: true, duration: 'short' })
    assert.deepEqual(nextSettings({ enabled: null }, { enabled: false, soundEnabled: true, duration: 'short' }), {
      enabled: true,
      soundEnabled: true,
      duration: 'short',
    })
    assert.deepEqual(nextSettings({ soundEnabled: 'nope' }, current), current)
    assert.deepEqual(nextSettings({}, current), current)
  })

  it('nextSettings folds the duration: words pass, null restores, garbage keeps', () => {
    const current = { enabled: true, soundEnabled: true, duration: 'short' }
    assert.equal(nextSettings({ duration: 'reminder' }, current).duration, 'reminder')
    assert.equal(nextSettings({ duration: 'long' }, current).duration, 'long')
    assert.equal(nextSettings({ duration: null }, current).duration, 'short')
    assert.equal(nextSettings({ duration: 'forever' }, current).duration, 'short')
    assert.equal(nextSettings({ duration: 25 }, current).duration, 'short')
  })
})

describe('notify broadcaster', () => {
  /** A minimal ServerResponse double: records writes, remembers listeners. */
  function makeRes() {
    const res = {
      code: 0,
      headers: {},
      written: [],
      listeners: {},
      writeHead(code, headers) {
        res.code = code
        res.headers = headers
      },
      write(chunk) {
        res.written.push(chunk)
        return true
      },
      end() {},
      on(event, listener) {
        ;(res.listeners[event] ??= []).push(listener)
        return res
      },
      emitClose() {
        for (const listener of res.listeners.close ?? []) listener()
      },
    }
    return res
  }

  const DECISION = { kind: 'completed', title: '任务已完成', body: '工作区：x', dedupeKey: 'completed:s1' }

  it('adopts a stream with SSE headers and a hello, and pushes identical frames to every client', () => {
    const o = createNotifyBroadcaster(quietLogger)
    const a = makeRes()
    o.connect(a)
    assert.equal(a.code, 200)
    assert.equal(a.headers['Content-Type'], 'text/event-stream; charset=utf-8')
    assert.match(a.written[0], /^retry: 3000/)
    assert.match(a.written[1], /"type":"hello"/)

    const b = makeRes()
    o.connect(b)
    assert.equal(o.size(), 2)
    o.broadcast(DECISION, true)
    const frameA = a.written.at(-1)
    assert.match(frameA, /^data: /)
    assert.deepEqual(JSON.parse(frameA.replace(/^data: /, '').trim()), {
      type: 'notify',
      kind: 'completed',
      title: '任务已完成',
      body: '工作区：x',
      dedupeKey: 'completed:s1',
      sound: true,
    })
    assert.equal(b.written.at(-1), frameA, 'every connected page sees the same frame')
  })

  it('drops a client on close and stops writing to it', () => {
    const o = createNotifyBroadcaster(quietLogger)
    const a = makeRes()
    const b = makeRes()
    o.connect(a)
    o.connect(b)
    a.emitClose()
    assert.equal(o.size(), 1)
    o.broadcast(DECISION, false)
    assert.equal(a.written.length, 2, 'the closed connection receives nothing more')
    assert.equal(b.written.length, 3)
    assert.equal(JSON.parse(b.written.at(-1).replace(/^data: /, '').trim()).sound, false)
  })

  it('a forced frame carries the flag; a normal one omits it', () => {
    const o = createNotifyBroadcaster(quietLogger)
    const a = makeRes()
    o.connect(a)
    o.broadcast(DECISION, true, true)
    assert.equal(JSON.parse(a.written.at(-1).replace(/^data: /, '').trim()).force, true)
    o.broadcast(DECISION, true)
    assert.equal('force' in JSON.parse(a.written.at(-1).replace(/^data: /, '').trim()), false)
  })

  it('a frame without a body omits the key entirely', () => {
    const o = createNotifyBroadcaster(quietLogger)
    const a = makeRes()
    o.connect(a)
    o.broadcast({ kind: 'failed', title: '任务出错', dedupeKey: 'failed:s1' }, true)
    const parsed = JSON.parse(a.written.at(-1).replace(/^data: /, '').trim())
    assert.equal('body' in parsed, false)
  })
})

describe('buildToastScript', () => {
  it('escapes XML, keeps the toast silent, and makes the sound and launch blocks optional', () => {
    const script = buildToastScript({
      title: '任务<完成>&了',
      body: '工作区："smkit"',
      soundFile: 'C:\\mp3\\pop.mp3',
      launchUrl: 'http://127.0.0.1:9316',
    })
    assert.match(script, /任务&lt;完成&gt;&amp;了/)
    assert.match(script, /工作区：&quot;smkit&quot;/)
    assert.match(script, /<audio silent="true"\/>/)
    assert.match(script, /activationType="protocol" launch="http:\/\/127\.0\.0\.1:9316"/)
    assert.match(script, /type mpegvideo alias smkitpop/)
    assert.match(script, /CreateToastNotifier\('\{1AC14E77/)

    const silent = buildToastScript({ title: 't' })
    assert.doesNotMatch(silent, /mpegvideo/)
    assert.doesNotMatch(silent, /activationType=/)
    assert.doesNotMatch(silent, /scenario=/)
    assert.doesNotMatch(silent, /duration=/)
    assert.match(silent, /<text>t<\/text>/)
  })

  it('duration: long marks the attribute, reminder pins and must bring buttons', () => {
    const long = buildToastScript({ title: 't', duration: 'long' })
    assert.match(long, /<toast duration="long">/)
    assert.doesNotMatch(long, /<actions>/)

    const pinned = buildToastScript({ title: 't', duration: 'reminder', launchUrl: 'http://127.0.0.1:9316' })
    assert.match(pinned, /<toast activationType="protocol" launch="http:\/\/127\.0\.0\.1:9316" scenario="reminder">/)
    // The reminder scenario requires at least one action, or Windows silently
    // downgrades the toast to a normal one.
    assert.match(pinned, /<actions>/)
    assert.match(pinned, /<action content="打开 dsh" activationType="protocol" arguments="http:\/\/127\.0\.0\.1:9316"\/>/)
    assert.match(pinned, /<action content="知道了" activationType="system" arguments="dismiss"\/>/)

    // No origin reported yet: the dismiss button alone satisfies the contract.
    const pinnedNoUrl = buildToastScript({ title: 't', duration: 'reminder' })
    assert.match(pinnedNoUrl, /<action content="知道了" activationType="system" arguments="dismiss"\/>/)
    assert.doesNotMatch(pinnedNoUrl, /打开 dsh/)
  })
})

describe('notify sound asset', () => {
  it('ships the real mp3 and the generated module agrees with it', async () => {
    const asset = new URL('../src/host/features/notify/assets/task-notification-pop.mp3', import.meta.url)
    assert.equal(existsSync(asset), true, 'the provenance asset is committed')
    const { TASK_NOTIFICATION_SOUND_BASE64 } = await import('../lib/host/features/notify/sound-data.js')
    const decoded = Buffer.from(TASK_NOTIFICATION_SOUND_BASE64.replace(/\s+/g, ''), 'base64')
    assert.deepEqual(decoded, readFileSync(asset), 'the embedded bytes are the asset, verbatim')
  })
})
