/**
 * The local-cache tab of the merged settings section: every kind of key this
 * browser holds for the site, grouped into expandable cards, and one button
 * that throws the dsh half away, then reloads.
 *
 * The reason the button exists: every dsh client store persists under a
 * versioned `dsh.*` localStorage key, and a store written by one dsh version
 * can carry a shape the next cannot read — a missing field crashed the
 * sidebar's whole workspace/session region once. The data is browser-local, so
 * no host-side route can clear it: the fix has to run in the page, which is
 * exactly where this panel lives.
 *
 * The cards exist so the button is not a leap of faith. Storage is shown in
 * full — every entry, not just the cleanable ones — sorted into categories by
 * key shape: the dsh stores that clearing removes (session state, the current
 * session, the sidebar view preferences, anything else under `dsh.`), the
 * plugin's own settings under `smkit:` (theme, palette colors, language), and
 * whatever else the site holds. Each card is named, counted, and tagged with
 * its cleanup scope (`tagClean` / `tagKeep`), so the scope is a thing the
 * reader sees rather than takes on faith; expanding a card opens the table of
 * its keys and values, with a plain-words line per key. Patterns, not literal
 * names, drive both the grouping and the descriptions — session ids and
 * version suffixes move.
 *
 * Scope is the `dsh.` prefix alone, the same filter the table's clean cards
 * show: this plugin's keys (`smkit:`) survive — a palette the user saved is
 * not cache — and so does everything else on the origin.
 *
 * The cards read storage once per mount. The section renders only the active
 * tab's panel, so every visit to this tab takes a fresh snapshot; a reader
 * who sits on the tab while dsh writes sees a stale row count until they
 * leave and come back, which is the right trade for not re-reading storage
 * behind a button that reloads the page anyway. Storage is never touched at
 * render time and every access is guarded, so the module still loads in Node
 * test harnesses without a DOM, and a private-mode browser that throws on any
 * access gets a note in the cards' place instead of a broken panel.
 */

import { createChevronDownIcon } from '../../../platform/icons/ChevronDownIcon'
import type { ClientDeps, Translator } from '../../../platform/types'

/** Props the merged section's shell hands every panel. */
export interface LocalCachePanelProps {
  t: Translator
}

/** The prefix every dsh client store persists under — the whole of what the
 * button removes. */
const DSH_KEY_PREFIX = 'dsh.'

/** How long the "cleared" answer stays on screen before the reload. The
 * answer must paint once — a reload issued in the same task as the click
 * replaces the page before the row is ever visible. */
const RELOAD_DELAY_MS = 400

/** How much of a value the left column previews. Full values ride the
 * cell's `title`, so the reader can always hover for the rest. */
const VALUE_PREVIEW_MAX = 200

/** One row of a card's table: a localStorage key and the value it holds. */
interface CacheEntry {
  key: string
  value: string
}

/** One expandable card: a bucket of entries under one key pattern, and
 * whether the button removes them. */
interface CacheCategory {
  id: string
  scope: 'clean' | 'keep'
  match: (key: string) => boolean
}

/** The categories, in card order, first match wins. The dsh ones mirror the
 * names the stores actually use; the last two catch the plugin's own keys and
 * everything else the origin holds, so the page never hides a key it did not
 * predict. */
const CATEGORIES: readonly CacheCategory[] = [
  { id: 'catSessionState', scope: 'clean', match: (k) => k.startsWith('dsh.conversation.session-') },
  { id: 'catCurrentSession', scope: 'clean', match: (k) => k === 'dsh.sessions.current' },
  { id: 'catWorkspaceView', scope: 'clean', match: (k) => k.startsWith('dsh.workspace.view.') },
  { id: 'catDshOther', scope: 'clean', match: (k) => k.startsWith(DSH_KEY_PREFIX) },
  { id: 'catSmkit', scope: 'keep', match: (k) => k.startsWith('smkit:') },
  { id: 'catOther', scope: 'keep', match: () => true },
]

/** One bucket the cards paint: a category plus the entries that landed in it. */
interface CacheBucket extends Pick<CacheCategory, 'id' | 'scope'> {
  entries: CacheEntry[]
}

/** What the last click produced. `null`: never clicked in this mount. */
type Outcome =
  | { kind: 'cleared'; count: number }
  | { kind: 'empty' }
  | { kind: 'denied' }

/** The snapshot the cards paint — every key on the origin, not just the
 * cleanable ones. `null` when storage is out of reach: no DOM (Node harness)
 * or a browser that refuses every access. */
function readEntries(): CacheEntry[] | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const entries: CacheEntry[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key !== null) entries.push({ key, value: localStorage.getItem(key) ?? '' })
    }
    return entries.sort((a, b) => a.key.localeCompare(b.key))
  } catch {
    return null
  }
}

/** Sort the entries into the categories, dropping empty buckets: a card for
 * data that does not exist would only dilute the ones that matter. The last
 * category matches every key, so no entry is ever left without a bucket. */
function categorize(entries: CacheEntry[]): CacheBucket[] {
  const byId = new Map<string, CacheEntry[]>()
  for (const entry of entries) {
    const category =
      CATEGORIES.find((c) => c.match(entry.key)) ?? CATEGORIES[CATEGORIES.length - 1]
    let list = byId.get(category.id)
    if (list === undefined) {
      list = []
      byId.set(category.id, list)
    }
    list.push(entry)
  }
  return CATEGORIES.filter((c) => byId.has(c.id)).map((c) => ({
    id: c.id,
    scope: c.scope,
    entries: byId.get(c.id)!,
  }))
}

