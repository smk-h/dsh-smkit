/**
 * The key/value row list the server form uses for environment variables and
 * both header maps: a label, one `mm_kv` row per entry (two inputs + a remove
 * button), and an add button.
 *
 * The rows-to-object conversions live here too, next to the only shape they
 * describe, so the form keeps just the initial state and the submit body.
 */

import type { ClientDeps, KeyValueRow, Translator } from '../../runtime/types'

export const EMPTY_KEY_VALUE_ROW: KeyValueRow = { key: '', value: '' }

/** Object → editable rows, falling back to one blank row. */
export function toKeyValueRows(source: Record<string, unknown> | undefined): KeyValueRow[] {
  return source
    ? Object.entries(source).map(([key, value]) => ({ key, value: String(value) }))
    : [{ ...EMPTY_KEY_VALUE_ROW }]
}

/** Rows → flat map, dropping keys that were left blank. */
export function toKeyValueMap(rows: KeyValueRow[]): Record<string, string> {
  return rows.reduce<Record<string, string>>((acc, row) => {
    const key = row.key.trim()
    if (key) acc[key] = row.value
    return acc
  }, {})
}

export interface KeyValueEditorProps {
  t: Translator
  label: string
  rows: KeyValueRow[]
  onChange(rows: KeyValueRow[]): void
  keyPlaceholder: string
  valuePlaceholder: string
  addLabel: string
  busy: boolean
}

export function createKeyValueEditor(deps: ClientDeps): (props: KeyValueEditorProps) => JSX.Element {
  const { h } = deps

  return function KeyValueEditor({
    t,
    label,
    rows,
    onChange,
    keyPlaceholder,
    valuePlaceholder,
    addLabel,
    busy,
  }: KeyValueEditorProps): JSX.Element {
    return (
      <label className="wide">
        {label}
        {rows.map((entry, i) => (
          <div className="mm_kv" key={i}>
            <input
              value={entry.key}
              onChange={(e) =>
                onChange(
                  rows.map((value, index) =>
                    index === i ? { ...value, key: e.target.value } : value,
                  ),
                )
              }
              placeholder={keyPlaceholder}
            />
            <input
              value={entry.value}
              onChange={(e) =>
                onChange(
                  rows.map((value, index) =>
                    index === i ? { ...value, value: e.target.value } : value,
                  ),
                )
              }
              placeholder={valuePlaceholder}
            />
            <button
              className="mm_btn"
              onClick={() => onChange(rows.filter((_, index) => index !== i))}
              disabled={busy}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="mm_btn"
          onClick={() => onChange([...rows, { ...EMPTY_KEY_VALUE_ROW }])}
          disabled={busy}
        >
          {addLabel}
        </button>
      </label>
    )
  }
}
