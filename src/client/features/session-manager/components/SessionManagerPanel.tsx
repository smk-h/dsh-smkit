/**
 * The session-manager tab: the harness's sessions, grouped the way the
 * sidebar groups them, with the archive set one sub-tab away and a batch
 * delete over both.
 *
 * The data comes from the host's `GET /sessions/manager` — one answer carries
 * the workspaces (in registry order, with the accounting the sidebar groups
 * by), every visible session, and the archive set. The client's own session
 * store is deliberately not consulted: it knows the current selection, not
 * the whole corpus, and the manager's job is the corpus.
 *
 * **Active and archived are one population, split by the archive set.** A
 * session the user archived from the sidebar keeps its workspace accounting,
 * so the archived sub-tab shows it under the same workspace it lived in —
 * the split is a view, not a second list. Deleting from either sub-tab is
 * the same `POST /sessions/delete-batch`; the host runs its single-session
 * delete per id and publishes `api-session/removed` per success, which is
 * what makes the sidebar row disappear while the batch is still running —
 * no reload, and this panel's next poll confirms it.
 *
 * **Selection is per view, never across the split.** Switching sub-tabs
 * clears it, because a checkbox the user can no longer see must not ride
 * along to a delete they can no longer inspect; the confirm dialog captures
 * its rows at open time, so a poll that lands mid-delete cannot reshuffle
 * the facts the user is confirming. The list re-polls every few seconds (and
 * on the shared refresh button) — sessions do not churn fast, but the
 * archive set can move from the sidebar while this tab sits open.
 *
 * **Groups are the primary navigation, collapsed until asked.** A cleanup
 * page opens to the workspace ledger — one head per workspace, count and
 * group select-all visible, rows on demand — because the question "which
 * workspace am I cleaning" comes before "which session". A group head's own
 * checkbox selects that workspace whole: deleting one workspace's sessions
 * should not cost an expansion plus one click per row, and a collapsed group
 * keeps its selection when it closes again (the toolbar still reports it).
 *
 * A refused session is one line in the report, not a failed batch: a
 * mid-turn agent among fifty rows should not cost the forty-nine around it.
 */

import { createCheckIcon } from '../../../platform/icons/CheckIcon'
import { createChevronRightIcon } from '../../../platform/icons/ChevronRightIcon'
import { createFolderIcon } from '../../../platform/icons/FolderIcon'
import { createConfirmDialog } from '../../../platform/ui/ConfirmDialog'
import { createRefreshButton } from '../../../platform/ui/RefreshButton'
import type { SettingsShellGuard } from '../../../platform/ui/settings-shell'
import { createStateDot } from '../../../platform/ui/StateDot'
import { createTabs } from '../../../platform/ui/Tabs'
import { watchTipBoundaries } from '../../../platform/ui/tip'
import { useAsyncAction } from '../../../platform/ui/useAsyncAction'
import type { ApiResult, ClientDeps, Translator } from '../../../platform/types'
import type {
  ManagedSessionView,
  ManagedWorkspaceView,
  SessionBatchDeleteOutcome,
  SessionBatchDeleteReceipt,
  SessionManagerList,
} from '../../../../shared/session-delete/contract'

/** Props the merged section's shell hands every panel. */
export interface SessionManagerPanelProps {
  t: Translator
  /**
   * The settings-shell guard around a confirmed batch (see
   * `platform/ui/settings-shell`): whether the removal can trip the shell's
   * own close is only decidable before the request, so `arm` runs with the ids
   * about to go and `commit` after they have, with the ones that did.
   */
  onBatchDelete?: SettingsShellGuard
}

/** How often the panel re-reads the listing while it is mounted. */
const POLL_INTERVAL_MS = 5_000

/** The stable refusal codes `POST /sessions/delete` shares with the batch
 * form, and the dictionary key each reads as. An unknown code falls back to
 * the host's own message. */
const REFUSAL_KEYS: Record<string, string | undefined> = {
  'session/not-found': 'deleteSessionNotFound',
  'session/running': 'deleteSessionRunning',
  'session/attached': 'deleteSessionAttached',
  'session/subagent': 'deleteSessionSubagent',
  'session/unavailable': 'deleteSessionUnavailable',
}

