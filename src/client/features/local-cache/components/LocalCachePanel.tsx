/**
 * The local-cache tab of the merged settings section: one button that throws
 * away what dsh recorded in this browser, then reloads.
 *
 * The reason the button exists: every dsh client store persists under a
 * versioned `dsh.*` localStorage key, and a store written by one dsh version
 * can carry a shape the next cannot read — a missing field crashed the
 * sidebar's whole workspace/session region once. The data is browser-local, so
 * no host-side route can clear it: the fix has to run in the page, which is
 * exactly where this panel lives.
 *
 * Scope is the `dsh.` prefix alone. This plugin's own keys (`smkit:`) survive
 * — the tab promises to remove what *dsh* recorded and should keep its word;
 * a skin the user enabled is not cache.
 *
 * The browser objects are touched only inside the click handler: the module
 * loads in Node test harnesses without a DOM, and nothing here reads storage
 * at render time anyway.
 */

import type { ClientDeps, Translator } from '../../../platform/types'

/** Props the merged section's shell hands every panel. */
export interface LocalCachePanelProps {
  t: Translator
}

/** The prefix every dsh client store persists under. */
const DSH_KEY_PREFIX = 'dsh.'

/** How long the "cleared" answer stays on screen before the reload. The
 * answer must paint once — a reload issued in the same task as the click
 * replaces the page before the row is ever visible. */
const RELOAD_DELAY_MS = 400

/** What the last click produced. `null`: never clicked in this mount. */
type Outcome =
  | { kind: 'cleared'; count: number }
  | { kind: 'empty' }
  | { kind: 'denied' }

export function createLocalCachePanel(
  deps: ClientDeps,
): (props: LocalCachePanelProps) => JSX.Element {
  const { h, react } = deps

  return function LocalCachePanel({ t }: LocalCachePanelProps): JSX.Element {
    const [outcome, setOutcome] = react.useState<Outcome | null>(null)

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
      <div className="lc_panel">
        <p className="lc_intro">{t('intro')}</p>
        <p className="lc_intro lc_scope">{t('scope')}</p>
        <div className="lc_row">
          <button type="button" className="mm_btn" onClick={clear}>
            {t('action')}
          </button>
          {answer !== null && <span className="lc_result">{answer}</span>}
        </div>
      </div>
    )
  }
}
