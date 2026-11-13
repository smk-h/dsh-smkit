/**
 * The debug page: three columns driven by two polls and one POST.
 *
 * It is a page in the main column (a `sidebar.panellist` entry plus the `main`
 * occupant it names), not a settings tab: the Inspector it replaces is a
 * full-window tool, and three columns of server list, tool list and answer need
 * the width the conversation area has.
 *
 * What it reuses is deliberate. Servers and tools come from the very `/servers`
 * and `/workspaces` answers the settings page polls, so the two surfaces cannot
 * disagree about a server's status or a tool's schema; the only new routes are
 * the call itself and the notification ring (`api/debug.ts`). Nothing here
 * writes configuration — restart and disconnect are the settings page's own
 * two runtime actions, and they are called through the same routes.
 *
 * State is per mount and deliberately not persisted: a debug page that came back
 * with yesterday's server selected, or with half-typed arguments in a form whose
 * tool no longer exists, would be lying about what is on the other end.
 */

import { createServerColumn } from './ServerColumn'
import { createToolColumn } from './ToolColumn'
import { createToolDetail, type ParamMode } from './ToolDetail'
import { buildArguments, fieldsOf, parseRawArguments, seedArguments } from '../schema'
import type { ClientDeps, Translator } from '../../../platform/types'
import type {
  CallOutcome,
  DebugGroup,
  DebugNotificationView,
  DebugServer,
  HistoryRow,
  ServerView,
  ToolView,
  WorkspaceServerView,
  WorkspaceView,
} from '../types'

/** How often the page re-reads the host's state, the same cadence as the settings page. */
const REFRESH_MS = 3_000
/** How long the copy button keeps its answer. */
const COPY_FEEDBACK_MS = 2_000
/** How many past calls the history keeps. */
const HISTORY_LIMIT = 25

/** The last path segment of a workspace, or the path itself when there is none. */
function baseName(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() || path
}

/** One global server view as the page's flat row. */
function fromGlobal(view: ServerView): DebugServer {
  return {
    id: view.id,
    name: view.name,
    type: view.type,
    status: view.status,
    serverInfo: view.serverInfo,
    command: view.command,
    args: view.args,
    cwd: view.cwd,
    url: view.url,
    env: view.env,
    tools: view.tools ?? [],
    error: view.error,
    scope: '',
  }
}

/** One workspace server view as the page's flat row. */
function fromWorkspace(view: WorkspaceServerView, path: string): DebugServer {
  return {
    id: view.id,
    name: view.name,
    type: view.type,
    status: view.status,
    authMode: view.authMode,
    serverInfo: view.serverInfo,
    command: view.command,
    args: view.args,
    cwd: view.cwd,
    url: view.url,
    env: view.env,
    tools: view.tools ?? [],
    error: view.error,
    scope: path,
  }
}

