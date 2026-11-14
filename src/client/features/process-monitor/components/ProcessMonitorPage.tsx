/**
 * The process monitor page: one poll, four cards, one grouped table.
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
 * State is per mount and deliberately not persisted: yesterday's CPU column
 * would be a lie about a window that no longer exists.
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

/** The groups, in display order; the host first, unknown children last. */
const GROUP_ORDER: ProcessEntryKind[] = ['host', 'mcp', 'other']

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

function formatCpuMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

export function createProcessMonitorPage(
  deps: ClientDeps,
  boundT: Translator,
): (props: { t?: Translator }) => JSX.Element {
  const { h, react, api } = deps

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
          if (result.ok) setSample(result.body as unknown as ProcessMonitorSample)
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
    const groups = GROUP_ORDER.map((kind) => ({
      id: kind,
      label: t(kind === 'host' ? 'groupHost' : kind === 'mcp' ? 'groupMcp' : 'groupOther'),
      rows: entries.filter((entry) => entry.kind === kind),
    })).filter((group) => group.rows.length > 0)

    const groupMeta = (rows: ProcessEntryView[]): string => {
      const counted = rows.filter((row) => row.cpuPct !== null)
      if (counted.length === 0) return t('countLabel', { count: rows.length })
      const sum = counted.reduce((total, row) => total + (row.cpuPct ?? 0), 0)
      return t('groupMeta', { count: rows.length, cpu: formatPct(Math.round(sum * 10) / 10, dash) })
    }

    const toggle = (id: string): void => {
      setCollapsed({ ...collapsed, [id]: !collapsed[id] })
    }

    const cards: Array<{ key: string; label: string; value: string }> = [
      { key: 'treeCpu', label: t('cardTreeCpu'), value: formatPct(sample?.totals.cpuPct ?? null, dash) },
      { key: 'treeMem', label: t('cardTreeMem'), value: formatBytes(sample?.totals.memBytes ?? 0) },
      { key: 'hostCpu', label: t('cardHostCpu'), value: formatPct(host?.cpuPct ?? null, dash) },
      { key: 'hostMem', label: t('cardHostMem'), value: formatBytes(host?.memBytes ?? 0) },
    ]

    const notice: string | null =
      sample === null
        ? t('loading')
        : sample.warmingUp === true
          ? t('warmingUp')
          : typeof sample.error === 'string' && sample.error !== ''
            ? t('sampleFailed', { error: sample.error })
            : entries.length === 0
              ? t('empty')
              : null

    const row = (entry: ProcessEntryView): JSX.Element =>
      h(
        'div',
        { className: 'smkit-pm-page-row', key: entry.pid },
        h(
          'span',
          { className: 'smkit-pm-page-cell smkit-pm-page-cell-name', title: entry.cmdline },
          entry.name,
          entry.mcpServerId !== undefined
            ? h('span', { className: 'smkit-pm-page-tag', key: 'tag' }, `mcp:${entry.mcpServerId}`)
            : null,
        ),
        h('span', { className: 'smkit-pm-page-cell smkit-pm-page-cell-pid', key: 'pid' }, entry.pid),
        h(
          'span',
          { className: 'smkit-pm-page-cell smkit-pm-page-cell-cpu', key: 'cpu' },
          formatPct(entry.cpuPct, dash),
        ),
        h(
          'span',
          { className: 'smkit-pm-page-cell smkit-pm-page-cell-mem', key: 'mem' },
          formatBytes(entry.memBytes),
        ),
        h(
          'span',
          { className: 'smkit-pm-page-cell smkit-pm-page-cell-time', key: 'time' },
          formatCpuMs(entry.cpuMs),
        ),
        h(
          'span',
          { className: 'smkit-pm-page-cell smkit-pm-page-cell-cmd', title: entry.cmdline, key: 'cmd' },
          entry.cmdline,
        ),
      )

    return (
      <div className="smkit-pm-page">
        <div className="smkit-pm-page-head">
          <h2 className="smkit-pm-page-title">{t('pageTitle')}</h2>
          <span className="smkit-pm-page-meta">
            {t('countLabel', { count: sample?.totals.count ?? 0 })} · {t('intervalLabel')}
          </span>
          <span className="smkit-pm-page-spacer" aria-hidden="true" />
          <button className="smkit-ui-button" type="button" onClick={refresh}>
            {t('refresh')}
          </button>
        </div>
        <p className="smkit-pm-page-intro">{t('pageIntro')}</p>
        {notice !== null ? <p className="smkit-pm-page-note">{notice}</p> : null}
        <div className="smkit-pm-page-cards">
          {cards.map((card) =>
            h(
              'div',
              { className: 'smkit-pm-page-card', key: card.key },
              h('span', { className: 'smkit-pm-page-card-value', key: 'v' }, card.value),
              h('span', { className: 'smkit-pm-page-card-label', key: 'l' }, card.label),
            ),
          )}
        </div>
        <div className="smkit-pm-page-body">
          {groups.map((group) =>
            h(
              'section',
              { className: 'smkit-pm-page-group', key: group.id },
              h(
                'button',
                {
                  className: 'smkit-pm-page-group-head',
                  type: 'button',
                  onClick: () => toggle(group.id),
                },
                h('span', { className: 'smkit-pm-page-group-toggle', key: 'c' }, collapsed[group.id] ? '▸' : '▾'),
                h('span', { className: 'smkit-pm-page-group-title', key: 't' }, group.label),
                h('span', { className: 'smkit-pm-page-group-meta', key: 'm' }, groupMeta(group.rows)),
              ),
              collapsed[group.id]
                ? null
                : h(
                    'div',
                    { className: 'smkit-pm-page-table', key: 'table' },
                    h(
                      'div',
                      { className: 'smkit-pm-page-row smkit-pm-page-row-head', key: 'head', 'aria-hidden': 'true' },
                      h('span', { className: 'smkit-pm-page-cell smkit-pm-page-cell-name', key: 'c1' }, t('colProcess')),
                      h('span', { className: 'smkit-pm-page-cell smkit-pm-page-cell-pid', key: 'c2' }, t('colPid')),
                      h('span', { className: 'smkit-pm-page-cell smkit-pm-page-cell-cpu', key: 'c3' }, t('colCpu')),
                      h('span', { className: 'smkit-pm-page-cell smkit-pm-page-cell-mem', key: 'c4' }, t('colMem')),
                      h('span', { className: 'smkit-pm-page-cell smkit-pm-page-cell-time', key: 'c5' }, t('colCpuTime')),
                      h('span', { className: 'smkit-pm-page-cell smkit-pm-page-cell-cmd', key: 'c6' }, t('colCmdline')),
                    ),
                    group.rows.map(row),
                  ),
            ),
          )}
          {notice === null && !hasMcpGroup ? (
            <p className="smkit-pm-page-hint">{t('emptyMcpHint')}</p>
          ) : null}
          {sample?.meter != null ? (
            <p className="smkit-pm-page-hint">
              {t('meterNote', {
                cpu: formatPct(sample.meter.cpuPct, dash),
                mem: formatBytes(sample.meter.memBytes),
                count: sample.meter.count,
              })}
            </p>
          ) : null}
        </div>
      </div>
    )
  }
}
