/**
 * The section's switch: a `role="switch"` button plus its state label, wrapped
 * in the flex row both callers used to spell out (the on-demand feature row and
 * every global server card).
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
      <span className="smkit-mcp-switch-row">
        <button
          className="smkit-mcp-switch"
          type="button"
          role="switch"
          data-smkit-on={on ? 'true' : undefined}
          aria-checked={on}
          aria-label={ariaLabel}
          onClick={onToggle}
          disabled={busy}
        >
          <span className="smkit-mcp-switch-thumb" />
        </button>
        <span className="smkit-mcp-switch-text">{text}</span>
      </span>
    )
  }
}
