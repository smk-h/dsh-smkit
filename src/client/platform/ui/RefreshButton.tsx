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
 * as the read — `platform/ui/useBusyFace` holds the rule, and the reason for it,
 * because a control of this shape is not only ever drawn here.
 *
 * While the face is up the button is locked and greyed: the shell's own busy
 * vocabulary (the MCP toolbar's `openConfig`, the session-delete control) is a
 * dimmed control with the platform's spinner in it, not a control that still
 * looks ready. The arc is `platform/icons/LoaderIcon`, turning on the shared
 * `smkit-ui-spin` keyframes (`style/spin.css`), so a refresh in flight and a
 * connection in flight turn at the same rate and honour `prefers-reduced-motion`
 * together. And the face comes down by *changing back* — the arc giving way to
 * the arrow — rather than by stopping mid-turn, which is what lets the floor be
 * a plain deadline instead of a whole number of rotations.
 *
 * The bubble is the shell's own `.smkit-ui-tip` mark, so a page's toolbar bubbles all
 * clamp through the one document-level watch it already installs
 * (`platform/ui/tip`).
 */

import { createLoaderIcon } from '../icons/LoaderIcon'
import { createRefreshIcon } from '../icons/RefreshIcon'
import type { ClientDeps } from '../types'
import { useBusyFace } from './useBusyFace'

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
    const face = useBusyFace(react, busy === true)

    // The face opens here rather than in an effect, so the click and the face
    // land in the same commit; `busy` and the floor take it from there.
    const click = (): void => {
      face.start()
      onClick()
    }

    const turning = face.showing
    const label = platformT('refresh')
    return (
      <button
        className="smkit-ui-icon-button smkit-ui-refresh-button smkit-ui-tip"
        type="button"
        aria-label={label}
        data-smkit-tip={label}
        data-smkit-busy={turning ? 'true' : undefined}
        aria-busy={turning ? true : undefined}
        disabled={turning || disabled === true}
        onClick={click}
      >
        {turning ? (
          <SpinnerIcon className="smkit-ui-spin" size={14} />
        ) : (
          <RefreshIcon size={14} />
        )}
      </button>
    )
  }
}
