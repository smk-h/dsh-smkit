/**
 * The Settings → MCP stylesheet mount point.
 *
 * The rules live in the `.css` files next to this one, split by UI module and
 * imported here as strings: the build compiles each of them to a string module
 * (see the `cssTextPlugin` in `tsdown.config.ts`), because the client half ships
 * as one script that the browser cannot fetch a stylesheet for.
 *
 * `STYLESHEETS` below is the concatenation order and therefore the cascade
 * order — page shell first, then the pieces in the order the page stacks them.
 * Every part is namespaced by prefix (`mm_*`) and its variants raise specificity
 * by adding a class, so no rule's winner depends on this order; keep it in
 * reading order anyway.
 *
 * The one thing a stylesheet cannot hold is the settings-nav mask, a data URI
 * built from the icon spec at runtime: `nav-icon.css` consumes it as the
 * `--mm-nav-glyph` custom property and this module defines that property.
 *
 * Each stylesheet is injected once, as a `<style>` tag keyed by
 * `data-plugin-css`, so a hot reload cannot stack copies.
 *
 * The rules are the reference implementation's, down to declarations; splitting
 * them per module and the `.mm_scope*` group (the icon-bearing scope picker that
 * replaced the native `.mm_wsSelect`) are the deliberate departures.
 */

import breadcrumbCss from './breadcrumb.css'
import buttonCss from './button.css'
import cardCss from './card.css'
import dialogCss from './dialog.css'
import formCss from './form.css'
import navIconCss from './nav-icon.css'
import pillCss from './pill.css'
import scopeCss from './scope.css'
import searchCss from './search.css'
import sectionCss from './section.css'
import switchCss from './switch.css'
import workspaceCss from './workspace.css'
import { CABLE_SPEC } from '../components/icons/CableIcon'
import { iconMaskDataUri } from '../components/icons/Icon'

/** The parts of the section stylesheet, in cascade order. */
const STYLESHEETS = [
  sectionCss,
  breadcrumbCss,
  cardCss,
  pillCss,
  buttonCss,
  formCss,
  searchCss,
  switchCss,
  scopeCss,
  workspaceCss,
  dialogCss,
]

/** The section's own rules, as the text `installStyles` injects. */
export const MCP_SECTION_CSS = STYLESHEETS.join('\n')

/** The settings-nav glyph as a CSS mask image: alpha only, so the row's own
 * `currentColor` (default, hover, active) sets the colour while the mask keeps
 * the shell's 16px nav rhythm.
 *
 * The shape is lucide's `cable`, taken from the same glyph the icon set
 * re-exports (`components/icons/CableIcon`), so the drawn SVG and the mask
 * cannot drift: this plugin manages connections to MCP servers, which the
 * plug-and-cord reads better than the gear the shell would otherwise fall back
 * to (see `runtime/nav-icon`). */
const NAV_GLYPH = iconMaskDataUri(CABLE_SPEC)

/** The glyph as a custom property — how a stylesheet receives a value only code
 * can produce: `nav-icon.css` consumes `--mm-nav-glyph` and stays static. */
const NAV_GLYPH_RULE = `[data-mm-settings-nav]{--mm-nav-glyph:url("${NAV_GLYPH}")}`

/** Settings-nav rules, as the text `installStyles` injects. `runtime/nav-icon`
 * marks this section's row with `data-mm-settings-nav`, because the shell picks
 * row glyphs from a built-in id list while a section registration carries no
 * icon field: the fallback glyph is hidden and this one is painted in its place.
 * The mask itself is the data URI built above, handed to those rules through the
 * custom property they reference. */
export const MCP_NAV_ICON_CSS = [NAV_GLYPH_RULE, navIconCss].join('\n')

/** Idempotently add one stylesheet to the document head, keyed by `name`. */
function installStylesheet(name: string, css: string): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${name}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-mcp-manager'
  tag.dataset.pluginCss = name
  tag.textContent = css
  document.head.appendChild(tag)
}

/** Add the section stylesheet and the settings-nav rules, once each. */
export function installStyles(): void {
  installStylesheet('dsh-mcp-manager/section', MCP_SECTION_CSS)
  installStylesheet('dsh-mcp-manager/nav-icon', MCP_NAV_ICON_CSS)
}
