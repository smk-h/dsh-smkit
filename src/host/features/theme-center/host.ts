/**
 * The host half of the theme center: one row into the shell's boot HTML.
 *
 * The center's colors are a client concern — a layer of alias overrides stacked
 * on every boot. The one thing that cannot wait for that client bundle is the
 * screen the shell shows *while* it loads, so this feature exists for exactly
 * that: it subscribes to the webserver's boot-injection table and pushes the row
 * that paints the splash in the theme's own canvas (`boot-paint.ts`).
 *
 * Nothing else is registered here — no route, no service, no state — and the
 * subscription is unconditional because the row it pushes is a pure function of
 * what the browser itself has stored: the emit only happens when a webserver
 * renders an index at all, so a profile without one never sees it.
 */

import { bootPaintRows } from './boot-paint.js'
import type { HostFeature, HostPlatform } from '../../platform/context.js'

export const themeCenterFeature: HostFeature = {
  id: 'theme-center',

  mount(platform: HostPlatform): void {
    const ctx = platform.ctx
    ctx.effect(
      () =>
        ctx.on('webserver/index-inject', (table: unknown) => {
          // The shell hands the same array to every subscriber in turn. A table
          // that is not an array is a shell this plugin does not know: the
          // splash then keeps the shell's own canvas, which is where it started.
          if (!Array.isArray(table)) return
          for (const row of bootPaintRows()) table.push(row)
        }),
      'smkit: theme-center/boot-paint',
    )
  },
}
