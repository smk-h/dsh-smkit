/**
 * Add/edit form for a server, shared by the global and workspace tiers.
 *
 * The tier is chosen by the `scope` picker (locked while editing) and decides
 * both the request target (`/servers` vs `/workspaces/servers`) and whether a
 * workspace picker is shown. The transport select swaps the whole field set, so
 * the form only ever submits the fields that belong to the chosen transport.
 *
 * The three key/value lists (env, headers, headers-from-env) are one component;
 * only their labels and placeholders differ.
 */

import { createFolderIcon } from '../icons/FolderIcon'
import { createMonitorIcon } from '../icons/MonitorIcon'
import { createKeyValueEditor, toKeyValueMap, toKeyValueRows } from '../ui/KeyValueEditor'
import { createIconSelect } from '../ui/IconSelect'
import { useAsyncAction } from '../../../platform/ui/useAsyncAction'
import type { ApiResult, ClientDeps, Translator } from '../../../platform/types'
import type { EditableServer, KeyValueRow } from '../types'

export interface ServerFormProps {
  t: Translator
  initial?: EditableServer | null
  onDone(): void
  onCancel(): void
  scope?: string
  workspacePath?: string
  workspaces?: string[]
}

export function createServerForm(deps: ClientDeps): (props: ServerFormProps) => JSX.Element {
  const { h, react, api } = deps
  const KeyValueEditor = createKeyValueEditor(deps)
  const IconSelect = createIconSelect(deps)
  const MonitorIcon = createMonitorIcon(deps)
  const FolderIcon = createFolderIcon(deps)

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
    const [headersList, setHeadersList] = react.useState<KeyValueRow[]>(
      toKeyValueRows(initial?.headers),
    )
    const [headerEnvList, setHeaderEnvList] = react.useState<KeyValueRow[]>(
      toKeyValueRows(initial?.headerEnv),
    )
    const [command, setCommand] = react.useState(initial?.command ?? '')
    const initialArgs = initial?.args ?? []
    const [argsList, setArgsList] = react.useState<string[]>(
      initialArgs.length ? initialArgs.map(String) : [''],
    )
    const [envList, setEnvList] = react.useState<KeyValueRow[]>(toKeyValueRows(initial?.env))
    const [cwd, setCwd] = react.useState(initial?.cwd ?? '')
    const { busy, error, setError, run } = useAsyncAction(react)

    const isWorkspace = formScope === 'workspace'

    const submit = (): Promise<void> => {
      if (isWorkspace && !wsPath) {
        setError(t('chooseWorkspaceError'))
        return Promise.resolve()
      }
      return run(async () => {
        const body: Record<string, unknown> =
          type === 'stdio'
            ? {
                name,
                type: 'stdio',
                command,
                cwd,
                args: argsList.map((arg) => arg.trim()).filter(Boolean),
                env: toKeyValueMap(envList),
              }
            : {
                name,
                type: 'http',
                url,
                authMode,
                headers: toKeyValueMap(headersList),
                headerEnv: toKeyValueMap(headerEnvList),
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
        if (r.ok) {
          onDone()
          return
        }
        return r.body.error || t(editing ? 'saveFailed' : 'addFailed', { status: r.status })
      })
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
            <KeyValueEditor
              key="environment"
              t={t}
              label={t('environment')}
              rows={envList}
              onChange={setEnvList}
              keyPlaceholder={t('keyUpper')}
              valuePlaceholder={t('valueUpper')}
              addLabel={t('addEnvironment')}
              busy={busy}
            />,
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
                <option value="none">{t('noAuthOption')}</option>
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
            <KeyValueEditor
              key="headers"
              t={t}
              label={t('headers')}
              rows={headersList}
              onChange={setHeadersList}
              keyPlaceholder={t('key')}
              valuePlaceholder={t('value')}
              addLabel={t('addHeader')}
              busy={busy}
            />,
            <KeyValueEditor
              key="headerEnv"
              t={t}
              label={t('headerEnv')}
              rows={headerEnvList}
              onChange={setHeaderEnvList}
              keyPlaceholder={t('key')}
              valuePlaceholder={t('envName')}
              addLabel={t('addVariable')}
              busy={busy}
            />,
          ]

    return (
      <div className="mm_row mm_add">
        <div className="mm_form">
          {/* The two scope pickers are custom dropdowns (not `<label>`-wrapped:
              a label would forward caption clicks into the trigger button) so
              their options can carry the same monitor/folder icons the list
              view's scope picker uses. */}
          <div className="wide mm_field">
            <span>{t('scope')}</span>
            <IconSelect
              value={formScope}
              disabled={editing}
              ariaLabel={t('scope')}
              onChange={setFormScope}
              options={[
                { value: 'user', label: t('userScope'), icon: <MonitorIcon /> },
                { value: 'workspace', label: t('workspaceScope'), icon: <FolderIcon /> },
              ]}
            />
          </div>
          {isWorkspace ? (
            <div className="wide mm_field">
              <span>{t('workspace')}</span>
              <IconSelect
                value={wsPath}
                disabled={editing}
                ariaLabel={t('workspace')}
                onChange={setWsPath}
                options={[
                  { value: '', label: t('chooseWorkspace') },
                  ...(workspaces ?? []).map((workspace) => ({
                    value: workspace,
                    label: workspace,
                    icon: <FolderIcon />,
                  })),
                ]}
              />
            </div>
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
            data-pending={busy ? 'true' : undefined}
            aria-busy={busy}
          >
            {t('save')}
          </button>
          <button className="mm_btn" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </button>
        </div>
      </div>
    )
  }
}
