/**
 * The retry feature's host half: `mount()`.
 *
 * It builds the administration and contributes its handler. Nothing here
 * declares `llm` or `settings` as a hard dependency: both are resolved through
 * the structural accessor per request, so a deployment that mounts neither
 * still loads this plugin — its page then says which half is missing instead of
 * failing the boot.
 */

import { createRetryAdmin } from './service.js'
import { createRetryHandlers } from './api.js'
import type { HostFeature, HostPlatform } from '../../platform/context.js'

export const llmRetryFeature: HostFeature = {
  id: 'llm-retry',

  mount(platform: HostPlatform): void {
    const admin = createRetryAdmin({
      services: platform.services,
      logger: platform.logger,
    })
    platform.handlers.push(...createRetryHandlers(admin))
  },
}
