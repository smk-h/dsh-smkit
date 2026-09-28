/**
 * The boot splash, painted in the theme's own canvas.
 *
 * The shell renders that splash while plugin bundles load, over
 * `var(--dsw-alias-bg-base, Canvas)` — the shell's canvas, which cannot be a
 * theme's, because the layer that would supply it travels inside one of the
 * bundles still loading (the measurement is in `src/shared/theme-center/boot.ts`).
 * The shell's webserver hands plugins one way in: whoever is listening for
 * `webserver/index-inject` pushes rows into the table it renders into the served
 * `index.html`, and head rows land before the bundle tags. This module builds the
 * row this plugin pushes, and the boot HTML is the only thing about the shell it
 * touches.
 *
 * A script rather than a style, because which theme is on is the *browser's*
 * answer (`smkit:theme` in its own storage) while the host renders one HTML for
 * every browser: the script carries the map and asks the browser, which needs no
 * state on this side and no round trip.
 *
 * What it paints is the splash alone. `data-dsh-boot` is the attribute the shell
 * stamps on the splash's root — its class names are build hashes, the attribute
 * is not — so the rule dies with the splash element: nothing has to be retracted,
 * no application or theme token is touched, and there is no precedence to lose.
 * A shell that renames the attribute leaves the rule inert, and the flash comes
 * back with nothing else changed.
 */

import { THEME_CANVAS } from '../../../shared/theme-center/boot.js'

/** The attribute the shell stamps on the splash's root element. */
export const SPLASH_ATTR = 'data-dsh-boot'

/** The attribute the injected style wears, so a devtools search finds it. */
export const BOOT_STYLE_ATTR = 'data-smkit-boot-canvas'

/** Where the browser keeps the theme it chose (the client's own key). */
const THEME_KEY = 'smkit:theme'

/**
 * One row of the shell's boot-injection table, as far as this plugin writes one.
 * Structural: the plugin declares the shape it fills rather than importing the
 * shell's own type.
 */
export interface BootInjectionRow {
  kind: 'script'
  placement: 'head'
  text: string
}

/**
 * The head script: reads the browser's stored theme, and edges the splash with
 * the canvas that theme paints.
 *
 * Written as one self-contained statement so it can sit in a `<script>` element
 * with nothing around it, and wrapped in a `try` because a browser that denies
 * storage (private mode) must cost the paint, not the boot.
 *
 * @param canvases - the map to inline; the shipped one by default.
 * @returns one line of JavaScript, safe inside a `<script>` element.
 */
export function bootPaintScript(canvases: Readonly<Record<string, string>> = THEME_CANVAS): string {
  return [
    '(function(){try{',
    `var id=localStorage.getItem(${JSON.stringify(THEME_KEY)});`,
    `var canvas=id?${JSON.stringify(canvases)}[id]:null;`,
    'if(!canvas)return;',
    'var style=document.createElement("style");',
    `style.setAttribute(${JSON.stringify(BOOT_STYLE_ATTR)},"");`,
    `style.textContent=${JSON.stringify(`html [${SPLASH_ATTR}]{background:`)} + canvas + " !important}";`,
    '(document.head||document.documentElement).appendChild(style);',
    '}catch(e){}})();',
  ].join('')
}

/**
 * The rows this plugin contributes: one, and none at all when the center ships
 * no canvas to paint.
 *
 * @param canvases - the map the script inlines; the shipped one by default.
 * @returns the injection table rows, in the order to push them.
 */
export function bootPaintRows(canvases: Readonly<Record<string, string>> = THEME_CANVAS): BootInjectionRow[] {
  if (Object.keys(canvases).length === 0) return []
  return [{ kind: 'script', placement: 'head', text: bootPaintScript(canvases) }]
}
