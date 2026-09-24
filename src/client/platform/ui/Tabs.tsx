/**
 * The tab strip the settings pages share: one row of buttons, the active one
 * darker with an underline — the shape DSH's own tabbed settings pages use (see
 * `style/tabs.css`). A tab may wear a glyph before its label; the label is the
 * only text the strip renders, so a page names its own copy.
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
 * inside its own stylesheet; the default family (`smkit-ui-tabs*`) is this layer's
 * own rules, which every page inherits.
 */

import type { ClientDeps } from '../types'

/** One selectable tab: a stable id, the label a user reads, and an optional glyph. */
export interface TabOption {
  /** Stable id: the button's key and the selection value. */
  id: string
  /** The label as text — the caller resolves copy through `t` before handing
   * it over, since this component is deliberately locale-free. */
  label: string
  /** A glyph drawn before the label, as an element the caller built (an icon
   * from `platform/icons`): this strip stays content-agnostic and locale-free,
   * so it neither knows which icons a page offers nor binds their copy. */
  icon?: unknown
}

/** Root and button classes of one visual family. */
export interface TabsClasses {
  root: string
  tab: string
}

/** The default family, whose rules this layer ships. */
const DEFAULT_CLASSES: TabsClasses = { root: 'smkit-ui-tabs', tab: 'smkit-ui-tabs-tab' }

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
        {tabs.map((tab) =>
          // The button is built rather than written out in JSX so a tab without a
          // glyph draws exactly its label: JSX would leave the skipped icon as an
          // empty slot ahead of it, and a reader of the tree — a test, or the
          // accessibility pass over the strip — would have to skip a hole.
          h(
            'button',
            {
              className: classes.tab,
              type: 'button',
              role: 'tab',
              key: tab.id,
              'aria-selected': tab.id === active,
              'data-smkit-active': tab.id === active ? 'true' : undefined,
              onClick: () => onChange(tab.id),
            },
            ...(tab.icon === undefined ? [tab.label] : [tab.icon, tab.label]),
          ),
        )}
      </div>
    )
  }
}
