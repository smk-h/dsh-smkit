/**
 * The platform layer's own stylesheets, and the injection helper.
 *
 * The rules live in the `.css` files under `style/`, imported here as strings:
 * the build compiles each of them to a string module (see the `cssTextPlugin`
 * in `tsdown.config.ts`), because the client half ships as one script that the
 * browser cannot fetch a stylesheet for.
 *
 * These rules go in first. They carry what every feature shares — the round
 * icon-button skeleton, the dialog card, the error line, the spinner arc, the
 * settings-nav glyph paint — so a feature stylesheet injected afterwards wins
 * wherever the two overlap, which is the same direction the single concatenated
 * stylesheet had.
 */

import buttonCss from './style/button.css'
import dialogCss from './style/dialog.css'
import fieldErrorCss from './style/field-error.css'
import iconButtonCss from './style/icon-button.css'
import pickerCss from './style/picker.css'
import settingsNavCss from './style/settings-nav.css'
import spinCss from './style/spin.css'
import tabsCss from './style/tabs.css'
import tipCss from './style/tip.css'

/** The platform layer's rules, in cascade order. */
export const PLATFORM_CSS = [
  iconButtonCss,
  buttonCss,
  dialogCss,
  fieldErrorCss,
  spinCss,
  tabsCss,
  tipCss,
  pickerCss,
  settingsNavCss,
].join('\n')

/**
 * Idempotently add one stylesheet to the document head, keyed by `name`.
 * @param name - the `data-plugin-css` key; a second call with the same name is a no-op.
 * @param css - the rules to inject.
 */
export function installStylesheet(name: string, css: string): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${name}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-mcp-manager'
  tag.dataset.pluginCss = name
  tag.textContent = css
  document.head.appendChild(tag)
}