/** One rendered workspace group: a registry workspace, or the ungrouped tail. */
interface SessionGroup {
  key: string
  title: string
  path: string | undefined
  ungrouped: boolean
  sessions: ManagedSessionView[]
}

/**
 * Group the sub-tab's sessions the sidebar would: one group per workspace in
 * registry order, sessions no listed workspace claims trailing in an
 * ungrouped group. Within a group, most recent activity first — the one
 * ordering a cleanup page needs, whatever order the accounting keeps.
 */
function groupSessions(
  sessions: readonly ManagedSessionView[],
  workspaces: readonly ManagedWorkspaceView[],
  t: Translator,
): SessionGroup[] {
  const buckets = new Map<string, ManagedSessionView[]>()
  const ungrouped: ManagedSessionView[] = []
  const known = new Set(workspaces.map((ws) => ws.workspaceId))
  for (const session of sessions) {
    const wsId = session.workspaceId !== undefined && known.has(session.workspaceId)
      ? session.workspaceId
      : ''
    const bucket = wsId === '' ? ungrouped : buckets.get(wsId)
    if (bucket === undefined) buckets.set(wsId, [session])
    else bucket.push(session)
  }
  const recency = (session: ManagedSessionView): number =>
    session.lastPromptAt ?? session.createdAt ?? 0
  const byRecency = (left: ManagedSessionView, right: ManagedSessionView): number =>
    recency(right) - recency(left)
  const groups: SessionGroup[] = []
  for (const ws of workspaces) {
    const bucket = buckets.get(ws.workspaceId)
    if (bucket === undefined) continue
    groups.push({
      key: ws.workspaceId,
      title: ws.title,
      path: ws.path,
      ungrouped: false,
      sessions: [...bucket].sort(byRecency),
    })
  }
  if (ungrouped.length > 0) {
    groups.push({
      key: '',
      title: t('ungrouped'),
      path: undefined,
      ungrouped: true,
      sessions: [...ungrouped].sort(byRecency),
    })
  }
  return groups
}

/** Format one byte count for a row or a summary, as the delete dialog spells
 * sizes. Units read the same in both dictionaries; `t` carries the copy. */
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = value < 10 ? value.toFixed(1) : String(Math.round(value))
  return `${rounded} ${units[unit]}`
}

/**
 * One instant as a row's meta reads it: a clock time today, a named day
 * yesterday, a date within the year, a full date beyond it. Hand-formatted
 * rather than `toLocaleString()` so a column of rows stays scannable and
 * tabular-nums does its job.
 */
