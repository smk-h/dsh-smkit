/**
 * The process monitor's stylesheet, as the text the composition layer injects.
 *
 * The rules live in `style/*.css`, imported here as strings (the build turns
 * each into a string module: the browser half is one script and cannot fetch
 * a stylesheet). The order below is the cascade order, and each sheet owns
 * its own `smkit-pm-<sheet>` prefix, so no rule's winner depends on that
 * order. Keep it in reading order anyway.
 */

import pageCss from './style/page.css'

/** The feature's own rules, in cascade order. */
export const PROCESS_MONITOR_CSS = pageCss
