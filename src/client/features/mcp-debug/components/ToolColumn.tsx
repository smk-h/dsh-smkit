/**
 * The middle column: one server's tools, and the calls already made.
 *
 * The rows are the server's own `tools/list` entries — the raw name, the raw
 * description, in the server's order — because that is what an inspector is for.
 * The model-facing `mcp__<server>__<tool>` name is deliberately not shown: it is
 * a projection this plugin builds, and a reader debugging a server wants the
 * name the server will be asked for.
 *
 * The history is the page's own, not the server's: it holds the calls made in
 * this tab's lifetime, newest first, and clicking one brings its answer back
 * into the right column. That is the one thing a terminal-style dump cannot do.
 */

import type { ClientDeps, Translator } from '../../../platform/types'
import type { DebugServer, HistoryRow, ToolView } from '../types'

export interface ToolColumnProps {
  t: Translator
  server: DebugServer | null
  /** The matching tools, already filtered by `query`. */
  tools: ToolView[]
  query: string
  selectedTool: string
  /** The poll or a call is in flight. */
  busy: boolean
  /** The selected server has no live transport, so an empty list needs its own words. */
  notConnected: boolean
  history: HistoryRow[]
  onQuery(next: string): void
  onSelectTool(name: string): void
  onRefresh(): void
  onPickHistory(row: HistoryRow): void
  onClearHistory(): void
}

/** `HH:MM:SS` in the reader's own locale, from one epoch millisecond. */
function clock(at: number): string {
  try {
    return new Date(at).toLocaleTimeString()
  } catch {
    return ''
  }
}

/** The one-word verdict of a history row. */
function verdict(t: Translator, row: HistoryRow): string {
  return row.ok ? t('resultOk') : t('resultError')
}

export function createToolColumn(deps: ClientDeps): (props: ToolColumnProps) => JSX.Element {
  const { h } = deps

  return function ToolColumn({
    t,
    server,
    tools,
    query,
    selectedTool,
    busy,
    notConnected,
    history,
    onQuery,
    onSelectTool,
    onRefresh,
    onPickHistory,
    onClearHistory,
  }: ToolColumnProps): JSX.Element {
    // "This server lists no tools" and "this server is not connected" are
    // different facts, and the second one is the one a reader can act on: the
    // list is empty because there is nothing to ask, not because the server has
    // no tools. It is also what a click on a dormant server has to say — the row
    // stays selected instead of bouncing back to a live one.
    let empty = ''
    if (server === null) empty = t('toolsPickServer')
    else if (notConnected) empty = t('notConnectedHint')
    else if (server.tools.length === 0) empty = t('toolsEmpty')
    else if (tools.length === 0) empty = t('toolSearchEmpty')

    return (
      <section className="smkit-mcpdebug-tools">
        <div className="smkit-mcpdebug-tools-head">
          <h3 className="smkit-mcpdebug-tools-title">{t('toolsTitle')}</h3>
          <span className="smkit-mcpdebug-tools-total">
            {t(
              (server === null ? 0 : server.tools.length) === 1 ? 'toolCountOne' : 'toolCount',
              { count: server === null ? 0 : server.tools.length },
            )}
          </span>
          <span className="smkit-mcpdebug-tools-spacer" aria-hidden="true" />
          <button
            className="smkit-ui-button"
            type="button"
            disabled={busy || server === null}
            onClick={onRefresh}
          >
            {t('refresh')}
          </button>
        </div>
        <label className="smkit-mcpdebug-tools-search">
          <input
            className="smkit-mcpdebug-tools-search-input"
            type="search"
            value={query}
            placeholder={t('toolSearch')}
            aria-label={t('toolSearch')}
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>
        <div className="smkit-mcpdebug-tools-list">
          {tools.map((tool) => (
            <button
              className="smkit-mcpdebug-tools-row"
              type="button"
              data-smkit-active={tool.name === selectedTool ? 'true' : undefined}
              onClick={() => onSelectTool(tool.name)}
              key={tool.name}
            >
              <span className="smkit-mcpdebug-tools-row-name">{tool.name}</span>
              <span className="smkit-mcpdebug-tools-row-desc">
                {tool.description === '' ? t('noDescription') : tool.description}
              </span>
            </button>
          ))}
          {empty === '' ? null : <p className="smkit-mcpdebug-tools-empty">{empty}</p>}
        </div>
        <div className="smkit-mcpdebug-tools-history">
          <div className="smkit-mcpdebug-tools-history-head">
            <span className="smkit-mcpdebug-tools-history-title">{t('historyTitle')}</span>
            <span className="smkit-mcpdebug-tools-spacer" aria-hidden="true" />
            {history.length === 0 ? null : (
              <button className="smkit-ui-button" type="button" onClick={onClearHistory}>
                {t('historyClear')}
              </button>
            )}
          </div>
          <div className="smkit-mcpdebug-tools-history-list">
            {history.length === 0 ? (
              <p className="smkit-mcpdebug-tools-empty">{t('historyEmpty')}</p>
            ) : (
              history.map((row, index) => (
                <button
                  className="smkit-mcpdebug-tools-history-row"
                  type="button"
                  data-smkit-ok={row.ok ? 'true' : 'false'}
                  onClick={() => onPickHistory(row)}
                  key={row.id}
                >
                  {/* The number counts up from the oldest call, as the
                      Inspector's history does: a reader says "call 3", not
                      "call at 14:02:31". */}
                  <span className="smkit-mcpdebug-tools-history-seq">{history.length - index}</span>
                  <span className="smkit-mcpdebug-tools-history-name">{row.tool}</span>
                  <span className="smkit-mcpdebug-tools-history-meta">
                    {verdict(t, row)} · {t('resultDuration', { ms: row.durationMs })}
                  </span>
                  <span className="smkit-mcpdebug-tools-history-time">{clock(row.at)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </section>
    )
  }
}
