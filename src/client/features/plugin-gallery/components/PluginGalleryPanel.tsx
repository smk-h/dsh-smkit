/**
 * The gallery tab of the merged settings section: a shelf of dsh plugins, one
 * card each — the name, where it lives, and the line that installs it.
 *
 * The tab exists because the useful half of installing a plugin is the exact
 * command it installs with — and the command is not where a reader would look
 * for it. It is in the plugin's own README, in whatever shape that README
 * fancied (`npx` prefixes, a `github:` specifier, a `-w` flag), one repository
 * away from the page that made the reader want the plugin. The card is the
 * whole answer instead: the name, a link to the repository, and the command
 * copied out of that README verbatim.
 *
 * Everything the panel renders comes from two places. The list is
 * `catalog.ts` — data, no copy: a package name, a URL and a command read the
 * same in every language. The one sentence per card that does have to follow
 * the language is a dictionary key `<id>Desc` in this feature's own namespace.
 *
 * The panel reads nothing: no host route, no storage, no poll. That is why it
 * is the one page of this section that asks dsh for nothing — the shelf is the
 * same shelf whether the host replies or not. The one thing it does own is a
 * click's answer: the copy button's report, and the second it holds before it
 * will copy again (see `COPY_FEEDBACK_MS`).
 *
 * It installs nothing, deliberately. Running a package manager on the user's
 * behalf is not a settings page's business, and a page that could is a page
 * worth talking into doing it; a link, a selectable line and a copy button
 * leave the decision, and its consequences, where they belong.
 */

import { createGithubIcon } from '../../../platform/icons/GithubIcon'
import { PLUGIN_CATALOG, type CatalogEntry } from '../catalog'
import type { ClientDeps, Translator } from '../../../platform/types'

/** Props the merged section's shell hands every panel. */
export interface PluginGalleryPanelProps {
  t: Translator
}

/**
 * How long a copy's answer holds its button before the next copy may start.
 *
 * The second is the whole of the cooldown: an answer that stayed would read as
 * a state the next click is supposed to change — and the next click cannot
 * change it — so it has to go away for the button to be a button again. One
 * second is the shortest hold that can be read as an answer rather than a
 * flicker, and it is deliberately shorter than the notify page's two: that
 * answer sits beside an address a user has to go and paste, this one beside a
 * line the page just copied for them. The hold is the same for both answers —
 * a failure held for less would be a report nobody had time to read.
 */
const COPY_FEEDBACK_MS = 1_000

/** What one click's copy produced, and which card it belonged to. */
interface CopyAnswer {
  id: string
  ok: boolean
}

/**
 * Put one command on the clipboard, from the click that asked for it.
 *
 * Only the modern Clipboard API, with no `document.execCommand('copy')`
 * fallback: a refused copy is not a dead end, because the command stays on
 * screen as a `user-select: all` line — one click selects it whole — and the
 * button reports the failure instead of pretending it worked. What refuses is
 * a page the shell gave no clipboard to, and a browser that asks first: the
 * same `false`, and the same thing left for the reader to do by hand.
 */
async function copyCommand(command: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') return false
    await navigator.clipboard.writeText(command)
    return true
  } catch {
    return false
  }
}

export function createPluginGalleryPanel(
  deps: ClientDeps,
): (props: PluginGalleryPanelProps) => JSX.Element {
  const { h, react } = deps
  // The very mark the identity badge above the strip draws: the same glyph in
  // the same place means the same thing (this name goes to GitHub), and a
  // second copy in this feature would be the same glyph ported twice.
  const GithubIcon = createGithubIcon(deps)

  return function PluginGalleryPanel({ t }: PluginGalleryPanelProps): JSX.Element {
    // The answer one click produced, for as long as it is worth reading; the
    // page's only state, because the shelf itself is data.
    const [answer, setAnswer] = react.useState<CopyAnswer | null>(null)
    // The card whose write is still in flight. Not folded into `answer`: an
    // answer that has not arrived yet is not an answer, and `null` is what
    // "nothing to report" already means.
    const [pending, setPending] = react.useState<string | null>(null)

    // The answer clears itself a second after it lands. While it is up, the
    // button it belongs to is disabled — that second is the cooldown, and it is
    // also what makes the label a report rather than a state the button is
    // stuck in.
    react.useEffect(() => {
      if (answer === null) return
      const timer = setTimeout(() => setAnswer(null), COPY_FEEDBACK_MS)
      return () => clearTimeout(timer)
    }, [answer])

    /** Hand one command over, from the click that asked for it. */
    const copy = async (entry: CatalogEntry): Promise<void> => {
      // One write at a time: a second click while the first is still in flight
      // would race two answers onto one button.
      if (pending !== null) return
      setPending(entry.id)
      const ok = await copyCommand(entry.command)
      setPending(null)
      setAnswer({ id: entry.id, ok })
    }

    return (
      <div className="smkit-gallery-page-panel">
        <p className="smkit-gallery-page-intro">{t('intro')}</p>
        <div className="smkit-gallery-page-list">
          {PLUGIN_CATALOG.map((entry) => (
            <div key={entry.id} className="smkit-gallery-page-card">
              <div className="smkit-gallery-page-head">
                {/* The name carries the link and the mark rides inside the
                    anchor: a glyph beside the target would point at the same
                    place without being part of it. */}
                <a
                  className="smkit-gallery-page-name"
                  href={entry.repo}
                  target="_blank"
                  rel="noreferrer"
                >
                  <GithubIcon className="smkit-gallery-page-mark" />
                  {entry.name}
                </a>
              </div>
              <p className="smkit-gallery-page-desc">{t(entry.id + 'Desc')}</p>
              {/* A command is read as one line and handed over as one line: the
                  mark-up says so, the stylesheet makes a click select it whole,
                  and the button beside it is for the reader who would rather
                  not select anything at all. The button is the shared neutral
                  button; only its width is this page's business. */}
              <div className="smkit-gallery-page-command-row">
                <code className="smkit-gallery-page-command">{entry.command}</code>
                <button
                  className="smkit-ui-button smkit-gallery-page-copy"
                  type="button"
                  disabled={pending !== null || answer?.id === entry.id}
                  onClick={() => void copy(entry)}
                >
                  {answer?.id === entry.id
                    ? answer.ok
                      ? t('copied')
                      : t('copyFailed')
                    : t('copy')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }
}
