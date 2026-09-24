/**
 * A dropdown whose options carry icons — something a native `<select>` cannot
 * render, and whose popup the embedded browser paints as a raw system menu over
 * the page instead of inside the dialog.
 *
 * Two visual families share this one behavior set (open/close, close on an
 * outside click, check mark on the selected row):
 *
 * - the default: the scope pill both settings pages put above their lists
 *   (`smkit-ui-picker*`, styled by this layer's own `style/picker.css`);
 * - any family a caller names through `classes`: the MCP server form's
 *   field-shaped trigger (`smkit-mcp-form-field-select*`), whose rules stay in that feature's
 *   stylesheet because that look belongs to the form, not to the picker.
 *
 * Menus always render with one set of item styles, so every dropdown in the
 * plugin reads the same whichever family opened it.
 */

import { createCheckIcon } from '../icons/CheckIcon'
import { createChevronDownIcon } from '../icons/ChevronDownIcon'
import type { ClientDeps } from '../types'

export interface IconSelectOption {
  value: string
  label: string
  /** Optional leading glyph; the check mark on the selected row is separate. */
  icon?: JSX.Element
  /** A non-empty group renders a header line above the option whenever it
   * differs from the previous option's group (options render in array order). */
  group?: string
  /** Hover tooltip for the row and for the trigger while selected, rendered as
   * the shared `.smkit-ui-tip` bubble (a project shows its full path here, its name
   * in the label); rows without one show no bubble. */
  title?: string
}

/** Root, trigger and label classes of one trigger family. */
export interface IconSelectClasses {
  root: string
  trigger: string
  label: string
}

/** The default family: the scope pill, whose rules this layer ships. */
const SCOPE_CLASSES: IconSelectClasses = {
  root: 'smkit-ui-picker',
  trigger: 'smkit-ui-picker-scope-trigger',
  label: 'smkit-ui-picker-scope-label',
}

export interface IconSelectProps {
  options: IconSelectOption[]
  value: string
  onChange(value: string): void
  /** Locked pickers (the form's editing mode) render inert, like a disabled
   * native select. */
  disabled?: boolean
  /** The wrapping field div is not a `<label>`, so the accessible name is
   * carried here. */
  ariaLabel?: string
  /** The trigger's visual family; the menu is shared. */
  classes?: IconSelectClasses
}

export function createIconSelect(deps: ClientDeps): (props: IconSelectProps) => JSX.Element {
  const { h, react } = deps
  const ChevronDownIcon = createChevronDownIcon(deps)
  const CheckIcon = createCheckIcon(deps)

  return function IconSelect({
    options,
    value,
    onChange,
    disabled,
    ariaLabel,
    classes = SCOPE_CLASSES,
  }: IconSelectProps): JSX.Element {
    const [open, setOpen] = react.useState(false)
    const { root, trigger, label } = classes
    const current = options.find((option) => option.value === value) ?? null

    // Clicks outside the picker close the menu. `document` is absent outside a
    // browser (the hook test harness runs the bundle in a bare context), hence
    // the guard rather than an unconditional listener.
    react.useEffect(() => {
      if (!open || typeof document === 'undefined') return undefined
      const onMouseDown = (event: MouseEvent): void => {
        const node = event.target as HTMLElement | null
        if (node?.closest('[data-smkit-icon-select]')) return
        setOpen(false)
      }
      document.addEventListener('mousedown', onMouseDown)
      return () => document.removeEventListener('mousedown', onMouseDown)
    }, [open])

    // Group headers interleave with the option rows, so the menu is one flat
    // list of header divs and option buttons.
    const rows = options.flatMap((option, index) => {
      const row: JSX.Element[] = []
      if (option.group && option.group !== options[index - 1]?.group) {
        row.push(
          <div className="smkit-ui-picker-scope-group" key={`group:${option.group}`}>
            {option.group}
          </div>,
        )
      }
      const selected = option.value === value
      row.push(
        <button
          className={option.title ? 'smkit-ui-picker-scope-item smkit-ui-tip' : 'smkit-ui-picker-scope-item'}
          type="button"
          role="option"
          aria-selected={selected}
          data-smkit-tip={option.title}
          onClick={() => {
            setOpen(false)
            onChange(option.value)
          }}
          key={option.value}
        >
          {option.icon ?? null}
          <span className="smkit-ui-picker-scope-item-label">{option.label}</span>
          {selected ? (
            <span className="smkit-ui-picker-scope-check">
              <CheckIcon />
            </span>
          ) : null}
        </button>,
      )
      return row
    })

    return (
      <div className={root} data-smkit-icon-select="true">
        <button
          className={current?.title ? `${trigger} smkit-ui-tip` : trigger}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          data-smkit-tip={current?.title}
          onClick={() => setOpen(!open)}
        >
          {current?.icon ?? null}
          <span className={label}>{current?.label ?? ''}</span>
          <span className="smkit-ui-picker-chevron" data-smkit-open={open ? 'true' : undefined}>
            <ChevronDownIcon size={12} />
          </span>
        </button>
        {open && !disabled ? (
          <div className="smkit-ui-picker-scope-menu" role="listbox" aria-label={ariaLabel}>
            {rows}
          </div>
        ) : null}
      </div>
    )
  }
}
