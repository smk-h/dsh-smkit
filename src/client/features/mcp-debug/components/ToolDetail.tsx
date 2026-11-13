/**
 * The right column: one tool's parameters, its answer, and what the server
 * pushed while the page was open.
 *
 * The parameters are the tool's own schema, rendered one row per declared
 * property. Two editing modes sit on the same state: the form (a control per
 * declared type) and the raw box (the whole `arguments` object as JSON), because
 * neither is enough on its own — a form is the only way to see which parameters
 * *exist*, and a box is the only way to paste an object a bug report quoted.
 * Switching seeds the other from what the current one holds, so the switch never
 * silently drops input.
 *
 * The answer is shown twice on purpose: the content blocks as the server sent
 * them (text as text, an image as an image), and the whole JSON-RPC result
 * verbatim below. A debug surface that shows only a pretty rendering hides the
 * field the reader came for.
 */

import type { ClientDeps, Translator } from '../../../platform/types'
import type { CallOutcome, DebugNotificationView, ToolView } from '../types'
import type { FieldSpec } from '../schema'

/** Which editor the parameter pane is in. */
export type ParamMode = 'form' | 'raw'

export interface ToolDetailProps {
  t: Translator
  tool: ToolView | null
  fields: FieldSpec[]
  mode: ParamMode
  /** One raw string per field, keyed by name. */
  values: Record<string, string>
  rawText: string
  running: boolean
  outcome: CallOutcome | null
  /** Empty, `copied` or `failed` — the copy button's short-lived answer. */
  copyState: string
  notifications: DebugNotificationView[]
  /** The selected server has no live transport: nothing here can be run. */
  notConnected: boolean
  onMode(mode: ParamMode): void
  onValue(name: string, value: string): void
  onRawText(text: string): void
  onRun(): void
  onCopy(): void
  onClearInput(): void
  onClearNotifications(): void
}

/** One content block, as far as this pane reads it. */
interface ContentBlock {
  type?: unknown
  text?: unknown
  data?: unknown
  mimeType?: unknown
}

/** The `content` array of one tool result, when the server sent one. */
function contentOf(result: unknown): ContentBlock[] {
  if (result === null || typeof result !== 'object') return []
  const content = (result as { content?: unknown }).content
  return Array.isArray(content) ? (content as ContentBlock[]) : []
}

/** A JSON value as the preformatted text this pane prints it as. */
function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return String(value)
  }
}

/** `HH:MM:SS` in the reader's own locale. */
function clock(at: number): string {
  try {
    return new Date(at).toLocaleTimeString()
  } catch {
    return ''
  }
}

