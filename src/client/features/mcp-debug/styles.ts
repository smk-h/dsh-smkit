/**
 * The debug page's stylesheet, as the text the composition layer injects.
 *
 * The rules live in the `.css` files under `style/`, imported here as strings
 * (the build turns each into a string module: the browser half is one script
 * and cannot fetch a stylesheet). The order below is the cascade order — the
 * page shell first, then the three columns in the order they read — and each
 * sheet owns its own `smkit-mcpdebug-<sheet>` prefix, so no rule's winner
 * depends on that order. Keep it in reading order anyway.
 */

import detailCss from './style/detail.css'
import pageCss from './style/page.css'
import serversCss from './style/servers.css'
import toolsCss from './style/tools.css'

/** The feature's own rules, in cascade order. */
export const MCP_DEBUG_CSS = [pageCss, serversCss, toolsCss, detailCss].join('\n')
