/**
 * Breadcrumb for a sub-view, mounted into the settings shell's title strip —
 * the flex row that carries the header actions and the close button — through
 * a portal, e.g. `Servers › Add server`.
 *
 * Purely additive to the page: each view keeps its own heading in the content;
 * the bar is a quiet wayfinding layer above it, both levels at text size (the
 * strip is the shell's chrome, and an enlarged current level would read as the
 * shell's title). The last crumb is the current page (`h3.mm_breadcrumbCurrent`)
 * and does not navigate; every earlier crumb with an `onClick` renders as a
 * link — typically back to the list — and one without degrades to plain
 * current-page styling. Generic on purpose: `McpContent` mounts it today, and
 * any other section that grows sub-views reuses the same trail.
 */

import { createChevronRightIcon } from '../icons/ChevronRightIcon'
import type { ClientDeps } from '../../runtime/types'

/** One level of the trail. `onClick` marks a non-last crumb as navigable. */
export interface BreadcrumbCrumb {
  label: string
  onClick?(): void
}

export interface BreadcrumbProps {
  /** Ancestors first, the current page last. */
  crumbs: BreadcrumbCrumb[]
  /** Accessible name of the `<nav>` landmark, from the caller's `t`. */
  ariaLabel: string
}

export function createBreadcrumb(deps: ClientDeps): (props: BreadcrumbProps) => JSX.Element {
  const { h } = deps
  const ChevronRightIcon = createChevronRightIcon(deps)

  return function Breadcrumb({ crumbs, ariaLabel }: BreadcrumbProps): JSX.Element {
    const elements: JSX.Element[] = []
    crumbs.forEach((crumb, index) => {
      const last = index === crumbs.length - 1
      if (index > 0) {
        elements.push(
          <ChevronRightIcon className="mm_breadcrumbSep" size={12} key={`sep-${index}`} />,
        )
      }
      if (last) {
        elements.push(
          <h3 className="mm_breadcrumbCurrent" key={`crumb-${index}`}>
            {crumb.label}
          </h3>,
        )
      } else if (crumb.onClick) {
        elements.push(
          <button
            className="mm_breadcrumbLink"
            type="button"
            onClick={crumb.onClick}
            key={`crumb-${index}`}
          >
            {crumb.label}
          </button>,
        )
      } else {
        elements.push(
          <span className="mm_breadcrumbCurrent" key={`crumb-${index}`}>
            {crumb.label}
          </span>,
        )
      }
    })
    return (
      <nav className="mm_breadcrumb" aria-label={ariaLabel}>
        {elements}
      </nav>
    )
  }
}
