/**
 * The tab strip the settings pages share: one row of buttons, the active one
 * darker with an underline — the shape DSH's own tabbed settings pages use (see
 * `style/tabs.css`) — which scrolls when the row is wider than the dialog, with
 * the pair of arrow buttons that scroll it seated at its right end. A tab may
 * wear a glyph before its label; the label is the only text the strip renders,
 * so a page names its own copy.
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
 * own rules, which every page inherits. Scrolling is not part of that bargain:
 * the parts carry markers (`data-smkit-tabs*`) that the behaviour reads
 * (`ui/tabs-scroll`) and the stylesheet paints, so a strip a page restyled
 * still scrolls, and the arrows still appear only while there is something to
 * scroll. Movement is that module's as well — it owns the frame loop that the
 * wheel and the arrows share, so a press and a wheel cannot fight over one
 * `scrollLeft` — and this component seats the buttons and names them from the
 * platform dictionary, the way the confirmation dialog's buttons are named.
 */

import { createChevronLeftIcon } from '../icons/ChevronLeftIcon'
import { createChevronRightIcon } from '../icons/ChevronRightIcon'
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
  const { h, platformT } = deps
  const ChevronLeftIcon = createChevronLeftIcon(deps)
  const ChevronRightIcon = createChevronRightIcon(deps)

  return function Tabs({
    tabs,
    active,
    onChange,
    ariaLabel,
    classes = DEFAULT_CLASSES,
  }: TabsProps): JSX.Element {
    return (
      <div className={classes.root} data-smkit-tabs="true">
        <div
          className={`${classes.root}-row`}
          data-smkit-tabs-row="true"
          role="tablist"
          aria-label={ariaLabel}
        >
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
        {/* The two overflow buttons, in row order. They exist for a reader only
            while the row overflows, and take no press once their direction is
            used up — both facts the stylesheet reads off `data-smkit-tabs-scroll`
            (`ui/tabs-scroll` measures them). What a press does is that module's
            too, so a press and a wheel are one movement rather than two
            animations over the same row. */}
        <button
          className={`smkit-ui-icon-button ${classes.root}-arrow`}
          type="button"
          data-smkit-tabs-arrow="start"
          aria-label={platformT('scrollStart')}
        >
          <ChevronLeftIcon size={14} />
        </button>
        <button
          className={`smkit-ui-icon-button ${classes.root}-arrow`}
          type="button"
          data-smkit-tabs-arrow="end"
          aria-label={platformT('scrollEnd')}
        >
          <ChevronRightIcon size={14} />
        </button>
      </div>
    )
  }
}
