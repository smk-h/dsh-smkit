/**
 * The notify panel's switch: track, thumb, label — the same control shape the
 * MCP page's switch draws, re-declared under this feature's own namespace.
 *
 * The architecture guard keeps features from importing siblings, and a shared
 * switch would mean moving the control (and its stylesheet) into the platform
 * layer and retouching every MCP row that uses it — a refactor this panel did
 * not need. So the component is ported, the classes are renamed, and the two
 * copies stay free to drift.
 */

import type { ClientDeps } from '../../../platform/types'

export interface SwitchProps {
  on: boolean
  text: string
  busy: boolean
  onToggle(): void
  ariaLabel?: string
}

export function createSwitch(deps: ClientDeps): (props: SwitchProps) => JSX.Element {
  const { h } = deps

  return function Switch({ on, text, busy, onToggle, ariaLabel }: SwitchProps): JSX.Element {
    return (
      <span className="smkit-notify-page-switch-row">
        <button
          className="smkit-notify-page-switch"
          type="button"
          role="switch"
          data-smkit-on={on ? 'true' : undefined}
          aria-checked={on}
          aria-label={ariaLabel}
          onClick={onToggle}
          disabled={busy}
        >
          <span className="smkit-notify-page-switch-thumb" />
        </button>
        <span className="smkit-notify-page-switch-text">{text}</span>
      </span>
    )
  }
}