export function createToolDetail(deps: ClientDeps): (props: ToolDetailProps) => JSX.Element {
  const { h } = deps

  return function ToolDetail({
    t,
    tool,
    fields,
    mode,
    values,
    rawText,
    running,
    outcome,
    copyState,
    notifications,
    notConnected,
    onMode,
    onValue,
    onRawText,
    onRun,
    onCopy,
    onClearInput,
    onClearNotifications,
  }: ToolDetailProps): JSX.Element {
    if (tool === null) {
      return (
        <section className="smkit-mcpdebug-detail">
          <p className="smkit-mcpdebug-detail-empty">
            {notConnected ? t('notConnectedHint') : t('detailEmpty')}
          </p>
        </section>
      )
    }

    /** The control one declared parameter gets, by its declared type. */
    const control = (field: FieldSpec): JSX.Element => {
      const value = values[field.name] ?? ''
      if (field.enumValues !== null) {
        return (
          <select
            className="smkit-mcpdebug-detail-input"
            value={value}
            aria-label={field.name}
            onChange={(event) => onValue(field.name, event.target.value)}
          >
            <option value="">{t('paramUnset')}</option>
            {field.enumValues.map((member) => (
              <option value={String(member)} key={String(member)}>
                {String(member)}
              </option>
            ))}
          </select>
        )
      }
      if (field.type === 'boolean') {
        return (
          <select
            className="smkit-mcpdebug-detail-input"
            value={value}
            aria-label={field.name}
            onChange={(event) => onValue(field.name, event.target.value)}
          >
            <option value="">{t('paramUnset')}</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        )
      }
      if (field.type === 'object' || field.type === 'array') {
        return (
          <textarea
            className="smkit-mcpdebug-detail-textarea"
            rows={3}
            value={value}
            placeholder={field.type === 'array' ? '[]' : '{}'}
            aria-label={field.name}
            onChange={(event) => onValue(field.name, event.target.value)}
          />
        )
      }
      return (
        <input
          className="smkit-mcpdebug-detail-input"
          type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
          value={value}
          aria-label={field.name}
          onChange={(event) => onValue(field.name, event.target.value)}
        />
      )
    }

    const blocks = outcome === null ? [] : contentOf(outcome.result)
    const resultText =
      outcome === null
        ? ''
        : outcome.refusal !== undefined
          ? t(outcome.refusal.key, outcome.refusal.values)
          : (outcome.error ?? '')

    return (
      <section className="smkit-mcpdebug-detail">
        <div className="smkit-mcpdebug-detail-head">
          <span className="smkit-mcpdebug-detail-name">{tool.name}</span>
          <span className="smkit-mcpdebug-detail-kind">{t('toolKind')}</span>
        </div>
        <p className="smkit-mcpdebug-detail-desc">
          {tool.description === '' ? t('noDescription') : tool.description}
        </p>

        <div className="smkit-mcpdebug-detail-subhead">
          <span className="smkit-mcpdebug-detail-subtitle">{t('paramsTitle')}</span>
          <span className="smkit-mcpdebug-detail-spacer" aria-hidden="true" />
          {/* A segmented pair rather than two loose buttons: which editor is in
              force has to survive the pointer leaving, so the active half is
              tinted and marked pressed — a hover wash would read as "about to
              act" instead of "you are here". */}
          <span className="smkit-mcpdebug-detail-modes" role="group" aria-label={t('paramsTitle')}>
            <button
              className="smkit-ui-button"
              type="button"
              aria-pressed={mode === 'form'}
              data-smkit-active={mode === 'form' ? 'true' : undefined}
              onClick={() => onMode('form')}
            >
              {t('paramsModeForm')}
            </button>
            <button
              className="smkit-ui-button"
              type="button"
              aria-pressed={mode === 'raw'}
              data-smkit-active={mode === 'raw' ? 'true' : undefined}
              onClick={() => onMode('raw')}
            >
              {t('paramsModeRaw')}
            </button>
          </span>
        </div>

        {mode === 'raw' ? (
          <textarea
            className="smkit-mcpdebug-detail-raw"
            rows={8}
            value={rawText}
            spellCheck={false}
            aria-label={t('paramsModeRaw')}
            onChange={(event) => onRawText(event.target.value)}
          />
        ) : fields.length === 0 ? (
          <p className="smkit-mcpdebug-detail-empty-line">{t('paramsEmpty')}</p>
        ) : (
          <div className="smkit-mcpdebug-detail-params">
            {fields.map((field) => (
              <div className="smkit-mcpdebug-detail-field" key={field.name}>
                <div className="smkit-mcpdebug-detail-field-head">
                  <span className="smkit-mcpdebug-detail-field-name">{field.name}</span>
                  <span className="smkit-mcpdebug-detail-field-type">{field.type}</span>
                  {field.required ? (
                    <span className="smkit-mcpdebug-detail-field-req">{t('paramsRequired')}</span>
                  ) : null}
                </div>
                {field.description === '' ? null : (
                  <div className="smkit-mcpdebug-detail-field-desc">{field.description}</div>
                )}
                {control(field)}
              </div>
            ))}
          </div>
        )}

        <div className="smkit-mcpdebug-detail-actions">
          {/* The label is the pending state (it says so), rather than the
              platform's `data-smkit-pending` ellipsis: that overlay blanks the
              label, which would hide the very word that explains the wait. */}
          <button
            className="smkit-ui-button primary smkit-mcpdebug-detail-run"
            type="button"
            disabled={running}
            onClick={onRun}
          >
            {running ? t('running') : t('run')}
          </button>
          <button className="smkit-ui-button" type="button" onClick={onCopy}>
            {copyState === 'copied' ? t('copied') : copyState === 'failed' ? t('copyFailed') : t('copyInput')}
          </button>
          <button className="smkit-ui-button" type="button" onClick={onClearInput}>
            {t('clearInput')}
          </button>
        </div>

        <div className="smkit-mcpdebug-detail-subhead">
          <span className="smkit-mcpdebug-detail-subtitle">{t('resultTitle')}</span>
          {outcome === null ? null : (
            <span
              className="smkit-mcpdebug-detail-badge"
              data-smkit-ok={outcome.ok ? 'true' : 'false'}
            >
              {outcome.refusal !== undefined
                ? t('resultRefused')
                : outcome.ok
                  ? t('resultOk')
                  : t('resultError')}
            </span>
          )}
          {outcome === null ? null : (
            <span className="smkit-mcpdebug-detail-duration">
              {t('resultDuration', { ms: outcome.durationMs })}
            </span>
          )}
        </div>
        {outcome === null ? (
          <p className="smkit-mcpdebug-detail-empty-line">{t('resultEmpty')}</p>
        ) : (
          <div className="smkit-mcpdebug-detail-result">
            {resultText === '' ? null : (
              <p className="smkit-mcpdebug-detail-message" data-smkit-ok={outcome.ok ? 'true' : 'false'}>
                {resultText}
              </p>
            )}
            {blocks.length === 0 ? null : (
              <div className="smkit-mcpdebug-detail-content">
                {blocks.map((block, index) => {
                  if (block.type === 'text' && typeof block.text === 'string') {
                    return (
                      <pre className="smkit-mcpdebug-detail-text" key={String(index)}>
                        {block.text}
                      </pre>
                    )
                  }
                  if (block.type === 'image' && typeof block.data === 'string') {
                    const mime = typeof block.mimeType === 'string' ? block.mimeType : 'image/png'
                    return (
                      <img
                        className="smkit-mcpdebug-detail-image"
                        src={`data:${mime};base64,${block.data}`}
                        alt={mime}
                        key={String(index)}
                      />
                    )
                  }
                  return (
                    <pre className="smkit-mcpdebug-detail-text" key={String(index)}>
                      {pretty(block)}
                    </pre>
                  )
                })}
              </div>
            )}
            {outcome.result === undefined ? null : (
              <details className="smkit-mcpdebug-detail-rawblock">
                <summary className="smkit-mcpdebug-detail-rawsummary">{t('resultRaw')}</summary>
                <pre className="smkit-mcpdebug-detail-text">{pretty(outcome.result)}</pre>
              </details>
            )}
          </div>
        )}

        <div className="smkit-mcpdebug-detail-subhead">
          <span className="smkit-mcpdebug-detail-subtitle">{t('notificationsTitle')}</span>
          <span className="smkit-mcpdebug-detail-spacer" aria-hidden="true" />
          {notifications.length === 0 ? null : (
            <button className="smkit-ui-button" type="button" onClick={onClearNotifications}>
              {t('notificationsClear')}
            </button>
          )}
        </div>
        <div className="smkit-mcpdebug-detail-notifications">
          {notifications.length === 0 ? (
            <p className="smkit-mcpdebug-detail-empty-line">{t('notificationsEmpty')}</p>
          ) : (
            // Newest first: the frame a reader wants is the one that just
            // arrived, and the ring is kept oldest-first for the sequence.
            [...notifications].reverse().map((note) => (
              <details className="smkit-mcpdebug-detail-note" key={note.seq}>
                <summary className="smkit-mcpdebug-detail-note-head">
                  <span className="smkit-mcpdebug-detail-note-seq">{note.seq}</span>
                  <span className="smkit-mcpdebug-detail-note-method">{note.method}</span>
                  <span className="smkit-mcpdebug-detail-note-time">{clock(note.at)}</span>
                </summary>
                {note.truncated === true ? (
                  <p className="smkit-mcpdebug-detail-empty-line">{t('notificationTruncated')}</p>
                ) : note.params === undefined ? null : (
                  <pre className="smkit-mcpdebug-detail-text">{pretty(note.params)}</pre>
                )}
              </details>
            ))
          )}
        </div>
      </section>
    )
  }
}
