/**
 * A checkbox drawn as a button: the tick box states the fact, the pill around it
 * makes the whole word a single target to aim at.
 *
 * It lives in the platform layer because "which of these apply" is not one
 * section's question — the inputs a model takes, the formats a tool returns, the
 * scopes a grant covers are all the same kind of answer, and the control that
 * asks it should be one control. A section that needs it drops it in and keeps no
 * rules of its own; the row the chips are read as is the `smkit-ui-check-chip-chip-row` class this
 * file's stylesheet owns, and what each chip means is the `onChange` the section
 * passes.
 *
 * There is no draft and no confirm step, because the tick moves the moment the
 * box is clicked and paints what the caller last read from its source. A section
 * that writes on the tick should re-read after the answer, so the box shows what
 * the store holds rather than what was asked for.
 *
 * Four flags cover the states, and they are not four shades of one thing:
 * `checked` is the value; `locked` means the box is on and will never be offered
 * off, which the lock says out loud; `disabled` means a click is not being taken
 * at the moment, as when a request is in flight; `inert` means this subject can
 * never answer the question at all, so the box dims instead of inviting a click
 * that would only be refused.
 */

import { createCheckIcon } from '../icons/CheckIcon'
import { createLockIcon } from '../icons/LockIcon'
import type { ClientDeps } from '../types'

export interface CheckChipProps {
  /** The word beside the tick. */
  label: string
  /** What the box belongs to, spoken before the label: a reader reaching the
   * fourth such box on the page still has to know which subject it toggles. */
  of?: string
  /** Whether the box is ticked. */
  checked: boolean
  /** Not clickable at the moment. */
  disabled?: boolean
  /** Ticked, never offered off, and saying so with the lock. */
  locked?: boolean
  /** This subject cannot answer the question, so the box dims. */
  inert?: boolean
  /** What a click does. Left out, the chip is a statement rather than a control. */
  onChange?: (checked: boolean) => void
}

export function createCheckChip(deps: ClientDeps): (props: CheckChipProps) => JSX.Element {
  const { h } = deps
  const CheckIcon = createCheckIcon(deps)
  const LockIcon = createLockIcon(deps)

  return function CheckChip(props: CheckChipProps): JSX.Element {
    const name = props.of === undefined ? props.label : `${props.of} · ${props.label}`
    return (
      <label
        className="smkit-ui-check-chip"
        data-smkit-on={props.checked ? 'true' : undefined}
        data-smkit-locked={props.locked ? 'true' : undefined}
        data-smkit-inert={props.inert ? 'true' : undefined}
      >
        {/* The native control stays in the tree under the pill — the role, the
          * keyboard and the checked state are the browser's — but it is the box
          * below that is looked at, so this one is only ever felt. */}
        <input
          className="smkit-ui-check-chip-chip-input"
          type="checkbox"
          checked={props.checked}
          disabled={props.disabled === true || props.locked === true || props.inert === true}
          aria-label={name}
          onChange={(e) => { props.onChange?.(e.target.checked) }}
        />
        <span className="smkit-ui-check-chip-chip-box">{props.checked ? <CheckIcon size={10} /> : null}</span>
        <span className="smkit-ui-check-chip-label">{props.label}</span>
        {props.locked ? <LockIcon size={11} className="smkit-ui-check-chip-chip-lock" /> : null}
      </label>
    )
  }
}
