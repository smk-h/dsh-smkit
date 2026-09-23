/**
 * The MCP feature's stylesheet, as the text the composition layer injects.
 *
 * The rules live in the `.css` files under `style/`, imported here as strings
 * (the build turns each of them into a string module: the browser half is one
 * script and cannot fetch a stylesheet).
 *
 * This is the concatenation order and therefore the cascade order — page shell
 * first, then the pieces in the order the page stacks them. Every part is
 * namespaced by prefix (`mm_*`) and its variants raise specificity by adding a
 * class, so no rule's winner depends on this order; keep it in reading order
 * anyway. The platform layer's stylesheet is injected before this one, and
 * `settings.ts` decides where this sheet sits among the plugin's others.
 *
 * The settings-nav glyph this section used to paint lives in the merged
 * section now (`src/client/settings.ts`): one nav row stands for all three
 * pages, so one rule owns its mask.
 */

import breadcrumbCss from './style/breadcrumb.css'
import cardCss from './style/card.css'
import formCss from './style/form.css'
import pillCss from './style/pill.css'
import searchCss from './style/search.css'
import sectionCss from './style/section.css'
import switchCss from './style/switch.css'
import toolsCss from './style/tools.css'
import workspaceCss from './style/workspace.css'

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
