/**
 * The Settings → MCP section.
 *
 * One component drives four views (`list`, `add`, `edit-global`, `edit-ws`) and
 * three API-surfaced data sets, re-polled every 3 seconds so a server that
 * reconnects on the host side updates its badge without a page reload.
 *
 * Each view keeps its own heading in the content (`mm_catalogHeading`); the
 * three sub-views additionally mount a breadcrumb (`ui/Breadcrumb`) into the
 * settings shell's title strip through a portal — the list view is the trail's
 * root, and clicking it is the second way back besides the form's cancel
 * button.
 *
 * The list view opens with the section title and both counts on their own
 * line under the identity badge. Below it, a toolbar row pairs the scope
 * picker on the left with the search box and the add button against the right
 * edge; the box rides the same row while it fits and wraps to its own line,
 * packed left, when the row runs short. The filter is a per-scope map — one
 * query per scope — and it filters whichever lists the selected scope shows,
 * so a workspace view can be narrowed down exactly like the global one.
 *
 * Selecting a workspace switches the whole page into that workspace's scope:
 * its own servers on top, and the global servers below with a `hide` checkbox
 * each (the `exclude` mask).
 */

import { createGlobalMaskRow } from './GlobalMaskRow'
import { createClearIcon } from './icons/ClearIcon'
import { createPlusIcon } from './icons/PlusIcon'
import { createSearchIcon } from './icons/SearchIcon'
import { createSettings2Icon } from './icons/Settings2Icon'
import { createServerForm } from './ServerForm'
import { createBreadcrumb } from './ui/Breadcrumb'
import { createScopeSelect } from './ui/ScopeSelect'
import { createServerRow } from './ServerRow'
import { createSwitch } from './ui/Switch'
import { watchTipBoundaries } from './ui/tip'
import { useAsyncAction } from './ui/useAsyncAction'
import { isTransientStatus } from './ui/StatusPill'
import { createWorkspaceServerRow } from './WorkspaceServerRow'
import type {
  ClientDeps,
  SectionProps,
  ServerView,
  SettingsView,
  WorkspaceServerView,
  WorkspaceView,
} from '../runtime/types'

const REFRESH_INTERVAL_MS = 3000

type View = 'list' | 'add' | 'edit-global' | 'edit-ws'

/** One optimistic status overlay: what a row should render and when the action
 * that predicted it was clicked (`polledAt` fences which polls may retire it). */
interface StatusPreview {
  status: string
  at: number
}

/** The plugin's own identity for the section header; the name links to the
 * repo. Name and version are tsdown defines read from package.json
 * (`__PLUGIN_NAME__` / `__PLUGIN_VERSION__`), so the badge cannot drift from
 * the package. */
