/**
 * The scope picker above the MCP lists: one pill-shaped trigger that opens a
 * menu of the global scope plus every workspace.
 *
 * A native `<select>` cannot carry per-option icons, so the menu is built by
 * hand — a display for the global scope, a folder for a workspace — and closes
 * both on the next pick and on a click anywhere outside it.
 */

import { createCheckIcon } from '../icons/CheckIcon'
import { createChevronDownIcon } from '../icons/ChevronDownIcon'
import { createFolderIcon } from '../icons/FolderIcon'
import { createMonitorIcon } from '../icons/MonitorIcon'
import type { ClientDeps, Translator } from '../../runtime/types'

/** One workspace as the menu needs it: the path is the value, the name the label. */
export interface ScopeWorkspace {
  path: string
  name: string
}

export interface ScopeSelectProps {
  t: Translator
  /** `''` is the global scope; a workspace path selects that workspace. */
  value: string
  workspaces: ScopeWorkspace[]
  onChange(value: string): void
}

export function createScopeSelect(deps: ClientDeps): (props: ScopeSelectProps) => JSX.Element {
  const { h, react } = deps
  const MonitorIcon = createMonitorIcon(deps)
  const FolderIcon = createFolderIcon(deps)
  const ChevronDownIcon = createChevronDownIcon(deps)
  const CheckIcon = createCheckIcon(deps)

  return function ScopeSelect({ t, value, workspaces, onChange }: ScopeSelectProps): JSX.Element {
    const [open, setOpen] = react.useState(false)
    const selected = workspaces.find((workspace) => workspace.path === value) ?? null

    // Clicks outside the picker close the menu. `document` is absent outside a
    // browser (the hook test harness runs the bundle in a bare context), hence
    // the guard rather than an unconditional listener.
    react.useEffect(() => {
      if (!open || typeof document === 'undefined') return undefined
      const onMouseDown = (event: MouseEvent): void => {
        const node = event.target as HTMLElement | null
        if (node?.closest('[data-mm-scope]')) return
        setOpen(false)
      }
      document.addEventListener('mousedown', onMouseDown)
      return () => document.removeEventListener('mousedown', onMouseDown)
    }, [open])

    const pick = (next: string): void => {
      setOpen(false)
      onChange(next)
    }

    const item = (
      key: string,
      label: string,
      path: string,
      current: boolean,
      icon: JSX.Element,
    ): JSX.Element => (
      <button
        className="mm_scopeItem"
        type="button"
        role="option"
        aria-selected={current}
        title={label}
        onClick={() => pick(path)}
        key={key}
      >
        {icon}
        <span className="mm_scopeItemLabel">{label}</span>
        {current ? (
          <span className="mm_scopeCheck">
            <CheckIcon />
          </span>
        ) : null}
      </button>
    )

    return (
      <div className="mm_scope" data-mm-scope="true">
        <button
          className="mm_scopeTrigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          title={selected ? selected.path : undefined}
          onClick={() => setOpen(!open)}
        >
          {selected ? <FolderIcon /> : <MonitorIcon />}
          <span className="mm_scopeLabel">{selected ? selected.name : t('global')}</span>
          <span className="mm_chevron" data-open={open ? 'true' : undefined}>
            <ChevronDownIcon size={12} />
          </span>
        </button>
        {open ? (
          <div className="mm_scopeMenu" role="listbox" aria-label={t('scope')}>
            {item('scope-global', t('global'), '', value === '', <MonitorIcon />)}
            {workspaces.length > 0 ? (
              <div className="mm_scopeGroup" key="scope-group">
                {t('workspace')}
              </div>
            ) : null}
            {workspaces.map((workspace) =>
              item(
                workspace.path,
                workspace.name,
                workspace.path,
                value === workspace.path,
                <FolderIcon />,
              ),
            )}
          </div>
        ) : null}
      </div>
    )
  }
}
