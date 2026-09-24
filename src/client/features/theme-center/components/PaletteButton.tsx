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
 */

import type { ClientDeps, Translator } from '../../../platform/types'
import { createPaletteIcon } from '../icons/PaletteIcon'
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

    const anchor = (
      <button
        className="smkit-ui-icon-button smkit-theme-palette-trigger"
        type="button"
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
