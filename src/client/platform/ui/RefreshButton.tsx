/**
 * The refresh icon button the settings pages share: one 28px round control that
 * re-reads whatever the page is showing.
 *
 * It lives in the platform layer because more than one section reads something
 * re-readable — the Skills page's list today — and a second copy of the same
 * button (glyph, bubble, pending state, paint) is exactly what this layer exists
 * to prevent. A page drops it into its toolbar and hands over behaviour only:
 * what to re-read is the page's business, not this control's.
 *
 * The label comes from the platform dictionary (`deps.platformT('refresh')`),
 * the way `ConfirmDialog`'s two buttons do: the name of a control is not a
 * section's copy, so it is declared once instead of once per feature
 * dictionary.
 *
 * `busy` is the caller's state, not this component's: the page is what knows its
 * request is in flight (one request, or several). What this component owns is
 * **how long the busy face lasts**, and that is deliberately not the same thing
 * as the read. A scan can answer in a couple of milliseconds, and a busy face
 * that comes and goes inside one frame is not an acknowledgement — it is a
 * flicker. So a click opens its own showing of the face and the read closes it:
 *
 * - the face opens in the click handler itself, so it is painted by the same
 *   commit as the click — an effect runs one frame later, and a click
 *   acknowledged a frame late is the flicker this component exists to avoid,
 * - `busy` keeps it up for as long as the read lasts, and the floor keeps it up
 *   for at least `BUSY_FLOOR_MS`, so every click looks like it landed,
 * - and it closes by *changing back* — the spinner arc gives way to the arrow —
 *   rather than by stopping mid-turn, which is what lets the floor be a plain
 *   deadline instead of a whole number of rotations.
 *
 * While the face is up the button is locked and greyed: the shell's own busy
 * vocabulary (the MCP toolbar's `openConfig`, the session-delete control) is a
 * dimmed control with the platform's spinner in it, not a control that still
 * looks ready. The arc is `platform/icons/LoaderIcon`, turning on the shared
 * `mm_statusSpin` keyframes (`style/spin.css`), so a refresh in flight and a
 * connection in flight turn at the same rate and honour `prefers-reduced-motion`
 * together.
 *
 * The bubble is the shell's own `.mm_tip` mark, so a page's toolbar bubbles all
 * clamp through the one document-level watch it already installs
 * (`platform/ui/tip`).
 */

import { createLoaderIcon } from '../icons/LoaderIcon'
import { createRefreshIcon } from '../icons/RefreshIcon'
import type { ClientDeps } from '../types'

/** How long one click shows its busy face for, at minimum, in ms. */
const BUSY_FLOOR_MS = 1000

export interface RefreshButtonProps {
  /** Re-read the page's data; the button owns only the click. */
  onClick(): void
  /** The caller's read is in flight; it keeps the busy face up for as long. */
  busy?: boolean
  /** Lock the button for a reason other than a read under way. */
  disabled?: boolean
}

export function createRefreshButton(deps: ClientDeps): (props: RefreshButtonProps) => JSX.Element {
  const { h, react, platformT } = deps
  const RefreshIcon = createRefreshIcon(deps)
  const SpinnerIcon = createLoaderIcon(deps)

  return function RefreshButton({ onClick, busy, disabled }: RefreshButtonProps): JSX.Element {
    // When the click that opened the face happened, in ms — `0` when none has. A
    // timestamp rather than a flag because the floor is measured from the click,
    // not from the answer, and the answer is the thing that arrives too early.
    const [since, setSince] = react.useState(0)

    // The face opens here rather than in an effect: effects run after the paint,
    // and a click that is acknowledged on the next frame is the flicker this
    // component exists to avoid. `busy` and the floor below take it from here.
    const click = (): void => {
      setSince(Date.now())
      onClick()
    }

    // Falling edge: the read is over, so the face comes down — but never before
    // the floor, which is the only reason this effect exists. A caller that
    // reports `busy` without a click (a page mounted mid-read) opens the face
    // through `busy` alone and skips the floor, which is what `since === 0`
    // says.
    react.useEffect(() => {
      if (busy === true || since === 0) return
      const remaining = Math.max(0, BUSY_FLOOR_MS - (Date.now() - since))
      const timer = setTimeout(() => setSince(0), remaining)
      return () => clearTimeout(timer)
    }, [busy, since])

    const turning = busy === true || since !== 0
    const label = platformT('refresh')
    return (
      <button
        className="mm_iconBtn mm_refreshBtn mm_tip"
        type="button"
        aria-label={label}
        data-tip={label}
        data-busy={turning ? 'true' : undefined}
        aria-busy={turning ? true : undefined}
        disabled={turning || disabled === true}
        onClick={click}
      >
        {turning ? (
          <SpinnerIcon className="mm_statusSpin" size={14} />
        ) : (
          <RefreshIcon size={14} />
        )}
      </button>
    )
  }
}
