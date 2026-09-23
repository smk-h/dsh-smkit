/**
 * The theme feature's stylesheet, as the text the composition layer injects.
 *
 * The parts, and the order is the cascade: the panel's own rules first, then
 * the skins. The dsh-themes ports are plain `body[data-dsh-<id>]`-scoped
 * sheets ported verbatim (the dragonboat one with its signature palette
 * repaired — see the repair block at the foot of that file), and they must
 * stay verbatim: the applier switches the exact attribute their selectors
 * name, and a future port from dsh-themes is a file drop here plus one row in
 * `skins.ts`. The zcode sheet is the same shape but authored here — ported
 * from ZCode's own theme sources rather than dsh-themes — so it plays by the
 * same rule: tokens only, scoped on `data-dsh-zcode`.
 */

import pageCss from './style/page.css'
import debugCss from './style/debug.css'
import skinDragonboatCss from './style/skin-festival-dragonboat.css'
import skinNordCss from './style/skin-nord.css'
import skinZcodeCss from './style/skin-zcode.css'

/** The feature's own rules, in cascade order. */
export const THEME_CSS = [
  pageCss,
  debugCss,
  skinDragonboatCss,
  skinNordCss,
  skinZcodeCss,
].join('\n')
