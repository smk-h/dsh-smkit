/**
 * The custom-settings feature's host half: `mount()`.
 *
 * The page is a strip of tabs and this half serves them; today that is the
 * model-retry tab and the model-input tab, each with its administration built
 * here. A tab that needs the host contributes its handlers the same way (see
 * `FEATURES` in `src/index.ts`).
 *
 * Nothing here declares `llm` or `settings` as a hard dependency: both are
 * resolved through the structural accessor per request, so a deployment that
 * mounts neither still loads this plugin — its tabs then say which half is
 * missing instead of failing the boot.
 */

import { createRetryAdmin } from './service.js'
import { createRetryHandlers } from './api.js'
import { createModelInputAdmin } from './model-input.js'
import { createModelInputHandlers } from './model-input-api.js'
import type { HostFeature, HostPlatform } from '../../platform/context.js'

export const customSettingsFeature: HostFeature = {
  id: 'custom-settings',

  mount(platform: HostPlatform): void {
    const deps = { services: platform.services, logger: platform.logger }
    platform.handlers.push(...createRetryHandlers(createRetryAdmin(deps)))
    platform.handlers.push(...createModelInputHandlers(createModelInputAdmin(deps)))
  },
}
