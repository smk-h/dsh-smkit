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
 * The one thing a stylesheet cannot hold is this section's settings-nav mask, a
 * data URI built from the icon spec at runtime: the platform layer's
 * `style/settings-nav.css` consumes it as the `--dsh-smkit-nav-glyph` custom
 * property and the rule below defines that property for this section's row.
 */

import { SETTINGS_NAV_ATTRIBUTE } from '../../platform/ui/settings-nav'
import breadcrumbCss from './style/breadcrumb.css'
import cardCss from './style/card.css'
import formCss from './style/form.css'
import pillCss from './style/pill.css'
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
 * better than the gear the shell would otherwise fall back to. */
const NAV_GLYPH = iconMaskDataUri(CABLE_SPEC)

/** The glyph as a custom property — how a stylesheet receives a value only code
 * can produce. The platform layer's `style/settings-nav.css` consumes it on
 * every marked row; this rule supplies it on this section's row alone, keyed by
 * the marker's value (`platform/ui/settings-nav`). */
const NAV_GLYPH_RULE = `[${SETTINGS_NAV_ATTRIBUTE}='mcp']{--dsh-smkit-nav-glyph:url("${NAV_GLYPH}")}`

/** This section's settings-nav rules: the marker's value and the mask it stands
 * for. The painting is shared — the shell picks row glyphs from a built-in id
 * list while a registration carries no icon field, so every section that draws
 * its own glyph marks its row and hands the paint one data URI. */
export const MCP_NAV_ICON_CSS = NAV_GLYPH_RULE
