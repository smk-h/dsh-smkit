/**
 * The More-menu row that opens the process monitor.
 *
 * The shell's More launcher feeds its menu from the `sidebar.panellist.actions`
 * seat — the same seat the host's own "browse / create plugins" rows use — so
 * registering here puts one row among them, without spending a launcher-strip
 * icon of the page's own. The row prefers the shell's `MenuItemButton` (same
 * geometry, focus and hover as every other row in that menu) and falls back to
 * a plain button of this feature's own sheet on a host whose module table
 * lacks the component; the gesture is identical either way.
 */

import type { IconFactory } from '../../../platform/icons/Icon'
import type { ClientDeps, Translator } from '../../../platform/types'

export function createProcessMonitorMenuEntry(
  deps: ClientDeps,
  boundT: Translator,
  /** Switch the main panel to the process monitor; a no-op without the layout service. */
  openPanel: () => void,
  Icon: IconFactory,
): (props: { t?: Translator; onDismiss?: () => void }) => JSX.Element {
  const { h, menuItemButton } = deps

  return function ProcessMonitorMenuEntry(props: { t?: Translator; onDismiss?: () => void }): JSX.Element {
    // `t` and `onDismiss` arrive from the menu's owner at render time; the
    // closure's translator is the same function, kept as the fallback a
    // harness that renders the component directly would need.
    const t = props?.t ?? boundT
    const label = t('panelLabel')
    const select = (): void => {
      // Dismiss first, switch second: the menu closes on selection like every
      // other row, and the panel opens behind it.
      if (typeof props?.onDismiss === 'function') props.onDismiss()
      openPanel()
    }

    if (typeof menuItemButton === 'function') {
      return h(menuItemButton, { icon: h(Icon, { size: 16 }), onSelect: select }, label)
    }
    return h(
      'button',
      { type: 'button', role: 'menuitem', className: 'smkit-pm-page-menurow', onClick: select },
      h(Icon, { size: 16, className: 'smkit-pm-page-menurow-icon' }),
      h('span', { className: 'smkit-pm-page-menurow-label' }, label),
    )
  }
}
