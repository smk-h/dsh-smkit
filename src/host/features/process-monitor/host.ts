/**
 * The host half of the process monitor: one route, one sampler, one cleanup.
 *
 * Like the update feature this mounts no timer and no state of its own — the
 * sampler only runs while the page polls, and the route only exists to be
 * polled. The one thing this mount must add on top is the teardown: the
 * Windows sampler keeps a child of this host alive while polling continues,
 * and that child must not outlive the plugin.
 */

import { createProcessMonitorHandlers } from './api.js'
import { createProcessSampler } from './sampler.js'
import type { HostFeature, HostPlatform } from '../../platform/context.js'

export const processMonitorFeature: HostFeature = {
  id: 'process-monitor',

  mount(platform: HostPlatform): void {
    const sampler = createProcessSampler({ logger: platform.logger })
    platform.handlers.push(
      ...createProcessMonitorHandlers({ logger: platform.logger, sampler }),
    )
    // On unload/reload the sampler's resident helper (if any) goes with the
    // plugin; a poll that races the teardown answers `warmingUp` once and
    // never again.
    platform.ctx.effect(() => () => sampler.dispose(), 'process-monitor/sampler')
  },
}
