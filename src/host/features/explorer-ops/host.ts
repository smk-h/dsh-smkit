/**
 * The explorer-ops feature's host half: `mount()`.
 *
 * The feature owns no runtime and no state — a creation is one `mkdir` or one
 * `writeFile` against the path the browser half named — so mounting it is one
 * handler on the platform's route list. Nothing is declared as a hard
 * dependency: without a webserver the rows simply never reach this half.
 */

import { createExplorerHandlers } from './api.js'
import type { HostFeature, HostPlatform } from '../../platform/context.js'

export const explorerOpsFeature: HostFeature = {
  id: 'explorer-ops',

  mount(platform: HostPlatform): void {
    platform.handlers.push(...createExplorerHandlers())
  },
}
