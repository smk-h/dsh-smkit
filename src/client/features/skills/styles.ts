/**
 * The skills feature's stylesheet, as the text the composition layer injects.
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
 * The settings-nav mask this section used to paint lives in the merged section
 * now (`src/client/settings.ts`): one nav row stands for all three pages.
 * `icons/WandSparklesIcon` is still drawn there, as the Skills tab's glyph.
 */

import detailCss from './style/detail.css'
import pageCss from './style/page.css'
import rowCss from './style/row.css'

/** The feature's own rules, in cascade order. */
export const SKILLS_CSS = [pageCss, rowCss, detailCss].join('\n')
