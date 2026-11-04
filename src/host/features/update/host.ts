/**
 * The host half of the update button: one route and no state.
 *
 * Nothing is scheduled and nothing is cached — the settings section's button is
 * the only trigger. The profile name and the Desktop flag are read once, at
 * mount, because both answer a question about the process rather than about a
 * request.
 */

import { createUpdateHandlers } from './api.js'
import { isDesktopProfile, profileNameOf } from '../../platform/desktop.js'
import type { HostFeature, HostPlatform } from '../../platform/context.js'

export const updateFeature: HostFeature = {
  id: 'update',

  mount(platform: HostPlatform): void {
    platform.handlers.push(
      ...createUpdateHandlers({
        services: platform.services,
        logger: platform.logger,
        profile: profileNameOf(platform.ctx),
        desktop: isDesktopProfile(platform.ctx),
      }),
    )
  },
}
