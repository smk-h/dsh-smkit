/**
 * The tab strip the settings pages share: one row of plain-text buttons, the
 * active one darker with an underline — the shape DSH's own tabbed settings
 * pages use (see `style/tabs.css`).
 *
 * Controlled on purpose: the caller owns which tab is active, because a page
 * may derive the selection rather than keep it as plain state — the skills
 * page's project tabs follow the directories the host's answer reports, and
 * fall back to the first when the active one is no longer among them. What
 * this component owns is only the semantics every strip shares — the
 * `tablist`/`tab` roles, `aria-selected`, the active marker — so two pages
 * cannot drift in behavior or look, the way `IconSelect` holds the dropdown's.
 *
 * Like `IconSelect`, a caller may name a `classes` family to restyle the strip
 * inside its own stylesheet; the default family (`mm_tabs*`) is this layer's
 * own rules, which every page inherits.
 */

import type { ClientDeps } from '../types'

/** One selectable tab: a stable id and the label a user reads. */
export interface TabOption {
  /** Stable id: the button's key and the selection value. */
  id: string
  /** The label as text — the caller resolves copy through `t` before handing
   * it over, since this component is deliberately locale-free. */
  label: string
}

/** Root and button classes of one visual family. */
export interface TabsClasses {
  root: string
  tab: string
}

/** The default family, whose rules this layer ships. */
const DEFAULT_CLASSES: TabsClasses = { root: 'mm_tabs', tab: 'mm_tab' }

export interface TabsProps {
  tabs: TabOption[]
  /** The active tab's id. */
  active: string
  onChange(id: string): void
  /** The strip's accessible name, when the page gives it one. */
  ariaLabel?: string
  classes?: TabsClasses
}

export function createTabs(deps: ClientDeps): (props: TabsProps) => JSX.Element {
  const { h } = deps

  return function Tabs({
    tabs,
    active,
    onChange,
    ariaLabel,
    classes = DEFAULT_CLASSES,
  }: TabsProps): JSX.Element {
    return (
      <div className={classes.root} role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => (
          <button
            className={classes.tab}
            type="button"
            role="tab"
            key={tab.id}
            aria-selected={tab.id === active}
            data-active={tab.id === active ? 'true' : undefined}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    )
  }
}