function formatTime(ms: number | undefined, t: Translator): string {
  if (ms === undefined || !Number.isFinite(ms)) return ''
  const date = new Date(ms)
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days === 0) return hm
  if (days === 1) return `${t('timeYesterday')} ${hm}`
  const md = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return date.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${date.getFullYear()}-${md} ${hm}`
}

export function createSessionManagerPanel(
  deps: ClientDeps,
): (props: SessionManagerPanelProps) => JSX.Element {
  const { h, react, api, createPortal } = deps
  const ConfirmDialog = createConfirmDialog(deps)
  const RefreshButton = createRefreshButton(deps)
  const StateDot = createStateDot(deps)
  const Tabs = createTabs(deps)
  const FolderIcon = createFolderIcon(deps)
  const ChevronRightIcon = createChevronRightIcon(deps)
  const CheckIcon = createCheckIcon(deps)

  return function SessionManagerPanel({ t, onBatchDelete }: SessionManagerPanelProps): JSX.Element {
    const [list, setList] = react.useState<SessionManagerList | undefined>(undefined)
    const [loadError, setLoadError] = react.useState('')
    const [subtab, setSubtab] = react.useState<'active' | 'archived'>('active')
    const [selected, setSelected] = react.useState<readonly string[]>([])
    // Groups the user has opened. Absence reads as collapsed — the ledger view
    // is the default, and a workspace appearing from a poll starts folded.
    const [expanded, setExpanded] = react.useState<ReadonlySet<string>>(new Set())
    const [pending, setPending] = react.useState<ManagedSessionView[] | undefined>(undefined)
    const [report, setReport] = react.useState<{ deleted: number; failed: SessionBatchDeleteOutcome[] } | undefined>(undefined)
    const { busy, error, run } = useAsyncAction(react)

    /** Re-read the listing and drop selected ids the answer no longer knows. */
    const refresh = react.useCallback((): void => {
      void api('/sessions/manager').then((r: ApiResult) => {
        if (!r.ok) {
          setLoadError(t('refreshFailed', { status: r.status }))
          return
        }
        const body = r.body as SessionManagerList
        setList(body)
        setLoadError('')
        const known = new Set((body.sessions ?? []).map((s) => s.sessionId))
        setSelected((prev) => prev.filter((id) => known.has(id)))
      }).catch(() => {})
    }, [api, t])

    react.useEffect(() => {
      refresh()
      // The poll pauses while the confirm dialog is up or a delete is in
      // flight: the dialog's rows are already captured, and a refresh under a
      // running batch would only churn the list behind it.
      if (pending !== undefined || busy) return () => {}
      const timer = setInterval(refresh, POLL_INTERVAL_MS)
      return () => { clearInterval(timer) }
    }, [refresh, pending, busy])

    // The refresh button wears the shared bubble and sits at the toolbar's
    // right edge; one document-level watch serves every `.smkit-ui-tip` this
    // panel renders and keeps that bubble inside the panel (see
    // `platform/ui/tip`).
    react.useEffect(() => watchTipBoundaries(), [])

    const archived = new Set(list?.archivedSessionIds ?? [])
    const showArchived = subtab === 'archived'
    const sessions = list?.sessions ?? []
    const visible = sessions.filter((s) => archived.has(s.sessionId) === showArchived)
    const countOf = (archivedView: boolean): number =>
      sessions.filter((s) => archived.has(s.sessionId) === archivedView).length
    const groups = groupSessions(visible, list?.workspaces ?? [], t)

    const selectedVisible = visible.filter((s) => selected.includes(s.sessionId))
    const selectedCount = selectedVisible.length
    const selectedBytes = selectedVisible.reduce((sum, s) => sum + (s.sizeBytes ?? 0), 0)
    const allChecked = visible.length > 0 && selectedCount === visible.length
    const partialChecked = selectedCount > 0 && !allChecked

    const toggle = (sessionId: string): void => {
      setSelected((prev) => prev.includes(sessionId)
        ? prev.filter((id) => id !== sessionId)
        : [...prev, sessionId])
    }
    const toggleAll = (): void => {
      setSelected(allChecked ? [] : visible.map((s) => s.sessionId))
    }
    /** Fold or unfold one workspace group; the key survives polls and sub-tab
     * switches, so a group the user opened stays open until they close it. */
    const toggleExpanded = (key: string): void => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    }
    /** Check or clear one group whole: an all-selected group clears, a partly
     * or unselected one completes. Collapsed groups take this too — the head's
     * checkbox is the whole-workspace delete without expanding anything. */
    const toggleGroupAll = (group: SessionGroup): void => {
      const ids = group.sessions.map((s) => s.sessionId)
      setSelected((prev) => {
        const complete = ids.every((id) => prev.includes(id))
        return complete
          ? prev.filter((id) => !ids.includes(id))
          : [...prev, ...ids.filter((id) => !prev.includes(id))]
      })
    }
    const switchSubtab = (id: string): void => {
      setSubtab(id === 'archived' ? 'archived' : 'active')
      setSelected([])
      setReport(undefined)
    }

    const confirm = (): void => {
      void run(async () => {
        const ids = (pending ?? []).map((s) => s.sessionId)
        // Before the request: whether the viewed session is among these is only
        // readable now — once the removals land, its row is gone from the store.
        onBatchDelete?.arm(ids)
        const result = await api('/sessions/delete-batch', {
          method: 'POST',
          body: JSON.stringify({ sessionIds: ids }),
        })
        if (!result.ok) return t('batchFailed', { status: result.status })
        const receipt = result.body as SessionBatchDeleteReceipt
        // Only the ids the host actually removed: a refusal leaves its session
        // in place, so it cannot have moved the view the shell watches.
        const removed = receipt.results.filter((r) => r.ok).map((r) => r.sessionId)
        setReport({ deleted: receipt.deleted, failed: receipt.results.filter((r) => !r.ok) })
        setPending(undefined)
        setSelected([])
        refresh()
        onBatchDelete?.commit(removed)
      })
    }

    /** The host's line for one refused session, localized when the code is one
     * this dictionary names; the host's diagnostic stands in otherwise. */
    const refusalText = (outcome: SessionBatchDeleteOutcome): string => {
      const key = typeof outcome.code === 'string' ? REFUSAL_KEYS[outcome.code] : undefined
      if (key !== undefined) return t(key)
      return outcome.message ?? t('deleteSessionUnavailable')
    }

    // The confirm dialog's fact rows, captured at open time: what the user is
    // confirming must not be reshuffled by a poll arriving behind the dialog.
    const pendingRows = pending === undefined
      ? undefined
      : (
        <div className="smkit-sess-page-confirm-list">
          {pending.map((s) => (
            <div className="smkit-sess-page-confirm-row" key={s.sessionId}>
              <span className="smkit-sess-page-confirm-title" title={s.sessionId}>
                {s.title ?? s.cwd ?? s.sessionId}
              </span>
              <span className="smkit-sess-page-confirm-size">{formatBytes(s.sizeBytes) || '—'}</span>
            </div>
          ))}
        </div>
      )

    // The dialog is portaled to the body: the settings panel sits inside the
    // shell's own stacking and clipping layers, and a fixed overlay rendered
    // from there would ride those ancestors. Without react-dom it renders
    // inline — cramped, never broken.
    const dialog = pending === undefined
      ? null
      : (
        <ConfirmDialog
          title={t('confirmBatchTitle', { count: pending.length })}
          body={t('confirmBatchBody')}
          busy={busy}
          details={pendingRows}
          {...(error === '' ? {} : { error })}
          onCancel={() => { if (!busy) setPending(undefined) }}
          onConfirm={confirm}
        />
      )
    const overlay = dialog === null
      ? null
      : createPortal !== undefined && typeof document !== 'undefined'
        ? createPortal(dialog, document.body)
        : dialog

    /** One workspace group: the head ledger row (group select-all included),
     * then the indented session rows — only while the group is expanded. */
    const renderGroup = (group: SessionGroup): JSX.Element => {
      const open = expanded.has(group.key)
      const groupSelected = group.sessions.filter((s) => selected.includes(s.sessionId)).length
      const groupAll = group.sessions.length > 0 && groupSelected === group.sessions.length
      const groupPartial = groupSelected > 0 && !groupAll
      return (
        <div
          className="smkit-sess-page-group"
          key={group.key === '' ? ':ungrouped' : group.key}
          data-smkit-open={open ? 'true' : undefined}
        >
          <div className="smkit-sess-page-group-head" onClick={() => toggleExpanded(group.key)}>
            <label
              className="smkit-sess-page-check"
              data-smkit-on={groupAll ? 'true' : groupPartial ? 'partial' : undefined}
              onClick={(event) => event.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={groupAll}
                onChange={() => toggleGroupAll(group)}
                aria-label={t('groupSelectAll', { name: group.title })}
              />
              <span className="smkit-sess-page-check-box">
                {groupAll ? <CheckIcon size={10} /> : null}
              </span>
            </label>
            <button
              className="smkit-sess-page-group-chevron"
              type="button"
              aria-expanded={open}
              aria-label={t('groupToggle', { name: group.title })}
            >
              <ChevronRightIcon size={13} />
            </button>
            {group.ungrouped ? null : <FolderIcon size={14} />}
            <span className="smkit-sess-page-group-name">{group.title}</span>
            {group.path === undefined ? null : (
              <span className="smkit-sess-page-group-path" title={group.path}>{group.path}</span>
            )}
            <span className="smkit-sess-page-group-count">
              {t('sessionCount', { count: group.sessions.length })}
            </span>
          </div>
          {open
            ? group.sessions.map((s) => {
              const checked = selected.includes(s.sessionId)
              const name = s.title ?? s.cwd ?? t('untitledSession')
              const meta = [formatTime(s.lastPromptAt ?? s.createdAt, t), formatBytes(s.sizeBytes)]
                .filter((part) => part !== '')
                .join(' · ')
              return (
                <div className="smkit-sess-page-row" key={s.sessionId} data-smkit-selected={checked ? 'true' : undefined}>
                  <label className="smkit-sess-page-check" data-smkit-on={checked ? 'true' : undefined}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(s.sessionId)}
                      aria-label={name}
                    />
                    <span className="smkit-sess-page-check-box">{checked ? <CheckIcon size={10} /> : null}</span>
                  </label>
                  <span className="smkit-sess-page-row-title" title={s.title === undefined ? s.sessionId : s.title}>
                    {s.title ?? t('untitledSession')}
                  </span>
                  {meta === '' ? null : <span className="smkit-sess-page-row-meta">{meta}</span>}
                  <span className="smkit-sess-page-row-end">
                    {s.running
                      ? (
                        <span className="smkit-sess-page-badge">
                          <StateDot state="active" size={6} />
                          {t('badgeRunning')}
                        </span>
                      )
                      : null}
                  </span>
                </div>
              )
            })
            : null}
        </div>
      )
    }

    const reportLine = report === undefined
      ? null
      : report.failed.length === 0
        ? <p className="smkit-sess-page-result">{t('batchDone', { deleted: report.deleted })}</p>
        : (
          <div className="smkit-sess-page-result">
            {t('batchPartial', { deleted: report.deleted, failed: report.failed.length })}
            <div className="smkit-sess-page-result-list">
              {report.failed.map((outcome) => (
                <div key={outcome.sessionId}>{refusalText(outcome)}</div>
              ))}
            </div>
          </div>
        )

    return (
      <div className="smkit-sess-page-panel">
        <p className="smkit-sess-page-intro">{t('intro')}</p>
        <Tabs
          ariaLabel={t('subtabsLabel')}
          active={subtab}
          onChange={switchSubtab}
          tabs={[
            { id: 'active', label: t('subtabActive', { count: countOf(false) }) },
            { id: 'archived', label: t('subtabArchived', { count: countOf(true) }) },
          ]}
        />
        <div className="smkit-sess-page-toolbar">
          {/* Nothing to select, nothing to select with: an empty view renders
              no select-all at all. With rows, the word beside the box is the
              one sentence the toolbar needs: "select all" while the selection
              is empty, then what is selected — it is inside the label, so
              clicking it toggles like the box itself. */}
          {visible.length === 0 ? null : (
            <label
              className="smkit-sess-page-check smkit-sess-page-select-all"
              data-smkit-on={allChecked ? 'true' : partialChecked ? 'partial' : undefined}
            >
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                aria-label={selectedCount > 0
                  ? t('selectedSummary', { count: selectedCount, size: formatBytes(selectedBytes) })
                  : t('selectAll')}
              />
              <span className="smkit-sess-page-check-box">
                {allChecked ? <CheckIcon size={10} /> : null}
              </span>
              <span className="smkit-sess-page-check-label">
                {selectedCount > 0
                  ? t('selectedSummary', { count: selectedCount, size: formatBytes(selectedBytes) })
                  : t('selectAll')}
              </span>
            </label>
          )}
          <span className="smkit-sess-page-toolbar-spacer" />
          <RefreshButton onClick={refresh} disabled={busy} />
          <button
            className="smkit-ui-button danger"
            type="button"
            disabled={selectedCount === 0 || busy}
            onClick={() => setPending(selectedVisible)}
          >
            {t('deleteSelected', { count: selectedCount })}
          </button>
        </div>
        {loadError !== '' ? <p className="smkit-sess-page-result" data-smkit-kind="error">{loadError}</p> : null}
        {list !== undefined && visible.length === 0
          ? <p className="smkit-sess-page-note">{showArchived ? t('emptyArchived') : t('emptyActive')}</p>
          : groups.map(renderGroup)}
        {reportLine}
        {overlay}
      </div>
    )
  }
}
