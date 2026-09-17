/**
 * The skills feature's stylesheets, as the text `entry.ts` injects.
 *
 * The rules live in the `.css` files under `style/`, split by UI module and
 * imported here as strings (the build turns each of them into a string module:
 * the browser half is one script and cannot fetch a stylesheet).
 *
 * `SKILLS_CSS` is the concatenation order and therefore the cascade order — the
 * page shell first, then the row it stacks, then the dialog the row opens. All
 * parts are namespaced `sk_*` and raise specificity by adding a class, so no
 * rule's winner depends on this order; keep it in reading order anyway. The
 * platform layer's stylesheet is injected before this one, which is also what
 * lets `.sk_detail` widen the platform's `.mm_dialog` cap.
 *
 * The one thing a stylesheet cannot hold is this section's settings-nav mask, a
 * data URI built from the icon spec at runtime: the platform layer's
 * `style/settings-nav.css` consumes it as the `--dsh-smkit-nav-glyph` custom
 * property and the rule below defines that property for this section's row.
 */

import { SETTINGS_NAV_ATTRIBUTE } from '../../platform/ui/settings-nav'
import { iconMaskDataUri } from '../../platform/icons/Icon'
import { WAND_SPARKLES_SPEC } from './icons/WandSparklesIcon'
import detailCss from './style/detail.css'
import pageCss from './style/page.css'
import rowCss from './style/row.css'

/** The feature's own rules, in cascade order. */
export const SKILLS_CSS = [pageCss, rowCss, detailCss].join('\n')

/**
 * The settings-nav glyph as a CSS mask image: alpha only, so the row's own
 * `currentColor` (default, hover, active) sets the colour while the mask keeps
 * the shell's 16px nav rhythm.
 *
 * The shape is lucide's `wand-sparkles`, taken from the same spec the icon set
 * renders (`icons/WandSparklesIcon`), so the drawn SVG and the mask cannot
 * drift: this section manages skills, and the wand reads as "a capability the
 * agent applies" better than the gear the shell falls back to.
 */
const NAV_GLYPH = iconMaskDataUri(WAND_SPARKLES_SPEC)

/**
 * The glyph as a custom property — how a stylesheet receives a value only code
 * can produce. The platform layer's `style/settings-nav.css` consumes it on
 * every marked row; this rule supplies it on this section's row alone, keyed by
 * the marker's value (`platform/ui/settings-nav`).
 */
export const SKILLS_NAV_ICON_CSS = `[${SETTINGS_NAV_ATTRIBUTE}='skills']{--dsh-smkit-nav-glyph:url("${NAV_GLYPH}")}`
