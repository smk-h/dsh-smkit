/**
 * The custom-settings feature's stylesheet, as the text the composition layer
 * injects.
 *
 * One part per stylesheet owner: the page's own rules (the tab strip and the
 * panels beneath it), then the tabs', in strip order. The platform layer's
 * stylesheet is injected first, so the pieces a tab wears that the whole plugin
 * shares (`smkit-ui-button` buttons, `smkit-ui-field-error` error lines) resolve there.
 *
 * The settings-nav mask this page used to paint lives in the merged section now
 * (`src/client/settings.ts`): one nav row stands for all three pages.
 * `platform/icons/Settings2Icon` is still drawn there, as this page's tab glyph.
 */

import modelInputCss from './style/model-input.css'
import otherCss from './style/other.css'
import pageCss from './style/page.css'
import retryCss from './style/retry.css'

/** The feature's own rules, in cascade order. */
export const CUSTOM_SETTINGS_CSS = [pageCss, retryCss, modelInputCss, otherCss].join('\n')
