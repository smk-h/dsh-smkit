/**
 * The Settings → MCP section.
 *
 * One component drives four views (`list`, `add`, `edit-global`, `edit-ws`) and
 * three API-surfaced data sets, re-polled every 3 seconds so a server that
 * reconnects on the host side updates its badge without a page reload.
 *
 * Selecting a workspace switches the whole page into that workspace's scope:
 * its own servers on top, and the global servers below with a `hide` checkbox
 * each (the `exclude` mask).
 */

import { createGlobalMaskRow } from './GlobalMaskRow'
import { createPlusIcon } from './icons/PlusIcon'
import { createSearchIcon } from './icons/SearchIcon'
import { createServerForm } from './ServerForm'
import { createScopeSelect } from './ui/ScopeSelect'
import { createServerRow } from './ServerRow'
import { createSwitch } from './ui/Switch'
import { useAsyncAction } from './ui/useAsyncAction'
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

/** The plugin's own identity for the section header; the name links to the
 * repo. Name and version are tsdown defines read from package.json
 * (`__PLUGIN_NAME__` / `__PLUGIN_VERSION__`), so the badge cannot drift from
 * the package. */
const PLUGIN_NAME = __PLUGIN_NAME__
const PLUGIN_REPO_URL = 'https://github.com/smk-h/dsh-smkit'

/** The label the scope picker shows for a workspace: its last path segment,
 * falling back to the whole path when there is no separator to split on. */
function workspaceName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path
}

export function createMcpContent(deps: ClientDeps): (props: SectionProps) => JSX.Element {
  const { h, react, api } = deps
  const ServerRow = createServerRow(deps)
  const ServerForm = createServerForm(deps)
  const WorkspaceServerRow = createWorkspaceServerRow(deps)
  const GlobalMaskRow = createGlobalMaskRow(deps)
  const ScopeSelect = createScopeSelect(deps)
  const Switch = createSwitch(deps)
  const PlusIcon = createPlusIcon(deps)
  const SearchIcon = createSearchIcon(deps)

  return function McpContent({ t }: SectionProps): JSX.Element {
    const [servers, setServers] = react.useState<ServerView[]>([])
    const [workspaces, setWorkspaces] = react.useState<WorkspaceView[]>([])
    const [settings, setSettings] = react.useState<SettingsView>({ onDemandToolInjection: false })
    const [selected, setSelected] = react.useState('')
    const [view, setView] = react.useState<View>('list')
    const [editingId, setEditingId] = react.useState<string | null>(null)
    const [editingName, setEditingName] = react.useState<string | null>(null)
    const [query, setQuery] = react.useState('')
    const [expandedId, setExpandedId] = react.useState<string | null>(null)
    const excludeAction = useAsyncAction(react)
    const settingsAction = useAsyncAction(react)

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

    const refresh = react.useCallback(() => {
      Promise.all([api('/servers'), api('/workspaces'), api('/settings')])
        .then(([serversResult, workspacesResult, settingsResult]) => {
          if (serversResult.ok) setServers(serversResult.body.servers ?? [])
          if (workspacesResult.ok) setWorkspaces(workspacesResult.body.workspaces ?? [])
          if (settingsResult.ok) {
            setSettings({ onDemandToolInjection: settingsResult.body.onDemandToolInjection === true })
          }
        })
        .catch(() => {})
    }, [])

    react.useEffect(() => {
      refresh()
      const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
      return () => clearInterval(timer)
    }, [refresh])

    // Drop the selection if the workspace disappeared.
    react.useEffect(() => {
      if (selected && !workspaces.some((workspace) => workspace.path === selected)) setSelected('')
    }, [workspaces, selected])

    const selectedWs = workspaces.find((workspace) => workspace.path === selected) ?? null
    const wsServers: WorkspaceServerView[] = selectedWs?.servers ?? []
    const wsTotal = workspaces.reduce((sum, workspace) => sum + workspace.servers.length, 0)
    const excludeSet = new Set(selectedWs?.exclude ?? [])
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const filteredServers = servers.filter((server) =>
      server.name.toLocaleLowerCase().includes(normalizedQuery),
    )

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

    const addBtn = (
      <button
        className="mm_addBtn"
        type="button"
        aria-label={t('addServer')}
        title={t('addServer')}
        onClick={() => setView('add')}
      >
        <PlusIcon size={14} />
      </button>
    )

    if (view === 'add') {
      return (
        <div className="mm_section">
          {identityHeader}
          <div className="mm_catalogHeading">
            <h3>{t('addServer')}</h3>
          </div>
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

    const workspaceBranch: JSX.Element[] = [
      <div className="mm_groupTitle" key="ws-title">
        {t('workspaceServers')}
      </div>,
      wsServers.length > 0 ? (
        <div className="mm_wsList" key="ws-list">
          {wsServers.map((server) => (
            <WorkspaceServerRow
              t={t}
              server={server}
              workspacePath={selected}
              onChanged={refresh}
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
      <div className="mm_groupTitle" key="global-title">
        {t('globalServers')}
      </div>,
      servers.length > 0 ? (
        <div className="mm_wsList" key="global-list">
          {servers.map((server) => (
            <GlobalMaskRow
              t={t}
              server={server}
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
    ]

    const globalBranch: JSX.Element[] = [
      <label className="mm_search" key="search">
        <SearchIcon size={14} />
        <input
          type="search"
          value={query}
          placeholder={t('search')}
          aria-label={t('search')}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>,
      <div className="mm_cards" key="cards">
        {filteredServers.map((server) => (
          <ServerRow
            t={t}
            server={server}
            onChanged={refresh}
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

    return (
      <div className="mm_section">
        {identityHeader}
        <div className="mm_catalogHeading">
          <h3>{t('servers')}</h3>
          <span>
            {t('countGlobal', { count: servers.length })} · {t('countWorkspace', { count: wsTotal })}
          </span>
          <span className="mm_addActions">{addBtn}</span>
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
        <div className="mm_wsBar">
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
              setQuery('')
            }}
          />
        </div>
        {selected ? <div className="mm_wsPathHint">{selected}</div> : null}
        {selectedWs?.error ? <div className="mm_err">{selectedWs.error}</div> : null}
        {selected ? workspaceBranch : globalBranch}
      </div>
    )
  }
}
