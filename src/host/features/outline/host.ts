/**
 * The outline feature's host half: `mount()`.
 *
 * It owns no runtime and no state — a request reads one file and returns the
 * symbols it found — so mounting it is one handler on the platform's route list.
 * Nothing here is declared as a hard dependency: without a webserver the outline
 * simply never reaches this half.
 */

import { createOutlineHandlers } from './api.js'
import type { HostFeature, HostPlatform } from '../../platform/context.js'

export const outlineFeature: HostFeature = {
  id: 'outline',

  mount(platform: HostPlatform): void {
    platform.handlers.push(...createOutlineHandlers())
  },
}
