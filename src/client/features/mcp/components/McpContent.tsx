/**
 * The MCP panel of the merged settings section.
 *
 * One component drives five views (`list`, `add`, `edit-global`, `edit-ws`,
 * `advanced`) and
 * three API-surfaced data sets, re-polled every 3 seconds so a server that
 * reconnects on the host side updates its badge without a page reload.
 *
 * Each view keeps its own heading in the content (`smkit-mcp-section-catalog-heading`); the
 * three sub-views additionally mount a breadcrumb (`ui/Breadcrumb`) into the
 * settings shell's title strip through a portal — the list view is the trail's
 * root, and clicking it is the second way back besides the form's cancel
 * button.
 *
 * The list view opens with both counts on their own line; the page's identity
 * block (the intro line and the plugin pill) is the merged settings section's,
 * not this panel's. Below the heading, a toolbar row pairs the scope
 * picker on the left with the search box and the add button against the right
 * edge; the box rides the same row while it fits, and once a long workspace
 * name has pushed it onto a line of its own the picker takes the row it
 * cleared and the search fills the one it landed on. Which of those two looks
 * applies is read off the layout (`ui/rowWrap`) and marked on the row, because
 * a wrap is the one thing a stylesheet cannot see. The filter is a per-scope
 * map — one query per scope — and it filters whichever lists the selected
 * scope shows, so a workspace view can be narrowed down exactly like the
 * global one.
 *
 * Selecting a workspace switches the whole page into that workspace's scope:
 * its own servers on top, and the global servers below with a `hide` checkbox
 * each (the `exclude` mask).
 */

import { createGlobalMaskRow } from './GlobalMaskRow'
import { createClearIcon } from '../../../platform/icons/ClearIcon'
import { createPlusIcon } from '../icons/PlusIcon'
import { createSearchIcon } from '../../../platform/icons/SearchIcon'
import { createSettings2Icon } from '../../../platform/icons/Settings2Icon'
import { createServerForm } from './ServerForm'
import { createBreadcrumb } from '../ui/Breadcrumb'
import { createReconnectForm } from './ReconnectForm'
import { createScopeSelect } from '../ui/ScopeSelect'
import { createServerRow } from './ServerRow'
import { createToolTimeoutForm } from './ToolTimeoutForm'
import { createSwitch } from '../ui/Switch'
import { watchRowWrap } from '../ui/rowWrap'
import { watchTipBoundaries } from '../../../platform/ui/tip'
import { useAsyncAction } from '../../../platform/ui/useAsyncAction'
import { isTransientStatus } from '../ui/StatusPill'
import { createWorkspaceServerRow } from './WorkspaceServerRow'
import { DEFAULT_RECONNECT_SETTINGS, DEFAULT_TOOL_CALL_TIMEOUT_MS } from '../types'
import type { ClientDeps } from '../../../platform/types'
import type {
  SectionProps,
  ServerView,
  SettingsView,
  WorkspaceServerView,
  WorkspaceView,
} from '../types'

const REFRESH_INTERVAL_MS = 3000

/** The numeric half of the reconnection settings (the fourth field is a switch). */
type ReconnectNumberKey = 'reconnectMaxAttempts' | 'reconnectMaxDelayMs' | 'healthCheckIntervalMs'

/** One numeric reconnection setting from a `/settings` answer, default when absent. */
function reconnectNumber(value: unknown, key: ReconnectNumberKey): number {
  return typeof value === 'number' ? value : DEFAULT_RECONNECT_SETTINGS[key]
}

type View = 'list' | 'add' | 'edit-global' | 'edit-ws' | 'advanced'

/** One optimistic status overlay: what a row should render and when the action
 * that predicted it was clicked (`polledAt` fences which polls may retire it). */
interface StatusPreview {
  status: string
  at: number
}

/** The label the scope picker shows for a workspace: its last path segment,
 * falling back to the whole path when there is no separator to split on.
 * Both separators count — the host hands out native paths, so on Windows a
 * workspace arrives as `E:\AI\app` and a `/`-only split would show it whole. */
