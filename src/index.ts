/**
 * dsh-smkit — the first-plugin example from the Cordis tutorial:
 * https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/01-first-plugin
 *
 * - `name` is optional display metadata used to identify the plugin in
 *   loader diagnostics.
 * - Cordis calls `apply(ctx)` when the Loader mounts this module.
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'

export function apply(ctx: Context) {
  console.log('hello from my first plugin')
}
