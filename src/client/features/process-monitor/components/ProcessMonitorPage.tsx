/**
 * The process monitor page: one poll, one overview band, one grouped table.
 *
 * Everything about the page follows one rule the rest of this plugin already
 * lives by: the shell unmounts a `main` panel the moment the reader looks
 * somewhere else, so "mounted" is the only lifecycle the page needs — the
 * interval starts in an effect, the effect's cleanup stops it, and a closed
 * page costs the host exactly nothing (the host samples per request; see the
 * feature's `api.ts`). The one extra this page adds over its siblings is the
 * hidden-tab pause: the web profile keeps a background tab mounted, and
 * sampling a dashboard nobody can see is the cost this feature exists to
 * avoid.
 *
 * The page keeps a one-minute rolling history of its four headline numbers
 * (nothing else, never persisted — yesterday's trend line would be a claim
 * about windows nobody can verify) purely to draw the KPI sparklines; the
 * bars and rows always render the live sample alone.
 */

import {
  PROCESS_MONITOR_SAMPLE_PATH,
  SAMPLE_INTERVAL_MS,
} from '../../../../shared/process-monitor/contract'
import type {
  ProcessEntryKind,
  ProcessEntryView,
  ProcessMonitorSample,
} from '../../../../shared/process-monitor/contract'
import type { ClientDeps, Translator } from '../../../platform/types'
import { createGaugeIcon } from '../icons/GaugeIcon'

/** How many samples the KPI sparklines keep — one minute at the page's cadence. */
const HISTORY_CAP = 60

/** CPU% heat bands for the row bars: one busy core and a quarter of the machine. */
const HEAT_MID = 5
const HEAT_HIGH = 25

/** Kind → the label its row dot carries (the old group names, now per row). */
const KIND_LABEL: Record<ProcessEntryKind, string> = {
  host: 'groupHost',
  mcp: 'groupMcp',
  other: 'groupOther',
  app: 'groupApp',
}

/** How deep a ppid chain is still a tree: the same guard the report keeps. */
const MAX_TREE_DEPTH = 12

/** One rendered line: the process, its indent, and how many children hang off it. */
interface TreeRow {
  entry: ProcessEntryView
  depth: number
  children: number
}

/** Sibling order: CPU desc, then memory desc, then pid — nulls last. */
function compareRows(a: ProcessEntryView, b: ProcessEntryView): number {
  const aCpu = a.cpuPct ?? -1
  const bCpu = b.cpuPct ?? -1
  if (aCpu !== bCpu) return bCpu - aCpu
  if (a.memBytes !== b.memBytes) return b.memBytes - a.memBytes
  return a.pid - b.pid
}

/**
 * Flatten the pid/ppid edges of both scopes into one table order: depth-first,
 * parent before child, a collapsed pid not descending.
 *
 * The two scopes arrive as two lists — the host's subtree and the application
 * group — but they are one process tree, so they are joined here rather than
 * shown in separate tables: the app's GUI main process is the host's parent,
 * its renderer is the host's sibling, and a reader who has to reconstruct that
 * from three flat blocks is looking at exactly the confusion a tree removes.
 * A row whose parent is not in either list is a root; so is a row left
 * unreachable by a pid loop, which must not silently disappear.
 */
function flattenTree(rows: ProcessEntryView[], collapsed: Record<string, boolean>): TreeRow[] {
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const childrenOf = new Map<number, ProcessEntryView[]>()
  const roots: ProcessEntryView[] = []
  for (const row of rows) {
    const parent = row.pid === row.ppid ? undefined : byPid.get(row.ppid)
    if (parent === undefined) {
      roots.push(row)
      continue
    }
    const siblings = childrenOf.get(row.ppid)
    if (siblings === undefined) childrenOf.set(row.ppid, [row])
    else siblings.push(row)
  }

  // Reachability first, collapse second. A pid loop (A's parent is B and B's
  // is A) leaves rows no root can reach, and those must still be shown — but a
  // collapsed branch is hidden *on purpose* and must not be mistaken for one,
  // so "which rows exist" is answered before any twisty is consulted.
  const reachable = new Set<number>()
  const mark = (list: ProcessEntryView[], depth: number): void => {
    for (const row of list) {
      if (reachable.has(row.pid) || depth > MAX_TREE_DEPTH) continue
      reachable.add(row.pid)
      mark(childrenOf.get(row.pid) ?? [], depth + 1)
    }
  }
  mark(roots, 0)
  for (const row of rows) {
    if (reachable.has(row.pid)) continue
    roots.push(row)
    mark([row], 0)
  }

  const out: TreeRow[] = []
  const shown = new Set<number>()
  const walk = (list: ProcessEntryView[], depth: number): void => {
    list.sort(compareRows)
    for (const row of list) {
      if (shown.has(row.pid) || depth > MAX_TREE_DEPTH) continue
      shown.add(row.pid)
      const kids = childrenOf.get(row.pid) ?? []
      out.push({ entry: row, depth, children: kids.length })
      if (kids.length > 0 && collapsed[row.pid] !== true) walk(kids, depth + 1)
    }
  }
  walk(roots, 0)
  return out
}

