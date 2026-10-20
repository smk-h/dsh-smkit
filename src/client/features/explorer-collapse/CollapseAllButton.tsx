/**
 * The fold-everything control in the shell's file-tree header.
 *
 * `ui-sidebar-files` draws that header as `PathLabel`, reload, and then its own
 * extension seat — `sidebar.right.tab.files.actions`, a `list` slot, `session`
 * scope, with the tree's directory handed over as `absolutePath`. The seat is
 * exactly "workspace directory actions after the reload control", so this is a
 * slot entry and nothing else: no DOM capture, no observer, no button of its
 * own anywhere but here.
 *
 * It is also the reason the seat's owner matters: the right column can hold
 * more than one file pane, and each reports its own root, so the press acts on
 * the tree that reports this `absolutePath` rather than on whichever tree the
 * document happens to list first.
 *
 * The press walks the tree's own directory controls (see `collapse.ts`), which
 * is the only operation the tree offers — it publishes no fold-all of its own.
 *
 * The seat is rendered inside the shell's 38px header row, so the button wears
 * the shell's own tool metrics (28px square, `--dsw-*` tokens; see
 * `style/button.css`) and the shell's hover bubble where the module table
 * supplies one.
 */

import { createCollapseAllIcon } from '../../platform/icons/CollapseAllIcon'
import { collapseShellTree, shellTree } from './collapse'
import type { ClientDeps, Translator } from '../../platform/types'

/**
 * Props the seat supplies. `absolutePath` is the slot's owner prop (the tree's
 * directory); `t` arrives because the registration declares a `locale`.
 */
export interface CollapseAllProps {
  /** Absolute directory the file tree is showing, as its owner reports it. */
  absolutePath?: string
  /** Translator bound to the `explorer-collapse` namespace. */
  t: Translator
}

/**
 * Build the component this feature registers for
 * `sidebar.right.tab.files.actions`.
 *
 * @param deps - the runtime factories (`h` builds the button, `Tooltip` names it).
 * @returns the slot component: one header control.
 */
export function createCollapseAllButton(deps: ClientDeps): (props: CollapseAllProps) => JSX.Element {
  const { h, Tooltip } = deps
  const CollapseAllIcon = createCollapseAllIcon(deps)

  return function CollapseAllButton({ absolutePath, t }: CollapseAllProps): JSX.Element {
    const label = t('collapseAll')
    const anchor = (
      <button
        type="button"
        className="smkit-collapse-button"
        aria-label={label}
        // The shell's bubble replaces the browser's; keeping `title` as well
        // would stack a native tooltip underneath the styled one.
        title={Tooltip === undefined ? label : undefined}
        onClick={() => { collapseShellTree(shellTree(absolutePath)) }}
      >
        <CollapseAllIcon />
      </button>
    )
    // `bottom` plus the shell's 500ms hover delay is what DSH's own header
    // controls use; the edge handling rides along with the component.
    return Tooltip === undefined
      ? anchor
      : (
        <Tooltip label={label} side="bottom" delayMs={500}>
          {anchor}
        </Tooltip>
      )
  }
}