function workspaceName(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() || path
}

export function createMcpContent(deps: ClientDeps): (props: SectionProps) => JSX.Element {
  const { h, react, api, createPortal } = deps
  const ServerRow = createServerRow(deps)
  const ServerForm = createServerForm(deps)
  const WorkspaceServerRow = createWorkspaceServerRow(deps)
  const GlobalMaskRow = createGlobalMaskRow(deps)
  const ScopeSelect = createScopeSelect(deps)
  const Breadcrumb = createBreadcrumb(deps)
  const Switch = createSwitch(deps)
  const PlusIcon = createPlusIcon(deps)
  const SearchIcon = createSearchIcon(deps)
  const ClearIcon = createClearIcon(deps)
  const Settings2Icon = createSettings2Icon(deps)
  const ToolTimeoutForm = createToolTimeoutForm(deps)
  const ReconnectForm = createReconnectForm(deps)

  return function McpContent({ t }: SectionProps): JSX.Element {
    const [servers, setServers] = react.useState<ServerView[]>([])
    const [workspaces, setWorkspaces] = react.useState<WorkspaceView[]>([])
    const [settings, setSettings] = react.useState<SettingsView>({
      onDemandToolInjection: false,
      toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
      ...DEFAULT_RECONNECT_SETTINGS,
    })
    const [selected, setSelected] = react.useState('')
    const [view, setView] = react.useState<View>('list')
    const [editingId, setEditingId] = react.useState<string | null>(null)
    const [editingName, setEditingName] = react.useState<string | null>(null)
    // One query per scope: the text belongs to the scope it was typed in, so
    // bouncing between the global view and a workspace keeps each view's
    // filter instead of resetting it.
    const [queries, setQueries] = react.useState<Record<string, string>>({})
    const [expandedId, setExpandedId] = react.useState<string | null>(null)
    // Optimistic transitions: an action
    // (enable/disable, restart, stop, auth) previews the intermediate status at
    // click time so the row spins from the click, not from whenever the 3s
    // poll happens to sample the host-side transition. A preview retires once
    // a poll observes the transition it predicted — with a fence: only a poll
    // REQUESTED after the preview may retire it, because an older snapshot
    // still carries the pre-click status and would cancel the spin the click
    // just started (the effect below).
    const [statusPreviews, setStatusPreviews] = react.useState(new Map<string, StatusPreview>())
    // When the latest poll was requested; the retirement fence for previews.
    const [polledAt, setPolledAt] = react.useState(0)
    const excludeAction = useAsyncAction(react)
    const settingsAction = useAsyncAction(react)
    const openConfigAction = useAsyncAction(react)

    /** Overlay a previewed status onto one server view. */
    const withPreview = <S extends { id: string; status: string }>(server: S): S => {
      const preview = statusPreviews.get(server.id)?.status
      return preview && preview !== server.status ? { ...server, status: preview } : server
    }

    const previewStatus = (id: string, status: string): void => {
      setStatusPreviews(new Map(statusPreviews).set(id, { status, at: Date.now() }))
    }

    /** The root crumb every sub-view's breadcrumb starts from: the list view
     * itself, which clicking returns to (`view` lives in this component). */
    const listCrumb = { label: t('servers'), onClick: (): void => setView('list') }

    // The settings shell's title strip — the flex row that carries the header
    // actions and the close button, empty on its left — is where the sub-views'
    // breadcrumb mounts. The shell keeps only the active section rendered, so
    // this component rendering at all already means MCP is the section on
    // show. The strip is re-located after every render (the 3s poll re-renders
    // the section anyway, which doubles as the re-check) and re-set only on
    // identity change, so a re-rendered or replaced strip is picked up without
    // a timer; a closed dialog leaves nothing to find and the breadcrumb goes
    // with it. Guarded like `runtime/nav-icon`: the offline harness runs
    // effects without a DOM. The anchor avoids hashed classes — the wrapper is
    // the one the shell renders its `settings.action` slot into, and the strip
    // is the nearest ancestor whose CSS-module local name is `header`.
    const [headerStrip, setHeaderStrip] = react.useState<Element | null>(null)
    react.useEffect(() => {
      if (typeof document === 'undefined') return
      const actions = document.querySelector('[role="dialog"] [data-slot="settings.action"]')
      // Same-value sets bail out of the re-render, so the strip's identity is
      // the only thing that turns this effect into work.
      setHeaderStrip(actions?.closest('[class*="header"]') ?? null)
    })

    // Whether the toolbar's search has dropped to a line of its own — the row's
    // one-line and two-line looks are different sizing rules, and only the
    // layout can say which one applies (`ui/rowWrap` owns that reasoning). The
    // row is located the way the strip above is, with the same two guards, and
    // the check rides every render: a workspace renamed shorter or longer moves
    // that break point without the row resizing, and the 3s poll re-renders
    // this component anyway. Same-value sets bail out, so an unchanged wrap
    // costs no render.
    const [wrapped, setWrapped] = react.useState(false)
    react.useEffect(() => {
      if (typeof document === 'undefined') return
      const bar = document.querySelector<HTMLElement>('.smkit-mcp-section-toolbar')
      return bar ? watchRowWrap(bar, setWrapped) : undefined
    })

    const refresh = react.useCallback(() => {
      // Fence timestamp: the GET handlers answer from the host state at handling
      // time, so data from a poll requested at `requestedAt` cannot predate it.
      const requestedAt = Date.now()
      Promise.all([api('/servers'), api('/workspaces'), api('/settings')])
        .then(([serversResult, workspacesResult, settingsResult]) => {
          if (serversResult.ok) setServers(serversResult.body.servers ?? [])
          if (workspacesResult.ok) setWorkspaces(workspacesResult.body.workspaces ?? [])
          if (settingsResult.ok) {
            const reported = settingsResult.body
            setSettings({
              onDemandToolInjection: reported.onDemandToolInjection === true,
              toolCallTimeoutMs:
                typeof reported.toolCallTimeoutMs === 'number'
                  ? reported.toolCallTimeoutMs
                  : DEFAULT_TOOL_CALL_TIMEOUT_MS,
              autoReconnect:
                typeof reported.autoReconnect === 'boolean'
                  ? reported.autoReconnect
                  : DEFAULT_RECONNECT_SETTINGS.autoReconnect,
              reconnectMaxAttempts: reconnectNumber(reported.reconnectMaxAttempts, 'reconnectMaxAttempts'),
              reconnectMaxDelayMs: reconnectNumber(reported.reconnectMaxDelayMs, 'reconnectMaxDelayMs'),
              healthCheckIntervalMs: reconnectNumber(
                reported.healthCheckIntervalMs,
                'healthCheckIntervalMs',
              ),
            })
          }
          setPolledAt(requestedAt)
        })
        .catch(() => {})
    }, [])

    react.useEffect(() => {
      refresh()
      const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
      return () => clearInterval(timer)
    }, [refresh])

    // Hover bubbles slide clear of clip edges; one document-level watch
    // serves every `.smkit-ui-tip` the section renders.
    react.useEffect(() => watchTipBoundaries(), [])

    // Drop the selection if the workspace disappeared.
    react.useEffect(() => {
      if (selected && !workspaces.some((workspace) => workspace.path === selected)) setSelected('')
    }, [workspaces, selected])

    // Retire a preview once a post-click poll observes the transition it
    // predicted: a settled report for the same server means the snapshot is
    // now the truth. Transient reports keep it — they describe the very
    // transition in flight.
    react.useEffect(() => {
      if (statusPreviews.size === 0) return
      const next = new Map(statusPreviews)
      const retire = (server: { id: string; status: string }): void => {
        const preview = next.get(server.id)
        if (!preview || polledAt < preview.at) return
        if (!isTransientStatus(server.status)) next.delete(server.id)
      }
      for (const server of servers) retire(server)
      for (const workspace of workspaces) {
        for (const server of workspace.servers) retire(server)
      }
      if (next.size !== statusPreviews.size) setStatusPreviews(next)
    }, [servers, workspaces, statusPreviews, polledAt])

    const selectedWs = workspaces.find((workspace) => workspace.path === selected) ?? null
    const wsServers: WorkspaceServerView[] = selectedWs?.servers ?? []
    const wsTotal = workspaces.reduce((sum, workspace) => sum + workspace.servers.length, 0)
    const excludeSet = new Set(selectedWs?.exclude ?? [])
    const query = queries[selected] ?? ''
    const setQuery = (next: string): void => {
      setQueries({ ...queries, [selected]: next })
    }
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const searching = normalizedQuery !== ''
    // A trimmed, case-insensitive substring test across the fields a server
    // is found by — its name, plus the URL or command one would grep a config
    // for. An empty query matches everything, so the unsearched lists below
    // are these same filters.
    const matchesQuery = (server: { name: string; url?: string; command?: string }): boolean =>
      !searching ||
      [server.name, server.url, server.command].some((field) =>
        field?.toLocaleLowerCase().includes(normalizedQuery),
      )
    const filteredServers = servers.filter(matchesQuery)
    const filteredWsServers = wsServers.filter(matchesQuery)

    const toggleExclude = async (serverName: string, exclude: boolean): Promise<void> => {
      if (!selected) return
      await excludeAction.run(async () => {
        try {
          const r = await api('/workspaces/exclude', {
            method: 'POST',
            body: JSON.stringify({ path: selected, server: serverName, exclude }),
          })
          if (r.ok) refresh()
        } catch {
          // Transient: the 3s poll will resync.
        }
      })
    }

    const toggleOnDemand = (): Promise<void> =>
      settingsAction.run(async () => {
        const enabled = !settings.onDemandToolInjection
        const r = await api('/settings/on-demand', {
          method: 'POST',
          body: JSON.stringify({ enabled }),
        })
        if (r.ok) {
          // Spread the rest: the timeout is part of the same settings object, and
          // replacing it wholesale would drop whatever the last poll reported.
          setSettings({
            ...settings,
            onDemandToolInjection: r.body.onDemandToolInjection === true,
          })
          return
        }
        return r.body.error || t('toggleFailed', { status: r.status })
      })

    // Open the current scope's config file, DSH-settings style: the file
    // itself, via the platform's default `.json` association. Global opens
    // the profile state file (the global tier's only store); a workspace
    // opens its declarative .dsh/dshmm/mcp.json.
    const openConfig = (): Promise<void> =>
      openConfigAction.run(async () => {
        const r = selected
          ? await api('/workspaces/open-config', {
              method: 'POST',
              body: JSON.stringify({ path: selected }),
            })
          : await api('/open-config', { method: 'POST' })
        if (!r.ok) return r.body.error || t('openConfigFailed', { status: r.status })
      }, 'open-config')

    const addBtn = (
      <button
        className="smkit-ui-icon-button smkit-mcp-section-add-btn smkit-ui-tip"
        type="button"
        aria-label={t('addServer')}
        data-smkit-tip={t('addServer')}
        onClick={() => setView('add')}
      >
        <PlusIcon size={14} />
      </button>
    )

    // The sub-view breadcrumb for the shell's title strip: list view is the
    // trail's root and mounts nothing. Portal-rendered because the strip is
    // the shell's chrome, not this section's scroll area; `null` when the
    // strip was not found or the host module table has no react-dom — the
    // section's own heading remains either way.
    const subViewLabel =
      view === 'add'
        ? t('addServer')
        : view === 'edit-global'
          ? t('editGlobal')
          : view === 'edit-ws'
            ? t('editWorkspace')
            : view === 'advanced'
              ? t('advancedTitle')
              : null
    const headerBreadcrumb =
      headerStrip && createPortal && subViewLabel
        ? createPortal(
            <Breadcrumb
              ariaLabel={t('breadcrumb')}
              crumbs={[listCrumb, { label: subViewLabel }]}
            />,
            headerStrip,
          )
        : null

    if (view === 'advanced') {
      return (
        <div className="smkit-mcp-section">
          <div className="smkit-mcp-section-catalog-heading">
            <h3>{t('advancedTitle')}</h3>
          </div>
          {headerBreadcrumb}
          <ReconnectForm
            t={t}
            current={settings}
            onSaved={(next) => setSettings({ ...settings, ...next })}
          />
          <ToolTimeoutForm
            t={t}
            current={settings.toolCallTimeoutMs}
            onSaved={(timeoutMs) => setSettings({ ...settings, toolCallTimeoutMs: timeoutMs })}
            onCancel={() => setView('list')}
          />
        </div>
      )
    }

    if (view === 'add') {
      return (
        <div className="smkit-mcp-section">
          <div className="smkit-mcp-section-catalog-heading">
            <h3>{t('addServer')}</h3>
          </div>
          {headerBreadcrumb}
          <ServerForm
            t={t}
            scope={selected ? 'workspace' : 'user'}
            workspacePath={selected || ''}
            workspaces={workspaces.map((workspace) => workspace.path)}
            onDone={() => {
              setView('list')
              refresh()
            }}
            onCancel={() => setView('list')}
          />
        </div>
      )
    }

    const globalEditing =
      view === 'edit-global' ? servers.find((server) => server.id === editingId) ?? null : null
    if (view === 'edit-global' && globalEditing) {
      return (
        <div className="smkit-mcp-section">
          <div className="smkit-mcp-section-catalog-heading">
            <h3>{t('editGlobal')}</h3>
          </div>
          {headerBreadcrumb}
          <ServerForm
            t={t}
            initial={globalEditing}
            scope="user"
            onDone={() => {
              setView('list')
              refresh()
            }}
            onCancel={() => setView('list')}
          />
        </div>
      )
    }

    const wsEditing =
      view === 'edit-ws' && selectedWs
        ? selectedWs.servers.find((server) => server.name === editingName) ?? null
        : null
    if (view === 'edit-ws' && selected && wsEditing) {
      return (
        <div className="smkit-mcp-section">
          <div className="smkit-mcp-section-catalog-heading">
            <h3>{t('editWorkspace')}</h3>
          </div>
          {headerBreadcrumb}
          <div className="smkit-mcp-section-ws-path-hint">{selected}</div>
          <ServerForm
            t={t}
            initial={wsEditing}
            scope="workspace"
            workspacePath={selected}
            onDone={() => {
              setView('list')
              refresh()
            }}
            onCancel={() => setView('list')}
          />
        </div>
      )
    }

    // While a query is active, a group with no matches disappears whole —
    // title included, rather than showing its empty-state line — and when
    // that leaves nothing at all, one "no matches" line stands in for both
    // groups.
    const workspaceBranch: JSX.Element[] = []
    if (!searching || filteredWsServers.length > 0) {
      workspaceBranch.push(
        <div className="smkit-mcp-section-group-title" key="ws-title">
          {t('workspaceServers')}
        </div>,
        wsServers.length > 0 ? (
          <div className="smkit-mcp-section-ws-list" key="ws-list">
            {filteredWsServers.map((server) => (
              <WorkspaceServerRow
                t={t}
                server={withPreview(server)}
                workspacePath={selected}
                onChanged={refresh}
                onStatusPreview={previewStatus}
                onEdit={() => {
                  setEditingName(server.name)
                  setView('edit-ws')
                }}
                key={server.name}
              />
            ))}
          </div>
        ) : (
          <div className="smkit-mcp-section-meta" key="ws-empty">
            {t('emptyWorkspace')}
          </div>
        ),
      )
    }
    if (!searching || filteredServers.length > 0) {
      workspaceBranch.push(
        <div className="smkit-mcp-section-group-title" key="global-title">
          {t('globalServers')}
        </div>,
        servers.length > 0 ? (
          <div className="smkit-mcp-section-ws-list" key="global-list">
            {filteredServers.map((server) => (
              <GlobalMaskRow
                t={t}
                server={withPreview(server)}
                excluded={excludeSet.has(server.name)}
                onToggleExclude={toggleExclude}
                onEdit={() => {
                  setEditingId(server.id)
                  setView('edit-global')
                }}
                busy={excludeAction.busy}
                key={server.id}
              />
            ))}
          </div>
        ) : (
          <div className="smkit-mcp-section-meta" key="global-empty">
            {t('emptyGlobal')}
          </div>
        ),
      )
    }
    if (searching && filteredWsServers.length === 0 && filteredServers.length === 0) {
      workspaceBranch.push(
        <div className="smkit-mcp-section-meta" key="search-empty">
          {t('searchEmpty')}
        </div>,
      )
    }

    const globalBranch: JSX.Element[] = [
      <div className="smkit-mcp-section-cards" key="cards">
        {filteredServers.map((server) => (
          <ServerRow
            t={t}
            server={withPreview(server)}
            onChanged={refresh}
            onStatusPreview={previewStatus}
            onEdit={() => {
              setEditingId(server.id)
              setView('edit-global')
            }}
            open={expandedId === server.id}
            onToggle={() => setExpandedId(expandedId === server.id ? null : server.id)}
            key={server.id}
          />
        ))}
      </div>,
    ]
    if (searching && filteredServers.length === 0) {
      globalBranch.push(
        <div className="smkit-mcp-section-meta" key="search-empty">
          {t('searchEmpty')}
        </div>,
      )
    }

    return (
      <div className="smkit-mcp-section">
        <div className="smkit-mcp-section-catalog-heading">
          <h3>{t('servers')}</h3>
          <span>
            {t('countGlobal', { count: servers.length })} ·{' '}
            {t('countWorkspace', { count: wsTotal })}
          </span>
        </div>
        <div className="smkit-mcp-section-toolbar" data-smkit-wrapped={wrapped ? 'true' : undefined}>
          <ScopeSelect
            t={t}
            value={selected}
            workspaces={workspaces.map((workspace) => ({
              path: workspace.path,
              name: workspaceName(workspace.path),
            }))}
            onChange={(next) => {
              setSelected(next)
              setExpandedId(null)
            }}
          />
          <button
            className="smkit-ui-icon-button smkit-mcp-section-open-config smkit-ui-tip"
            type="button"
            aria-label={t('openConfig')}
            data-smkit-tip={t('openConfig')}
            disabled={openConfigAction.busy}
            onClick={openConfig}
          >
            <Settings2Icon size={14} />
          </button>
          <button
            className="smkit-ui-button smkit-mcp-section-toolbar-action"
            type="button"
            onClick={() => setView('advanced')}
          >
            {t('advanced')}
          </button>
          <span className="smkit-mcp-section-toolbar-spacer" aria-hidden="true" />
          <div className="smkit-mcp-section-toolbar-actions">
            <label className="smkit-mcp-search">
              <SearchIcon size={14} />
              <input
                type="search"
                value={query}
                placeholder={t('search')}
                aria-label={t('search')}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query ? (
                <button
                  className="smkit-mcp-search-clear"
                  type="button"
                  aria-label={t('clearSearch')}
                  title={t('clearSearch')}
                  onClick={() => setQuery('')}
                >
                  <ClearIcon size={12} />
                </button>
              ) : null}
            </label>
            {addBtn}
          </div>
        </div>
        <div className="smkit-mcp-section-feature">
          <span className="smkit-mcp-section-feature-text">
            <span className="smkit-mcp-section-feature-title">{t('onDemand')}</span>
            <span className="smkit-mcp-section-feature-meta">{t('onDemandHelp')}</span>
          </span>
          <Switch
            on={settings.onDemandToolInjection}
            text={settings.onDemandToolInjection ? t('on') : t('off')}
            busy={settingsAction.busy}
            onToggle={toggleOnDemand}
            ariaLabel={t('onDemand')}
          />
        </div>
        {settingsAction.error ? <div className="smkit-ui-field-error">{settingsAction.error}</div> : null}
        {selectedWs?.error ? <div className="smkit-ui-field-error">{selectedWs.error}</div> : null}
        {selected ? workspaceBranch : globalBranch}
      </div>
    )
  }
}