/** `0.5` → "0.5%", null → "—" (the first sample after a gap has no window). */
function formatPct(value: number | null, dash: string): string {
  return value === null || !Number.isFinite(value) ? dash : `${value.toFixed(1)}%`
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

/**
 * The memory figure to print: the dedicated working set where the OS reports
 * one (Windows — Task Manager's own column), the plain working set otherwise.
 */
function memoryOf(row: { memBytes: number; memPrivateBytes?: number }): number {
  return row.memPrivateBytes ?? row.memBytes
}

function formatCpuMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

/** One number's KPI cell: big value, small unit, and the sparkline it earned. */
interface KpiCard {
  key: string
  label: string
  value: string
  kind: 'tree' | 'host'
  /** The hover line that says what the number counts, so the total never has to be guessed. */
  hint: string
}

export function createProcessMonitorPage(
  deps: ClientDeps,
  boundT: Translator,
): (props: { t?: Translator }) => JSX.Element {
  const { h, react, api } = deps
  const MeterIcon = createGaugeIcon(deps)

  /** The rolling sparkline for one headline number, as an inline `<svg>`. */
  const sparkline = (values: number[], className: string): JSX.Element | null => {
    if (values.length < 2) return null
    let min = Math.min(...values)
    let max = Math.max(...values)
    if (max - min < 1e-9) max = min + 1
    const points = values
      .map(
        (value, at) =>
          `${((at / (values.length - 1)) * 64).toFixed(1)},${(18 - ((value - min) / (max - min)) * 16).toFixed(1)}`,
      )
      .join(' ')
    return h(
      'svg',
      {
        width: 64,
        height: 20,
        viewBox: '0 0 64 20',
        className: `smkit-pm-page-spark smkit-pm-page-spark-${className}`,
        'aria-hidden': 'true',
      },
      h('polyline', { points, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, opacity: 0.85 }),
    )
  }

  return function ProcessMonitorPage(props: { t?: Translator }): JSX.Element {
    // The slot hands the registration's namespace-bound translator down as
    // `t`; the closure's is the same function, kept as the fallback a harness
    // that renders the component directly would need.
    const t = props?.t ?? boundT
    const dash = t('noValue')

    const [sample, setSample] = react.useState<ProcessMonitorSample | null>(null)
    const [visible, setVisible] = react.useState(true)
    const [collapsed, setCollapsed] = react.useState<Record<string, boolean>>({})
    // An in-flight guard box, held by `useState`'s kept-by-reference initial
    // value — the platform's ReactLike has no `useRef`, and this is the ref.
    const guard = react.useState({ busy: false })[0]
    /** One minute of headline numbers for the sparklines; never persisted. */
    const [history, setHistory] = react.useState<{
      treeCpu: number[]
      treeMem: number[]
      hostCpu: number[]
      hostMem: number[]
    }>({ treeCpu: [], treeMem: [], hostCpu: [], hostMem: [] })

    // The web profile keeps a hidden tab mounted; stop the clock while the
    // page cannot be seen. Desktop panel switches unmount the page instead,
    // and the Node harness has no `document` at all — both stay "visible".
    react.useEffect(() => {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
        return undefined
      }
      const onChange = (): void => setVisible(document.visibilityState === 'visible')
      document.addEventListener('visibilitychange', onChange)
      return () => document.removeEventListener('visibilitychange', onChange)
    }, [])

    const refresh = react.useCallback(() => {
      if (guard.busy) return
      guard.busy = true
      api(PROCESS_MONITOR_SAMPLE_PATH)
        .then((result) => {
          guard.busy = false
          if (result.ok) {
            const next = result.body as unknown as ProcessMonitorSample
            setSample(next)
            const host = (next.entries ?? []).find((entry) => entry.kind === 'host')
            setHistory((prev) => ({
              treeCpu: [...prev.treeCpu, next.totals.cpuPct].slice(-HISTORY_CAP),
              treeMem: [...prev.treeMem, memoryOf(next.totals) / (1024 * 1024)].slice(-HISTORY_CAP),
              hostCpu: [...prev.hostCpu, host?.cpuPct ?? 0].slice(-HISTORY_CAP),
              hostMem: [...prev.hostMem, (host === null || host === undefined ? 0 : memoryOf(host)) / (1024 * 1024)].slice(-HISTORY_CAP),
            }))
          }
        })
        .catch(() => {
          guard.busy = false
        })
    }, [])

    // One clock, owned by the mount: immediate read on becoming visible (a
    // remount or a tab coming back), one read per second while it stays so,
    // and nothing at all once unmounted or hidden.
    react.useEffect(() => {
      if (!visible) return undefined
      refresh()
      const timer = setInterval(refresh, SAMPLE_INTERVAL_MS)
      return () => clearInterval(timer)
    }, [refresh, visible])

    const entries = sample?.entries ?? []
    const host = entries.find((entry) => entry.kind === 'host') ?? null
    const hasMcpGroup = entries.some((entry) => entry.kind === 'mcp')
    // The application group is a *different scope*, not a fourth kind of
    // child: its rows are the GUI processes Windows Task Manager folds into
    // the app's one line. They share the table with the subtree because they
    // share the tree — see `flattenTree`.
    const app = sample?.app ?? null
    // Every row the sample carries — the subtree plus the app group, which by
    // construction share no pid. The header counts this, not the rendered
    // lines: collapsing a branch hides rows, it does not stop sampling them.
    const rows = [...entries, ...(app?.entries ?? [])]
    const tree = flattenTree(rows, collapsed)

    const toggle = (pid: number): void => {
      setCollapsed({ ...collapsed, [pid]: !collapsed[pid] })
    }

    const warming = sample?.warmingUp === true
    const liveKey = warming ? 'liveStarting' : visible ? 'live' : 'paused'

    const cards: KpiCard[] = [
      { key: 'treeCpu', label: t('cardTreeCpu'), value: formatPct(sample?.totals.cpuPct ?? null, dash), kind: 'tree', hint: t('totalHint') },
      {
        key: 'treeMem',
        label: t('cardTreeMem'),
        value: formatBytes(sample === null ? 0 : memoryOf(sample.totals)),
        kind: 'tree',
        hint: `${t('totalHint')} ${t('memHint')}`,
      },
      { key: 'hostCpu', label: t('cardHostCpu'), value: formatPct(host?.cpuPct ?? null, dash), kind: 'host', hint: t('hostHint') },
      {
        key: 'hostMem',
        label: t('cardHostMem'),
        value: formatBytes(host === null ? 0 : memoryOf(host)),
        kind: 'host',
        hint: `${t('hostHint')} ${t('memHint')}`,
      },
    ]
    const sparks: Record<string, number[]> = {
      treeCpu: history.treeCpu,
      treeMem: history.treeMem,
      hostCpu: history.hostCpu,
      hostMem: history.hostMem,
    }

    const notice: string | null =
      sample === null
        ? t('loading')
        : warming
          ? t('warmingUp')
          : typeof sample.error === 'string' && sample.error !== ''
            ? t('sampleFailed', { error: sample.error })
            : entries.length === 0
              ? t('empty')
              : null

    const row = ({ entry, depth, children }: TreeRow): JSX.Element => {
      const pct = entry.cpuPct
      const heat = pct === null ? 'none' : pct >= HEAT_HIGH ? 'high' : pct >= HEAT_MID ? 'mid' : 'low'
      const width = pct === null || pct <= 0 ? '0%' : `${Math.min(100, Math.max(0.75, pct))}%`
      const [value, unit] = formatBytes(memoryOf(entry)).split(' ')
      const memTitle =
        entry.memPrivateBytes === undefined ? undefined : t('memWsTitle', { mem: formatBytes(entry.memBytes) })
      const open = collapsed[entry.pid] !== true
      return h(
        'div',
        {
          className: 'smkit-pm-page-row',
          key: entry.pid,
          'data-smkit-heat': heat,
          'data-smkit-kind': entry.kind,
        },
        h(
          'span',
          { className: 'smkit-pm-page-name', title: entry.cmdline, style: { paddingLeft: `${depth * 14}px` } },
          children > 0
            ? h(
                'button',
                {
                  className: 'smkit-pm-page-twist',
                  key: 'twist',
                  type: 'button',
                  title: t(open ? 'collapseChildren' : 'expandChildren', { count: children }),
                  'aria-expanded': open,
                  onClick: () => toggle(entry.pid),
                },
                open ? '▾' : '▸',
              )
            : h('span', {
                className: 'smkit-pm-page-twist smkit-pm-page-twist-leaf',
                key: 'twist',
                'aria-hidden': 'true',
              }),
          h('i', {
            className: `smkit-pm-page-kind smkit-pm-page-dot-${entry.kind}`,
            key: 'kind',
            title: t(KIND_LABEL[entry.kind]),
          }),
          h('b', { className: 'smkit-pm-page-name-text', key: 'n' }, entry.name),
          entry.mcpServer !== undefined
            ? h('span', { className: 'smkit-pm-page-tag', key: 'tag' }, `mcp:${entry.mcpServer}`)
            : null,
        ),
        h('span', { className: 'smkit-pm-page-pid', key: 'pid' }, entry.pid),
        h(
          'span',
          { className: 'smkit-pm-page-cpu', key: 'cpu' },
          h('span', { className: 'smkit-pm-page-cpu-track', key: 't' }, h('i', { className: 'smkit-pm-page-cpu-fill', style: { width }, key: 'f' })),
          h('b', { className: pct === null ? 'smkit-pm-page-cpu-none' : '', key: 'v' }, formatPct(pct, dash)),
        ),
        h(
          'span',
          { className: 'smkit-pm-page-mem', title: memTitle, key: 'mem' },
          value,
          unit !== undefined ? h('small', { key: 'u' }, unit) : null,
        ),
        h('span', { className: 'smkit-pm-page-time', key: 'time' }, formatCpuMs(entry.cpuMs)),
        h(
          'span',
          { className: 'smkit-pm-page-cmd', title: entry.cmdline, key: 'cmd' },
          entry.cmdline,
        ),
      )
    }

    const cols = (
      <div className="smkit-pm-page-cols" aria-hidden="true">
        <span>{t('colProcess')}</span>
        <span>{t('colPid')}</span>
        <span>{t('colCpu')}</span>
        <span>{t('colMem')}</span>
        <span>{t('colCpuTime')}</span>
        <span>{t('colCmdline')}</span>
      </div>
    )

    return (
      <div className="smkit-pm-page">
        <div className="smkit-pm-page-head">
          <h2 className="smkit-pm-page-title">{t('pageTitle')}</h2>
          <span className="smkit-pm-page-live">
            <span className="smkit-pm-page-live-dot" />
            {t(liveKey)}
          </span>
          <span className="smkit-pm-page-head-meta">
            {t('metaLine', { count: rows.length, cores: sample?.cores ?? 0 })}
          </span>
          <span className="smkit-pm-page-spacer" aria-hidden="true" />
          <button className="smkit-ui-button" type="button" onClick={refresh}>
            {t('refresh')}
          </button>
        </div>
        {notice !== null ? <p className="smkit-pm-page-note">{notice}</p> : null}
        {/* The overview band is the four KPI cards alone: the composition
         * stacked bar this band opened with was cut after review — a mix of
         * three shares the reader cannot act on said less than the cards
         * already do. */}
        <div className="smkit-pm-page-kpis">
          {cards.map((card) => {
            const [value, unit] = card.value.split(' ')
              return h(
                'div',
                { className: `smkit-pm-page-kpi smkit-pm-page-kpi-${card.kind}`, key: card.key, title: card.hint },
                h('span', { className: 'smkit-pm-page-kpi-label', key: 'l' }, card.label),
              h(
                'span',
                { className: 'smkit-pm-page-kpi-value', key: 'v' },
                value,
                unit !== undefined ? h('small', { key: 'u' }, unit) : null,
              ),
              sparkline(sparks[card.key], card.kind),
            )
          })}
        </div>
        {tree.length > 0 ? (
          <div className="smkit-pm-page-table">
            {cols}
            {tree.map(row)}
          </div>
        ) : null}
        {notice === null && !hasMcpGroup ? (
          <p className="smkit-pm-page-hint">{t('emptyMcpHint')}</p>
        ) : null}
        {/* The reconciliation line: the number a reader takes to Task
         * Manager, labelled with the scope it counts and the memory metric
         * it does *not* share with that tool. */}
        {app !== null ? (
          <p className="smkit-pm-page-app" title={t('appScopeHint')}>
            {h('b', { key: 'label' }, t('appScopeLabel'))}
            <span>
              {app.totals.memPrivateBytes === undefined
                ? t('appScopeValueWs', {
                    count: app.totals.count,
                    cpu: formatPct(app.totals.cpuPct, dash),
                    mem: formatBytes(app.totals.memBytes),
                  })
                : t('appScopeValue', {
                    count: app.totals.count,
                    cpu: formatPct(app.totals.cpuPct, dash),
                    mem: formatBytes(app.totals.memPrivateBytes),
                    ws: formatBytes(app.totals.memBytes),
                  })}
            </span>
            <span>{t('appScopeSuffix')}</span>
          </p>
        ) : null}
        {sample?.meter != null ? (
          <p className="smkit-pm-page-meter">
            <MeterIcon size={14} className="smkit-pm-page-meter-icon" />
            {t('meterNotePrefix')}{' '}
            {h(
              'b',
              { key: 'v' },
              `${formatPct(sample.meter.cpuPct, dash)} · ${formatBytes(memoryOf(sample.meter))}`,
            )}
            {t('meterNoteSuffix', { count: sample.meter.count })}
          </p>
        ) : null}
      </div>
    )
  }
}
