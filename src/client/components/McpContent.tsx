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
import { createServerForm } from './ServerForm'
import { createServerRow } from './ServerRow'
import { createWorkspaceServerRow } from './WorkspaceServerRow'
import type {
  ClientDeps,
  SectionProps,
  ServerView,
  SettingsView,
  WorkspaceServerView,
  WorkspaceView,
} from '../types'

const REFRESH_INTERVAL_MS = 3000

type View = 'list' | 'add' | 'edit-global' | 'edit-ws'

/** The plugin's own identity for the section header; the name links to the repo. */
const PLUGIN_NAME = 'dsh-smkit'
const PLUGIN_REPO_URL = 'https://github.com/smk-h/dsh-smkit'

export function createMcpContent(deps: ClientDeps): (props: SectionProps) => JSX.Element {
  const { h, react, api } = deps
  const ServerRow = createServerRow(deps)
  const ServerForm = createServerForm(deps)
  const WorkspaceServerRow = createWorkspaceServerRow(deps)
  const GlobalMaskRow = createGlobalMaskRow(deps)

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
    const [excludeBusy, setExcludeBusy] = react.useState(false)
    const [settingsBusy, setSettingsBusy] = react.useState(false)
    const [settingsError, setSettingsError] = react.useState('')

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
      setExcludeBusy(true)
      try {
        const r = await api('/workspaces/exclude', {
          method: 'POST',
          body: JSON.stringify({ path: selected, server: serverName, exclude }),
        })
        if (r.ok) refresh()
      } catch {
        // Transient: the 3s poll will resync.
      }
      setExcludeBusy(false)
    }

    const toggleOnDemand = async (): Promise<void> => {
      setSettingsBusy(true)
      setSettingsError('')
      try {
        const enabled = !settings.onDemandToolInjection
        const r = await api('/settings/on-demand', { method: 'POST', body: JSON.stringify({ enabled }) })
        if (r.ok) setSettings({ onDemandToolInjection: r.body.onDemandToolInjection === true })
        else setSettingsError(r.body.error || t('toggleFailed', { status: r.status }))
      } catch (e) {
        setSettingsError(String(e))
      }
      setSettingsBusy(false)
    }

    const addBtn = (
      <button
        className="mm_addBtn"
        type="button"
        aria-label={t('addServer')}
        title={t('addServer')}
        onClick={() => setView('add')}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 3.5v9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
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
              busy={excludeBusy}
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
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
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
          <span className="mm_switchRow">
            <button
              className="mm_switch"
              type="button"
              role="switch"
              data-on={settings.onDemandToolInjection ? 'true' : undefined}
              aria-checked={settings.onDemandToolInjection}
              aria-label={t('onDemand')}
              onClick={toggleOnDemand}
              disabled={settingsBusy}
            >
              <span className="mm_switchThumb" />
            </button>
            <span className="mm_switchText">
              {settings.onDemandToolInjection ? t('on') : t('off')}
            </span>
          </span>
        </div>
        {settingsError ? <div className="mm_err">{settingsError}</div> : null}
        <div className="mm_wsBar">
          <select
            className="mm_wsSelect"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value)
              setExpandedId(null)
              setQuery('')
            }}
          >
            <option value="">{t('global')}</option>
            {workspaces.map((workspace) => (
              <option value={workspace.path} key={workspace.path}>
                {workspace.path.split('/').filter(Boolean).pop() || workspace.path}
              </option>
            ))}
          </select>
        </div>
        {selected ? <div className="mm_wsPathHint">{selected}</div> : null}
        {selectedWs?.error ? <div className="mm_err">{selectedWs.error}</div> : null}
        {selected ? workspaceBranch : globalBranch}
      </div>
    )
  }
}
