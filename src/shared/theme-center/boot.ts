/**
 * The one theme value the host half needs, and why it needs it.
 *
 * A theme of the center is an alias-token *layer* the client stacks over the
 * shell's active theme (`ctx.theme.overrideTokens`, see the feature's
 * `apply.ts`) — so the layer exists only once this plugin's client bundle has
 * been fetched and activated. The shell spends exactly that window on its boot
 * splash (`HARNESS` / "Loading plugins…"), and the splash's backdrop is
 * `var(--dsw-alias-bg-base, Canvas)`: the *shell's* canvas, which cannot be a
 * theme's while the bundle that would supply it is still loading.
 *
 * A theme whose canvas differs from the shell's therefore arrives after the
 * screen it should have painted. Measured under the center's dark theme: the
 * splash painted `#151517`, the app `#282c34`, and the hand-off read as a black
 * flash — while with no theme applied the two values are the same and nothing
 * is visible, which is why the flash only ever showed up with a theme.
 *
 * So the host paints that first screen. It contributes one head script to the
 * boot HTML (`host/features/theme-center/boot-paint.ts`), and the only thing the
 * script has to know is the canvas colour each theme paints — this module.
 *
 * The colour stays written in the theme's own table as well, deliberately:
 * `scripts/theme-sheet-guard.mjs` checks a table's *text* against the swatch the
 * card advertises, so a table spelling its canvas as a reference to this map
 * would fail that check. `test/theme-center-boot.test.mjs` is what holds the two
 * in step, so a re-tuned canvas fails CI instead of shipping a splash in the
 * colour the theme used to have — and a theme *added* to the center therefore
 * needs one line here, which is the one edit the table's own list cannot make
 * obvious.
 */

/** The alias token the shell paints its canvas with — the one the boot splash
 * falls back to when nothing else names it. */
export const CANVAS_TOKEN = '--dsw-alias-bg-base'

/** Theme id → the colour that theme paints as the shell's canvas. */
export const THEME_CANVAS: Readonly<Record<string, string>> = {
  'one-dark-pro': '#282c34',
}