const PLUGIN_NAME = __PLUGIN_NAME__
const PLUGIN_REPO_URL = 'https://github.com/smk-h/dsh-smkit'

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

  return function McpContent({ t }: SectionProps): JSX.Element {
    const [servers, setServers] = react.useState<ServerView[]>([])
    const [workspaces, setWorkspaces] = react.useState<WorkspaceView[]>([])
    const [settings, setSettings] = react.useState<SettingsView>({ onDemandToolInjection: false })
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

    // The section's identity block, shown above every view: one intro line,
    // then the plugin pill (clickable name + version tag), so the page stays
    // attributable at a glance. `__PLUGIN_VERSION__` is a tsdown build-time
    // define of package.json's version.
    const identityHeader: JSX.Element[] = [
      <p className="mm_intro" key="intro">
        {t('sectionIntro')}
      </p>,
      <div className="mm_versionBadge" key="badge">
        <a
          className="mm_versionBadgeName"
          href={PLUGIN_REPO_URL}
          target="_blank"
          rel="noreferrer"
        >
          {PLUGIN_NAME}
        </a>
        <span className="mm_versionBadgeTag">v{__PLUGIN_VERSION__}</span>
      </div>,
    ]

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

    const refresh = react.useCallback(() => {
      // Fence timestamp: the GET handlers answer from the host state at handling
      // time, so data from a poll requested at `requestedAt` cannot predate it.
      const requestedAt = Date.now()
      Promise.all([api('/servers'), api('/workspaces'), api('/settings')])
        .then(([serversResult, workspacesResult, settingsResult]) => {
          if (serversResult.ok) setServers(serversResult.body.servers ?? [])
          if (workspacesResult.ok) setWorkspaces(workspacesResult.body.workspaces ?? [])
          if (settingsResult.ok) {
            setSettings({ onDemandToolInjection: settingsResult.body.onDemandToolInjection === true })
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
    // serves every `.mm_tip` the section renders.
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
          setSettings({ onDemandToolInjection: r.body.onDemandToolInjection === true })
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
        className="mm_addBtn mm_tip"
        type="button"
        aria-label={t('addServer')}
        data-tip={t('addServer')}
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

    if (view === 'add') {
      return (
        <div className="mm_section">
          {identityHeader}
          <div className="mm_catalogHeading">
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
        <div className="mm_section">
          {identityHeader}
          <div className="mm_catalogHeading">
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
        <div className="mm_section">
          {identityHeader}
          <div className="mm_catalogHeading">
            <h3>{t('editWorkspace')}</h3>
          </div>
          {headerBreadcrumb}
          <div className="mm_wsPathHint">{selected}</div>
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
        <div className="mm_groupTitle" key="ws-title">
          {t('workspaceServers')}
        </div>,
        wsServers.length > 0 ? (
          <div className="mm_wsList" key="ws-list">
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
          <div className="mm_meta" key="ws-empty">
            {t('emptyWorkspace')}
          </div>
        ),
      )
    }
    if (!searching || filteredServers.length > 0) {
      workspaceBranch.push(
        <div className="mm_groupTitle" key="global-title">
          {t('globalServers')}
        </div>,
        servers.length > 0 ? (
          <div className="mm_wsList" key="global-list">
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
          <div className="mm_meta" key="global-empty">
            {t('emptyGlobal')}
          </div>
        ),
      )
    }
    if (searching && filteredWsServers.length === 0 && filteredServers.length === 0) {
      workspaceBranch.push(
        <div className="mm_meta" key="search-empty">
          {t('searchEmpty')}
        </div>,
      )
    }

    const globalBranch: JSX.Element[] = [
      <div className="mm_cards" key="cards">
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
        <div className="mm_meta" key="search-empty">
          {t('searchEmpty')}
        </div>,
      )
    }

    return (
      <div className="mm_section">
        {identityHeader}
        <div className="mm_catalogHeading">
          <h3>{t('servers')}</h3>
          <span>
            {t('countGlobal', { count: servers.length })} ·{' '}
            {t('countWorkspace', { count: wsTotal })}
          </span>
        </div>
        <div className="mm_toolbar">
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
            className="mm_openConfig mm_tip"
            type="button"
            aria-label={t('openConfig')}
            data-tip={t('openConfig')}
            disabled={openConfigAction.busy}
            onClick={openConfig}
          >
            <Settings2Icon size={14} />
          </button>
          <span className="mm_toolbarSpacer" aria-hidden="true" />
          <div className="mm_toolbarActions">
            <label className="mm_search">
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
                  className="mm_searchClear"
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
        <div className="mm_feature">
          <span className="mm_featureText">
            <span className="mm_featureTitle">{t('onDemand')}</span>
            <span className="mm_featureMeta">{t('onDemandHelp')}</span>
          </span>
          <Switch
            on={settings.onDemandToolInjection}
            text={settings.onDemandToolInjection ? t('on') : t('off')}
            busy={settingsAction.busy}
            onToggle={toggleOnDemand}
            ariaLabel={t('onDemand')}
          />
        </div>
        {settingsAction.error ? <div className="mm_err">{settingsAction.error}</div> : null}
        {selectedWs?.error ? <div className="mm_err">{selectedWs.error}</div> : null}
        {selected ? workspaceBranch : globalBranch}
      </div>
    )
  }
}
