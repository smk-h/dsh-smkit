/**
 * The conversation-header control that toggles the palette panel.
 *
 * Mounted into the same right-aligned utilities seat as the session-delete and
 * OpenSpec controls (`smkit-ui-icon-button`, the shell's hover bubble for the label), so
 * the toggle sits in the corner the panel drops from. Click — not the hover
 * gesture the neighbours use — because this is a mode switch: the panel stays
 * up while colors are tuned, and a hover-out must not slam it shut.
 *
 * The panel portals onto the body: the header clips and stacks its own
 * subtree, and a palette panel inside it would be cut off and overlaid. On a
 * host where react-dom is missing (`createPortal` optional in deps) the panel
 * still renders inline — `position: fixed` in its stylesheet keeps it in the
 * viewport corner unless a transformed ancestor drags it, which degrades to a
 * misplaced panel, never a broken one.
 *
 * A press anywhere but the panel — or this toggle — dismisses it, so tuning
 * colors begins and ends without a trip up to the panel's own corner. The rule
 * lives here because this is where both halves are known: the toggle, and the
 * `data-smkit-palette-panel` marker the panel puts on its own root (the same
 * convention the icon picker's menu uses). Reaching for either by class name
 * instead would tie dismissal to the stylesheet, which is free to rename them.
 *
 * The panel's corner is hung off the header this toggle sits in rather than off
 * the window, so opening the shell's right Sidebar takes the panel left with
 * its own toggle instead of leaving it over the Sidebar (`../panelAnchor`).
 */

import type { ClientDeps, Translator } from '../../../platform/types'
import { createPaletteIcon } from '../icons/PaletteIcon'
import { watchPanelAnchor } from '../panelAnchor'
import { createPalettePanel } from './PalettePanel'

export interface PaletteButtonProps {
  t: Translator
}

export function createPaletteButton(deps: ClientDeps): (props: PaletteButtonProps) => JSX.Element {
  const { h, react, createPortal, Tooltip } = deps
  const Palette = createPaletteIcon(deps)
  const Panel = createPalettePanel(deps)

  return function PaletteButton({ t }: PaletteButtonProps): JSX.Element {
    const [open, setOpen] = react.useState(false)

    /** Dismiss on a press outside: anywhere but the panel, and anywhere but the
     * toggle. Both have to be checked, and both are asked by attribute rather
     * than by class name — the same marker convention the icon picker uses,
     * because these two strings are a behaviour contract, not styling (the
     * class names belong to the stylesheet and may be renamed for a reason
     * that has nothing to do with dismissal).
     *
     * The toggle is the easy one to forget and the loudest when forgotten:
     * `mousedown` lands before the button's `click`, so closing here first
     * would be undone by the toggle one event later — the open panel would
     * reopen the instant it was dismissed, and the button would read as dead.
     *
     * `mousedown` rather than `click` is also what keeps a slider drag alive:
     * the press that starts a drag is inside the panel, and the drag that
     * follows is never a click. Registered for the panel's whole lifetime
     * (`open` cannot change without this effect re-running), so a drag — which
     * re-renders the panel, not this button — does not churn the listener. */
    react.useEffect(() => {
      if (!open || typeof document === 'undefined') return undefined
      const onDown = (event: MouseEvent): void => {
        const node = event.target as HTMLElement | null
        if (node?.closest('[data-smkit-palette-trigger]')) return
        if (node?.closest('[data-smkit-palette-panel]')) return
        setOpen(false)
      }
      document.addEventListener('mousedown', onDown)
      return () => document.removeEventListener('mousedown', onDown)
    }, [open])

    /** Hang the panel in its column's corner, and keep it there.
     *
     * Both halves are asked for by marker, as the dismissal above does — the
     * panel's own, and the toggle's, whose column is the nearest `header`
     * ancestor. Nothing is remembered between them: the panel is this toggle's
     * child, so the two come and go together, and a header the shell swaps out
     * from under them takes the panel with it.
     *
     * A host without a header around this seat — a shell that seats the toggle
     * somewhere else, or has none at all — keeps the stylesheet's own corner,
     * so the panel is misplaced at worst and never unpinned. */
    react.useEffect(() => {
      if (!open || typeof document === 'undefined') return undefined
      const panel = document.querySelector<HTMLElement>('[data-smkit-palette-panel]')
      // The panel's column, which is the header both seats live in.
      const column = document.querySelector('[data-smkit-palette-trigger]')?.closest('header') ?? null
      if (!panel || column === null) return undefined
      return watchPanelAnchor(panel, column)
    }, [open])

    const anchor = (
      <button
        className="smkit-ui-icon-button smkit-theme-palette-trigger"
        type="button"
        /* The toggle's own marker: the outside-press rule above must leave a
         * press here to the button's `click`, or the two would cancel out. */
        data-smkit-palette-trigger="true"
        aria-label={t('paletteOpen')}
        aria-pressed={open}
        title={!open && Tooltip === undefined ? t('paletteOpen') : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Palette size={15} />
      </button>
    )

    return (
      <span className="smkit-theme-palette-host">
        {/* While the panel is open the bubble is dropped entirely: the shell's
         * tooltip sits side="bottom", exactly where the panel floats, and a
         * hover bubble overlapping the panel it names is noise. Toggling the
         * panel unmounts the wrapper, so a bubble already showing goes with
         * it. */}
        {!open && Tooltip !== undefined ? (
          <Tooltip label={t('paletteOpen')} side="bottom" delayMs={500}>
            {anchor}
          </Tooltip>
        ) : (
          anchor
        )}
        {open &&
          (createPortal && typeof document !== 'undefined' ? (
            createPortal(<Panel t={t} onClose={() => setOpen(false)} />, document.body)
          ) : (
            <Panel t={t} onClose={() => setOpen(false)} />
          ))}
      </span>
    )
  }
}