/** Put one command on the clipboard; false when the browser refuses. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function createMcpDebugPage(
  deps: ClientDeps,
  boundT: Translator,
): (props: { t?: Translator }) => JSX.Element {
  const { h, react, api } = deps
  const ServerColumn = createServerColumn(deps)
  const ToolColumn = createToolColumn(deps)
  const ToolDetail = createToolDetail(deps)

  return function McpDebugPage(props: { t?: Translator }): JSX.Element {
    // The slot hands the registration's namespace-bound translator down as
    // `t`; the closure's is the same function, kept as the fallback a harness
    // that renders the component directly would need.
    const t = props?.t ?? boundT

    const [servers, setServers] = react.useState<ServerView[]>([])
    const [workspaces, setWorkspaces] = react.useState<WorkspaceView[]>([])
    const [selectedId, setSelectedId] = react.useState('')
    const [query, setQuery] = react.useState('')
    const [toolName, setToolName] = react.useState('')
    const [mode, setMode] = react.useState<ParamMode>('form')
    const [values, setValues] = react.useState<Record<string, string>>({})
    const [rawText, setRawText] = react.useState('')
    const [running, setRunning] = react.useState(false)
    const [outcome, setOutcome] = react.useState<CallOutcome | null>(null)
    const [history, setHistory] = react.useState<HistoryRow[]>([])
    const [copyState, setCopyState] = react.useState('')
    const [notifications, setNotifications] = react.useState<DebugNotificationView[]>([])
    const [actionBusy, setActionBusy] = react.useState(false)

    const refreshAll = react.useCallback(() => {
      Promise.all([api('/servers'), api('/workspaces')])
        .then(([serversResult, workspacesResult]) => {
          if (serversResult.ok) setServers(serversResult.body.servers ?? [])
          if (workspacesResult.ok) setWorkspaces(workspacesResult.body.workspaces ?? [])
        })
        .catch(() => {})
    }, [])

    const refreshNotifications = react.useCallback((id: string) => {
      if (id === '') return
      api(`/debug/notifications?id=${encodeURIComponent(id)}`)
        .then((result) => {
          if (result.ok) setNotifications(result.body.notifications ?? [])
        })
        .catch(() => {})
    }, [])

    // Flatten both tiers once per render; every column reads the same list.
    //
    // Every heading is a *scope* and nothing else, and an empty scope is not
    // drawn at all — including the global one. A heading with nothing under it
    // sits directly on top of the next heading, which reads as if that next
    // heading were its child: a reader saw the global heading, then a
    // workspace's directory name, then that workspace's server, and took the
    // middle line for a server in the global tier. The workspace headings carry
    // their own prefix for the same reason.
    const groups: DebugGroup[] = [
      { label: t('groupGlobal'), path: '', servers: servers.map(fromGlobal) },
      ...workspaces.map((workspace) => ({
        label: t('groupWorkspace', { name: baseName(workspace.path) }),
        path: workspace.path,
        servers: (workspace.servers ?? []).map((view) => fromWorkspace(view, workspace.path)),
      })),
    ].filter((group) => group.servers.length > 0)

    const all = groups.flatMap((group) => group.servers)
    // With nothing picked yet the page opens on something rather than on an
    // empty middle column — the Inspector's own behaviour, and the reason a
    // reader does not have to click twice before seeing what a server offers. A
    // live server wins over a dormant one; the click still overrides it.
    const selected =
      all.find((server) => server.id === selectedId) ??
      all.find((server) => server.status === 'connected') ??
      all[0] ??
      null
    const selectedKey = selected === null ? '' : selected.id

    // One timer for both polls: they answer adjacent questions ("what is
    // connected" / "what did it say"), and a second interval would only let the
    // two columns disagree for up to three seconds.
    react.useEffect(() => {
      refreshAll()
      refreshNotifications(selectedKey)
      const timer = setInterval(() => {
        refreshAll()
        refreshNotifications(selectedKey)
      }, REFRESH_MS)
      return () => clearInterval(timer)
    }, [refreshAll, refreshNotifications, selectedKey])

    const normalized = query.trim().toLocaleLowerCase()
    const tools: ToolView[] = selected === null
      ? []
      : selected.tools.filter(
          (tool) =>
            normalized === '' ||
            tool.name.toLocaleLowerCase().includes(normalized) ||
            tool.description.toLocaleLowerCase().includes(normalized),
        )
    const tool = selected === null ? null : selected.tools.find((one) => one.name === toolName) ?? null
    const fields = fieldsOf(tool?.parameters)

    /** Record one finished (or refused) call at the head of the history. */
    const remember = (name: string, next: CallOutcome): void => {
      const row: HistoryRow = { ...next, id: Date.now(), tool: name, at: Date.now() }
      setHistory([row, ...history].slice(0, HISTORY_LIMIT))
      setOutcome(next)
    }

    const pickServer = (id: string): void => {
      setSelectedId(id)
      setToolName('')
      setOutcome(null)
      setNotifications([])
      refreshNotifications(id)
    }

    const pickTool = (name: string): void => {
      const picked = selected === null ? undefined : selected.tools.find((one) => one.name === name)
      const nextFields = fieldsOf(picked?.parameters)
      setToolName(name)
      setValues({})
      setRawText(seedArguments(nextFields))
      setMode('form')
      setOutcome(null)
      setCopyState('')
    }

    /** Switch editors, seeding the other one from what this one holds. */
    const switchMode = (next: ParamMode): void => {
      if (next === mode) return
      if (next === 'raw') {
        const prepared = buildArguments(fields, values)
        setRawText(JSON.stringify(prepared.args ?? {}, null, 2))
      } else {
        const prepared = parseRawArguments(rawText)
        const restored: Record<string, string> = {}
        for (const field of fields) {
          const value = prepared.args?.[field.name]
          if (value === undefined) continue
          restored[field.name] = typeof value === 'string' ? value : JSON.stringify(value)
        }
        setValues(restored)
      }
      setMode(next)
    }

    const run = (): void => {
      if (tool === null || selected === null || running) return
      const prepared = mode === 'raw' ? parseRawArguments(rawText) : buildArguments(fields, values)
      if (prepared.args === undefined) {
        remember(tool.name, { ok: false, durationMs: 0, refusal: prepared.refusal })
        return
      }
      setRunning(true)
      const startedAt = Date.now()
      api('/debug/call', {
        method: 'POST',
        body: JSON.stringify({ id: selected.id, tool: tool.name, arguments: prepared.args }),
      })
        .then((result) => {
          const body = result.body ?? {}
          const answered: CallOutcome =
            result.ok && typeof body.ok === 'boolean'
              ? {
                  ok: body.ok === true,
                  durationMs:
                    typeof body.durationMs === 'number' ? body.durationMs : Date.now() - startedAt,
                  result: body.result,
                  error: typeof body.error === 'string' && body.error !== '' ? body.error : undefined,
                }
              : {
                  ok: false,
                  durationMs: Date.now() - startedAt,
                  error: String(body.error ?? `HTTP ${result.status}`),
                }
          remember(tool.name, answered)
          setRunning(false)
          refreshNotifications(selected.id)
        })
        .catch((error: unknown) => {
          remember(tool.name, {
            ok: false,
            durationMs: Date.now() - startedAt,
            error: String(error),
          })
          setRunning(false)
        })
    }

    const copyInput = (): void => {
      const prepared = mode === 'raw' ? parseRawArguments(rawText) : buildArguments(fields, values)
      void copyText(JSON.stringify(prepared.args ?? {}, null, 2)).then((ok) => {
        setCopyState(ok ? 'copied' : 'failed')
        setTimeout(() => setCopyState(''), COPY_FEEDBACK_MS)
      })
    }

    const clearInput = (): void => {
      setValues({})
      setRawText(seedArguments(fields))
      setOutcome(null)
      setCopyState('')
    }

    /** Restart or disconnect one server through the settings page's own route. */
    const act = (server: DebugServer, action: 'restart' | 'stop'): void => {
      setActionBusy(true)
      api(`/servers/${encodeURIComponent(server.id)}/${action}`, { method: 'POST' })
        .then((result) => {
          setActionBusy(false)
          refreshAll()
          if (!result.ok) {
            remember(
              action === 'restart' ? t('restart') : t('stop'),
              {
                ok: false,
                durationMs: 0,
                error: t(action === 'restart' ? 'restartFailed' : 'stopFailed', { status: result.status }),
              },
            )
          }
        })
        .catch(() => setActionBusy(false))
    }

    return (
      <div className="smkit-mcpdebug-page">
        <div className="smkit-mcpdebug-page-head">
          <h2 className="smkit-mcpdebug-page-title">{t('pageTitle')}</h2>
          <span className="smkit-mcpdebug-page-spacer" aria-hidden="true" />
          <button
            className="smkit-ui-button"
            type="button"
            disabled={actionBusy}
            onClick={() => {
              refreshAll()
              refreshNotifications(selectedKey)
            }}
          >
            {t('refresh')}
          </button>
        </div>
        <p className="smkit-mcpdebug-page-intro">{t('pageIntro')}</p>
        <div className="smkit-mcpdebug-page-body">
          <ServerColumn
            t={t}
            groups={groups}
            selectedId={selectedKey}
            busy={actionBusy}
            onSelect={pickServer}
            onRestart={(server) => act(server, 'restart')}
            onStop={(server) => act(server, 'stop')}
          />
          <ToolColumn
            t={t}
            server={selected}
            tools={tools}
            query={query}
            selectedTool={toolName}
            busy={running}
            notConnected={selected !== null && selected.status !== 'connected'}
            history={history}
            onQuery={setQuery}
            onSelectTool={pickTool}
            onRefresh={refreshAll}
            onPickHistory={(row) => {
              setToolName(row.tool)
              setOutcome({
                ok: row.ok,
                durationMs: row.durationMs,
                result: row.result,
                error: row.error,
                refusal: row.refusal,
              })
            }}
            onClearHistory={() => setHistory([])}
          />
          <ToolDetail
            t={t}
            tool={tool}
            fields={fields}
            mode={mode}
            values={values}
            rawText={rawText}
            running={running}
            outcome={outcome}
            copyState={copyState}
            notifications={notifications}
            notConnected={selected !== null && selected.status !== 'connected'}
            onMode={switchMode}
            onValue={(name, value) => setValues({ ...values, [name]: value })}
            onRawText={setRawText}
            onRun={run}
            onCopy={copyInput}
            onClearInput={clearInput}
            onClearNotifications={() => {
              const id = selectedKey
              setNotifications([])
              if (id === '') return
              api('/debug/notifications/clear', {
                method: 'POST',
                body: JSON.stringify({ id }),
              }).catch(() => {})
            }}
          />
        </div>
      </div>
    )
  }
}
