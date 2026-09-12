/**
 * A dropdown whose options carry icons — something a native `<select>` cannot
 * render. Two visual families share this one behavior set (open/close, close
 * on an outside click, check mark on the selected row):
 *
 * - `field` (default): a trigger shaped like a `.mm_form select`, for the
 *   server form's scope and workspace pickers.
 * - `scope`: the toolbar's pill trigger, for the list view's scope picker
 *   (`ui/ScopeSelect`, which maps its options onto this component).
 *
 * Menus always render with the scope picker's item styles, so every dropdown
 * in the section reads the same.
 */

import { createCheckIcon } from '../icons/CheckIcon'
import { createChevronDownIcon } from '../icons/ChevronDownIcon'
import type { ClientDeps } from '../../runtime/types'

export interface IconSelectOption {
  value: string
  label: string
  /** Optional leading glyph; the check mark on the selected row is separate. */
  icon?: JSX.Element
  /** A non-empty group renders a header line above the option whenever it
   * differs from the previous option's group (options render in array order). */
  group?: string
  /** Hover tooltip for the row and for the trigger while selected; the label
   * stands in when unset (a workspace shows its full path here, its name in
   * the label). */
  title?: string
}

/** The trigger's visual family; menus are shared. */
type IconSelectVariant = 'field' | 'scope'

/** Root, trigger and label classes per family — the CSS stays where each look
 * is owned (form.css / scope.css). */
const VARIANT_CLASSES: Record<IconSelectVariant, { root: string; trigger: string; label: string }> = {
  field: { root: 'mm_fieldSelect', trigger: 'mm_fieldSelectTrigger', label: 'mm_fieldSelectLabel' },
  scope: { root: 'mm_scope', trigger: 'mm_scopeTrigger', label: 'mm_scopeLabel' },
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
  variant?: IconSelectVariant
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
    variant = 'field',
  }: IconSelectProps): JSX.Element {
    const [open, setOpen] = react.useState(false)
    const { root, trigger, label } = VARIANT_CLASSES[variant]
    const current = options.find((option) => option.value === value) ?? null

    // Clicks outside the picker close the menu. `document` is absent outside a
    // browser (the hook test harness runs the bundle in a bare context), hence
    // the guard rather than an unconditional listener.
    react.useEffect(() => {
      if (!open || typeof document === 'undefined') return undefined
      const onMouseDown = (event: MouseEvent): void => {
        const node = event.target as HTMLElement | null
        if (node?.closest('[data-mm-icon-select]')) return
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
          <div className="mm_scopeGroup" key={`group:${option.group}`}>
            {option.group}
          </div>,
        )
      }
      const selected = option.value === value
      row.push(
        <button
          className="mm_scopeItem"
          type="button"
          role="option"
          aria-selected={selected}
          title={option.title ?? option.label}
          onClick={() => {
            setOpen(false)
            onChange(option.value)
          }}
          key={option.value}
        >
          {option.icon ?? null}
          <span className="mm_scopeItemLabel">{option.label}</span>
          {selected ? (
            <span className="mm_scopeCheck">
              <CheckIcon />
            </span>
          ) : null}
        </button>,
      )
      return row
    })

    return (
      <div className={root} data-mm-icon-select="true">
        <button
          className={trigger}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          title={current ? current.title ?? current.label : undefined}
          onClick={() => setOpen(!open)}
        >
          {current?.icon ?? null}
          <span className={label}>{current?.label ?? ''}</span>
          <span className="mm_chevron" data-open={open ? 'true' : undefined}>
            <ChevronDownIcon size={12} />
          </span>
        </button>
        {open && !disabled ? (
          <div className="mm_scopeMenu" role="listbox" aria-label={ariaLabel}>
            {rows}
          </div>
        ) : null}
      </div>
    )
  }
}
