/**
 * Add/edit form for a server, shared by the global and workspace tiers.
 *
 * The tier is chosen by the `scope` select (locked while editing) and decides
 * both the request target (`/servers` vs `/workspaces/servers`) and whether a
 * workspace picker is shown. The transport select swaps the whole field set, so
 * the form only ever submits the fields that belong to the chosen transport.
 */

import type { ApiResult, ClientDeps, EditableServer, KeyValueRow, Translator } from '../types'

export interface ServerFormProps {
  t: Translator
  initial?: EditableServer | null
  onDone(): void
  onCancel(): void
  scope?: string
  workspacePath?: string
  workspaces?: string[]
}

const EMPTY_ROW: KeyValueRow = { key: '', value: '' }

/** Object → editable rows, falling back to one blank row. */
function toRows(source: Record<string, unknown> | undefined): KeyValueRow[] {
  return source ? Object.entries(source).map(([key, value]) => ({ key, value: String(value) })) : [{ ...EMPTY_ROW }]
}

/** Rows → flat map, dropping keys that were left blank. */
function toMap(rows: KeyValueRow[]): Record<string, string> {
  return rows.reduce<Record<string, string>>((acc, row) => {
    const key = row.key.trim()
    if (key) acc[key] = row.value
    return acc
  }, {})
}