/** Which dictionary line describes one key. dsh and the plugin both name
 * their stores by pattern — session ids, version suffixes — so the match is
 * by shape, not by literal name, and stays correct as sessions come and go. */
function describeKey(
  key: string,
): 'descCurrentSession' | 'descSessionState' | 'descWorkspaceView' | 'descOther' | 'descSmkitTheme' | 'descSmkitMode' | 'descSmkitColors' | 'descSmkitOther' | 'descSiteOther' {
  if (key === 'dsh.sessions.current') return 'descCurrentSession'
  if (key.startsWith('dsh.conversation.session-')) return 'descSessionState'
  if (key.startsWith('dsh.workspace.view.')) return 'descWorkspaceView'
  if (key.startsWith(DSH_KEY_PREFIX)) return 'descOther'
  if (key === 'smkit:theme') return 'descSmkitTheme'
  if (key === 'smkit:theme-mode') return 'descSmkitMode'
  if (key === 'smkit:theme-colors') return 'descSmkitColors'
  if (key.startsWith('smkit:')) return 'descSmkitOther'
  return 'descSiteOther'
}

/** The left column's value: an honest slice, ellipsis when cut. */
function previewValue(value: string): string {
  return value.length > VALUE_PREVIEW_MAX ? value.slice(0, VALUE_PREVIEW_MAX) + '…' : value
}

export function createLocalCachePanel(
  deps: ClientDeps,
): (props: LocalCachePanelProps) => JSX.Element {
  const { h, react } = deps
  // The same caret the shell's own expandable rows draw, so these cards read
  // as the native disclosure pattern and not a plugin dialect of it.
  const ChevronDown = createChevronDownIcon(deps)

  return function LocalCachePanel({ t }: LocalCachePanelProps): JSX.Element {
    const [outcome, setOutcome] = react.useState<Outcome | null>(null)
    const [buckets, setBuckets] = react.useState<CacheBucket[] | null>(null)

    // One snapshot per mount; the section renders only the active tab's
    // panel, so every visit re-reads what this browser holds right now.
    react.useEffect(() => {
      const entries = readEntries()
      setBuckets(entries !== null ? categorize(entries) : null)
    }, [])

    const clear = () => {
      const keys: string[] = []
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key !== null && key.startsWith(DSH_KEY_PREFIX)) keys.push(key)
        }
        for (const key of keys) localStorage.removeItem(key)
      } catch {
        // Private-mode browsers throw on any storage access.
        setOutcome({ kind: 'denied' })
        return
      }
      if (keys.length === 0) {
        setOutcome({ kind: 'empty' })
        return
      }
      setOutcome({ kind: 'cleared', count: keys.length })
      setTimeout(() => window.location.reload(), RELOAD_DELAY_MS)
    }

    const answer =
      outcome === null
        ? null
        : outcome.kind === 'cleared'
          ? t('resultCleared', { count: outcome.count })
          : outcome.kind === 'empty'
            ? t('resultEmpty')
            : t('resultDenied')

    return (
      <div className="smkit-cache-page-panel">
        <p className="smkit-cache-page-intro">{t('intro')}</p>
        <p className="smkit-cache-page-intro smkit-cache-page-scope">{t('scope')}</p>
        {buckets === null ? (
          <p className="smkit-cache-page-note">{t('tableDenied')}</p>
        ) : buckets.length === 0 ? (
          <p className="smkit-cache-page-note">{t('tableEmpty')}</p>
        ) : (
          buckets.map((bucket) => (
            <details
              key={bucket.id}
              className="smkit-cache-page-card"
              open={bucket.scope === 'clean'}
            >
              <summary className="smkit-cache-page-card-summary">
                <span className="smkit-cache-page-card-heading">
                  <span className="smkit-cache-page-card-title">{t(bucket.id)}</span>
                  <span className="smkit-cache-page-card-desc">{t(bucket.id + 'Desc')}</span>
                </span>
                <span className="smkit-cache-page-card-meta">
                  <span className="smkit-cache-page-card-count">
                    {t('itemCount', { count: bucket.entries.length })}
                  </span>
                  <span
                    className={
                      'smkit-cache-page-card-tag smkit-cache-page-card-tag-' + bucket.scope
                    }
                  >
                    {t(bucket.scope === 'clean' ? 'tagClean' : 'tagKeep')}
                  </span>
                  <span className="smkit-cache-page-card-chevron">
                    <ChevronDown size={14} />
                  </span>
                </span>
              </summary>
              <div className="smkit-cache-page-table">
                <div className="smkit-cache-page-table-head">
                  <span>{t('colKey')}</span>
                  <span>{t('colDesc')}</span>
                </div>
                {bucket.entries.map((entry) => (
                  <div key={entry.key} className="smkit-cache-page-table-row">
                    <div className="smkit-cache-page-cell">
                      <div className="smkit-cache-page-key">{entry.key}</div>
                      <div className="smkit-cache-page-value" title={entry.value}>
                        {previewValue(entry.value)}
                      </div>
                    </div>
                    <div className="smkit-cache-page-desc">{t(describeKey(entry.key))}</div>
                  </div>
                ))}
              </div>
            </details>
          ))
        )}
        <div className="smkit-cache-page-row">
          <button type="button" className="smkit-ui-button" onClick={clear}>
            {t('action')}
          </button>
          {answer !== null && <span className="smkit-cache-page-result">{answer}</span>}
        </div>
      </div>
    )
  }
}
