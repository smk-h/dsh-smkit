/**
 * The left column: every server the plugin knows about, and the transport
 * facts of the one selected.
 *
 * The list is grouped exactly as the settings page groups it — the global tier
 * first, then one group per workspace — because the two surfaces answer the same
 * question ("what can this project reach") and a reader who has sorted that out
 * once should not have to sort it out again.
 *
 * The facts block is read-only on purpose: this page debugs a running server, it
 * does not configure one. The only two writes it offers are the two the settings
 * page's rows also offer — restart and disconnect — because a debugger that
 * cannot rebuild a wedged server is not a debugger.
 */

import type { ClientDeps, Translator } from '../../../platform/types'
import { isDown, statusKey } from '../status'
import type { DebugGroup, DebugServer } from '../types'

export interface ServerColumnProps {
  t: Translator
  groups: DebugGroup[]
  selectedId: string
  /** Restart / disconnect are in flight, or the poll is. */
  busy: boolean
  onSelect(id: string): void
  onRestart(server: DebugServer): void
  onStop(server: DebugServer): void
}

export function createServerColumn(deps: ClientDeps): (props: ServerColumnProps) => JSX.Element {
  const { h } = deps

  /** One fact row: a label and the value beside it, in the monospace face. */
  const fact = (label: string, value: string): JSX.Element => (
    <div className="smkit-mcpdebug-servers-fact" key={label}>
      <span className="smkit-mcpdebug-servers-fact-label">{label}</span>
      <span className="smkit-mcpdebug-servers-fact-value" title={value}>
        {value}
      </span>
    </div>
  )

  return function ServerColumn({
    t,
    groups,
    selectedId,
    busy,
    onSelect,
    onRestart,
    onStop,
  }: ServerColumnProps): JSX.Element {
    const total = groups.reduce((sum, group) => sum + group.servers.length, 0)
    const selected =
      groups.flatMap((group) => group.servers).find((server) => server.id === selectedId) ?? null
    const facts: JSX.Element[] = []
    if (selected) {
      const transport =
        selected.type === 'stdio'
          ? [selected.command, ...(selected.args ?? [])].filter(Boolean).join(' ')
          : (selected.url ?? '')
      facts.push(fact(t('transportCommand'), transport))
      if (selected.type === 'stdio' && selected.cwd) facts.push(fact(t('transportCwd'), selected.cwd))
      // The rest of a stdio server's environment is worth one folded line: it is
      // where a bridge's path or port is spelled out, and it is the first thing
      // a reader checks when a server came up but answers nothing.
      const envNames = Object.keys(selected.env ?? {})
      if (envNames.length > 0) {
        facts.push(fact(t('transportEnv'), envNames.join(', ')))
      }
      if (selected.error) facts.push(fact(t('statusError'), selected.error))
    }
    const info = selected?.serverInfo ?? null
    const identity =
      info !== null && (info.name !== undefined || info.version !== undefined)
        ? t('serverVersion', { name: info.name ?? '', version: info.version ?? '' }).trim()
        : ''

    return (
      <aside className="smkit-mcpdebug-servers">
        <div className="smkit-mcpdebug-servers-head">
          <h3 className="smkit-mcpdebug-servers-title">{t('serversTitle')}</h3>
          <span className="smkit-mcpdebug-servers-total">
            {t(total === 1 ? 'serverTotalOne' : 'serverTotal', { count: total })}
          </span>
        </div>
        <div className="smkit-mcpdebug-servers-list">
          {total === 0 ? <p className="smkit-mcpdebug-servers-empty">{t('serversEmpty')}</p> : null}
          {groups.map((group) => (
            <div className="smkit-mcpdebug-servers-group" key={group.path || 'global'}>
              <div className="smkit-mcpdebug-servers-group-name" title={group.path}>
                {group.label}
              </div>
              {group.servers.map((server) => (
                <button
                  className="smkit-mcpdebug-servers-row"
                  type="button"
                  data-smkit-active={server.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect(server.id)}
                  key={server.id}
                >
                  <span
                    className="smkit-mcpdebug-servers-dot"
                    data-smkit-status={server.status}
                    aria-hidden="true"
                  />
                  <span className="smkit-mcpdebug-servers-name" title={server.name}>
                    {server.name}
                  </span>
                  <span className="smkit-mcpdebug-servers-count">
                    {t(server.tools.length === 1 ? 'toolCountOne' : 'toolCount', {
                      count: server.tools.length,
                    })}
                  </span>
                  <span className="smkit-mcpdebug-servers-state">{t(statusKey(server.status))}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        {selected ? (
          <div className="smkit-mcpdebug-servers-facts">
            <div className="smkit-mcpdebug-servers-facts-head">
              <span className="smkit-mcpdebug-servers-type">
                {selected.type === 'stdio' ? t('typeStdio') : t('typeHttp')}
              </span>
              <span className="smkit-mcpdebug-servers-spacer" aria-hidden="true" />
              <button
                className="smkit-ui-button"
                type="button"
                disabled={busy}
                onClick={() => onRestart(selected)}
              >
                {t('restart')}
              </button>
              <button
                className="smkit-ui-button"
                type="button"
                disabled={busy}
                onClick={() => onStop(selected)}
              >
                {t('stop')}
              </button>
            </div>
            {identity === '' ? null : (
              <div className="smkit-mcpdebug-servers-identity" title={identity}>
                {identity}
              </div>
            )}
            {facts}
            {isDown(selected.status) ? (
              <p className="smkit-mcpdebug-servers-hint">{t('notConnectedHint')}</p>
            ) : null}
          </div>
        ) : null}
      </aside>
    )
  }
}
