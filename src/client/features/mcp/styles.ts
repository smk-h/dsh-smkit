/**
 * The MCP feature's stylesheets, as the text `entry.ts` injects.
 *
 * The rules live in the `.css` files under `style/`, split by UI module and
 * imported here as strings (the build turns each of them into a string module:
 * the browser half is one script and cannot fetch a stylesheet).
 *
 * `MCP_CSS` is the concatenation order and therefore the cascade order — page
 * shell first, then the pieces in the order the page stacks them. Every part is
 * namespaced by prefix (`mm_*`) and its variants raise specificity by adding a
 * class, so no rule's winner depends on this order; keep it in reading order
 * anyway. The platform layer's stylesheet is injected before this one.
 *
 * The one thing a stylesheet cannot hold is the settings-nav mask, a data URI
 * built from the icon spec at runtime: `nav-icon.css` consumes it as the
 * `--mm-nav-glyph` custom property and this module defines that property.
 */

import breadcrumbCss from './style/breadcrumb.css'
import cardCss from './style/card.css'
import formCss from './style/form.css'
import navIconCss from './style/nav-icon.css'
import pillCss from './style/pill.css'
import scopeCss from './style/scope.css'
import searchCss from './style/search.css'
import sectionCss from './style/section.css'
import switchCss from './style/switch.css'
import toolsCss from './style/tools.css'
import workspaceCss from './style/workspace.css'
import { CABLE_SPEC } from './icons/CableIcon'
import { iconMaskDataUri } from '../../platform/icons/Icon'

/** The feature's own rules, in cascade order. */
export const MCP_CSS = [
  sectionCss,
  breadcrumbCss,
  cardCss,
  pillCss,
  formCss,
  searchCss,
  switchCss,
  scopeCss,
  toolsCss,
  workspaceCss,
].join('\n')

/** The settings-nav glyph as a CSS mask image: alpha only, so the row's own
 * `currentColor` (default, hover, active) sets the colour while the mask keeps
 * the shell's 16px nav rhythm.
 *
 * The shape is lucide's `cable`, taken from the same glyph the icon set
 * re-exports (`icons/CableIcon`), so the drawn SVG and the mask cannot drift:
 * this plugin manages connections to MCP servers, which the plug-and-cord reads
 * better than the gear the shell would otherwise fall back to (see `nav-icon`). */
const NAV_GLYPH = iconMaskDataUri(CABLE_SPEC)

/** The glyph as a custom property — how a stylesheet receives a value only code
 * can produce: `nav-icon.css` consumes `--mm-nav-glyph` and stays static. */
const NAV_GLYPH_RULE = `[data-mm-settings-nav]{--mm-nav-glyph:url("${NAV_GLYPH}")}`

/** Settings-nav rules. `nav-icon` marks this section's row with
 * `data-mm-settings-nav`, because the shell picks row glyphs from a built-in id
 * list while a section registration carries no icon field: the fallback glyph is
 * hidden and this one is painted in its place. The mask is the data URI built
 * above, handed to those rules through the custom property they reference. */
export const MCP_NAV_ICON_CSS = [NAV_GLYPH_RULE, navIconCss].join('\n')