export function createServerForm(deps: ClientDeps): (props: ServerFormProps) => JSX.Element {
  const { h, react, api } = deps

  return function ServerForm({
    t,
    initial,
    onDone,
    onCancel,
    scope,
    workspacePath,
    workspaces,
  }: ServerFormProps): JSX.Element {
    const editing = initial != null
    const [formScope, setFormScope] = react.useState(scope ?? 'user')
    const [wsPath, setWsPath] = react.useState(workspacePath ?? '')
    const [type, setType] = react.useState<'http' | 'stdio'>(initial?.type ?? 'http')
    const [name, setName] = react.useState(initial?.name ?? '')
    const [url, setUrl] = react.useState(initial?.url ?? '')
    const [authMode, setAuthMode] = react.useState<string>(initial?.authMode ?? 'oauth')
    const [tokenEnv, setTokenEnv] = react.useState(initial?.tokenEnv ?? '')
    const [headersList, setHeadersList] = react.useState<KeyValueRow[]>(toRows(initial?.headers))
    const [headerEnvList, setHeaderEnvList] = react.useState<KeyValueRow[]>(toRows(initial?.headerEnv))
    const [command, setCommand] = react.useState(initial?.command ?? '')
    const initialArgs = initial?.args ?? []
    const [argsList, setArgsList] = react.useState<string[]>(
      initialArgs.length ? initialArgs.map(String) : [''],
    )
    const [envList, setEnvList] = react.useState<KeyValueRow[]>(toRows(initial?.env))
    const [cwd, setCwd] = react.useState(initial?.cwd ?? '')
    const [busy, setBusy] = react.useState(false)
    const [error, setError] = react.useState('')

    const isWorkspace = formScope === 'workspace'

    const submit = async (): Promise<void> => {
      if (isWorkspace && !wsPath) {
        setError(t('chooseWorkspaceError'))
        return
      }
      setBusy(true)
      setError('')
      try {
        const body: Record<string, unknown> =
          type === 'stdio'
            ? {
                name,
                type: 'stdio',
                command,
                cwd,
                args: argsList.map((arg) => arg.trim()).filter(Boolean),
                env: toMap(envList),
              }
            : {
                name,
                type: 'http',
                url,
                authMode,
                headers: toMap(headersList),
                headerEnv: toMap(headerEnvList),
                ...(authMode === 'static' ? { tokenEnv } : {}),
              }
        let r: ApiResult
        if (isWorkspace) {
          r = editing
            ? await api('/workspaces/servers', {
                method: 'PUT',
                body: JSON.stringify({ path: wsPath, oldName: initial?.name, ...body }),
              })
            : await api('/workspaces/servers', {
                method: 'POST',
                body: JSON.stringify({ path: wsPath, ...body }),
              })
        } else if (editing) {
          r = await api(`/servers/${initial?.id}`, { method: 'PUT', body: JSON.stringify(body) })
        } else {
          r = await api('/servers', { method: 'POST', body: JSON.stringify(body) })
        }
        if (r.ok) onDone()
        else setError(r.body.error || t(editing ? 'saveFailed' : 'addFailed', { status: r.status }))
      } catch (e) {
        setError(String(e))
      }
      setBusy(false)
    }

    // The transport select swaps the whole field set: only these fields belong
    // to the chosen transport, and only these are submitted.
    const transportFields: (JSX.Element | null)[] =
      type === 'stdio'
        ? [
            <label className="wide" key="command">
              {t('command')}
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t('commandPlaceholder')}
              />
            </label>,
            <label className="wide" key="arguments">
              {t('arguments')}
              {argsList.map((arg, i) => (
                <div className="mm_kv" key={i}>
                  <input
                    value={arg}
                    onChange={(e) =>
                      setArgsList(argsList.map((value, index) => (index === i ? e.target.value : value)))
                    }
                    placeholder={t('argumentValue')}
                  />
                  <button
                    className="mm_btn"
                    onClick={() => setArgsList(argsList.filter((_, index) => index !== i))}
                    disabled={busy}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button className="mm_btn" onClick={() => setArgsList([...argsList, ''])} disabled={busy}>
                {t('addArgument')}
              </button>
            </label>,
            <label className="wide" key="environment">
              {t('environment')}
              {envList.map((entry, i) => (
                <div className="mm_kv" key={i}>
                  <input
                    value={entry.key}
                    onChange={(e) =>
                      setEnvList(
                        envList.map((value, index) =>
                          index === i ? { ...value, key: e.target.value } : value,
                        ),
                      )
                    }
                    placeholder={t('keyUpper')}
                  />
                  <input
                    value={entry.value}
                    onChange={(e) =>
                      setEnvList(
                        envList.map((value, index) =>
                          index === i ? { ...value, value: e.target.value } : value,
                        ),
                      )
                    }
                    placeholder={t('valueUpper')}
                  />
                  <button
                    className="mm_btn"
                    onClick={() => setEnvList(envList.filter((_, index) => index !== i))}
                    disabled={busy}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="mm_btn"
                onClick={() => setEnvList([...envList, { ...EMPTY_ROW }])}
                disabled={busy}
              >
                {t('addEnvironment')}
              </button>
            </label>,
            <label className="wide" key="cwd">
              {t('cwd')}
              <input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder={t('cwdPlaceholder')}
              />
            </label>,
          ]
        : [
            <label className="wide" key="url">
              {t('url')}
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t('urlPlaceholder')}
              />
            </label>,
            <label className="wide" key="authMode">
              {t('authMode')}
              <select value={authMode} onChange={(e) => setAuthMode(e.target.value)}>
                <option value="oauth">{t('oauth')}</option>
                <option value="static">{t('bearer')}</option>
              </select>
            </label>,
            authMode === 'static' ? (
              <label className="wide" key="tokenEnv">
                {t('tokenEnv')}
                <input
                  value={tokenEnv}
                  onChange={(e) => setTokenEnv(e.target.value)}
                  placeholder={t('tokenEnvPlaceholder')}
                />
              </label>
            ) : null,
            <label className="wide" key="headers">
              {t('headers')}
              {headersList.map((entry, i) => (
                <div className="mm_kv" key={i}>
                  <input
                    value={entry.key}
                    onChange={(e) =>
                      setHeadersList(
                        headersList.map((value, index) =>
                          index === i ? { ...value, key: e.target.value } : value,
                        ),
                      )
                    }
                    placeholder={t('key')}
                  />
                  <input
                    value={entry.value}
                    onChange={(e) =>
                      setHeadersList(
                        headersList.map((value, index) =>
                          index === i ? { ...value, value: e.target.value } : value,
                        ),
                      )
                    }
                    placeholder={t('value')}
                  />
                  <button
                    className="mm_btn"
                    onClick={() => setHeadersList(headersList.filter((_, index) => index !== i))}
                    disabled={busy}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="mm_btn"
                onClick={() => setHeadersList([...headersList, { ...EMPTY_ROW }])}
                disabled={busy}
              >
                {t('addHeader')}
              </button>
            </label>,
            <label className="wide" key="headerEnv">
              {t('headerEnv')}
              {headerEnvList.map((entry, i) => (
                <div className="mm_kv" key={i}>
                  <input
                    value={entry.key}
                    onChange={(e) =>
                      setHeaderEnvList(
                        headerEnvList.map((value, index) =>
                          index === i ? { ...value, key: e.target.value } : value,
                        ),
                      )
                    }
                    placeholder={t('key')}
                  />
                  <input
                    value={entry.value}
                    onChange={(e) =>
                      setHeaderEnvList(
                        headerEnvList.map((value, index) =>
                          index === i ? { ...value, value: e.target.value } : value,
                        ),
                      )
                    }
                    placeholder={t('envName')}
                  />
                  <button
                    className="mm_btn"
                    onClick={() => setHeaderEnvList(headerEnvList.filter((_, index) => index !== i))}
                    disabled={busy}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="mm_btn"
                onClick={() => setHeaderEnvList([...headerEnvList, { ...EMPTY_ROW }])}
                disabled={busy}
              >
                {t('addVariable')}
              </button>
            </label>,
          ]

    return (
      <div className="mm_row mm_add">
        <div className="mm_form">
          <label className="wide">
            {t('scope')}
            <select
              value={formScope}
              disabled={editing}
              onChange={(e) => setFormScope(e.target.value)}
            >
              <option value="user">{t('userScope')}</option>
              <option value="workspace">{t('workspaceScope')}</option>
            </select>
          </label>
          {isWorkspace ? (
            <label className="wide">
              {t('workspace')}
              <select value={wsPath} disabled={editing} onChange={(e) => setWsPath(e.target.value)}>
                <option value="">{t('chooseWorkspace')}</option>
                {(workspaces ?? []).map((workspace) => (
                  <option value={workspace} key={workspace}>
                    {workspace}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            {t('type')}
            <select
              value={type}
              onChange={(e) => setType(e.target.value === 'stdio' ? 'stdio' : 'http')}
            >
              <option value="http">{t('http')}</option>
              <option value="stdio">{t('stdio')}</option>
            </select>
          </label>
          <label>
            {t('name')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
            />
          </label>
          {transportFields}
        </div>
        {error ? <div className="mm_err">{error}</div> : null}
        <div className="mm_actions">
          <button
            className="mm_btn"
            onClick={submit}
            disabled={
              busy || !name || (isWorkspace && !wsPath) || (type === 'stdio' ? !command : !url)
            }
          >
            {busy ? '…' : t('save')}
          </button>
          <button className="mm_btn" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </button>
        </div>
      </div>
    )
  }
}
