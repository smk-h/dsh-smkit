/**
 * The custom-settings feature's stylesheets, as the text `entry.ts` injects.
 *
 * One part per stylesheet owner: the page's own rules (the intro, the tab
 * strip, the panel), then the tabs', in strip order. The platform layer's
 * stylesheet is injected first, so the pieces a tab wears that the whole plugin
 * shares (`mm_btn` buttons, `mm_err` error lines, the settings-nav glyph paint)
 * resolve there.
 *
 * The one thing a stylesheet cannot hold is this section's settings-nav mask, a
 * data URI built from the icon spec at runtime: the platform layer's
 * `style/settings-nav.css` consumes it as the `--dsh-smkit-nav-glyph` custom
 * property and the rule below defines that property for this section's row.
 */

import modelInputCss from './style/model-input.css'
import otherCss from './style/other.css'
import pageCss from './style/page.css'
import retryCss from './style/retry.css'
import { SETTINGS2_SPEC } from '../../platform/icons/Settings2Icon'
import { SETTINGS_NAV_ATTRIBUTE } from '../../platform/ui/settings-nav'
import { iconMaskDataUri } from '../../platform/icons/Icon'

/** The feature's own rules, in cascade order. */
export const CUSTOM_SETTINGS_CSS = [pageCss, retryCss, modelInputCss, otherCss].join('\n')

/** The settings-nav glyph as a CSS mask image: alpha only, so the row's own
 * `currentColor` (default, hover, active) sets the colour while the mask keeps
 * the shell's 16px nav rhythm.
 *
 * The shape is lucide's `settings-2` — the sliders this page draws for
 * "configuration" — taken from the same spec the icon component renders
 * (`platform/icons/Settings2Icon`), so the drawn SVG and the mask cannot drift. */
const NAV_GLYPH = iconMaskDataUri(SETTINGS2_SPEC)

/** The glyph as a custom property — how a stylesheet receives a value only code
 * can produce. The platform layer's `style/settings-nav.css` consumes it on
 * every marked row; this rule supplies it on this section's row alone, keyed by
 * the marker's value, which is the feature id in `client.ts`. */
export const CUSTOM_SETTINGS_NAV_ICON_CSS =
  `[${SETTINGS_NAV_ATTRIBUTE}='custom-settings']{--dsh-smkit-nav-glyph:url("${NAV_GLYPH}")}`
