/**
 * The OpenSpec feature's host half: `mount()`.
 *
 * It owns no runtime and no state file. The whole feature is two filesystem
 * questions — what is in the workspace, and remove it — plus one git question
 * answered by the `git` binary itself (see `gitignore.ts`), all served through
 * the project root the request names, so mounting it is one handler against the
 * platform's logger and nothing else. No DSH service is declared as a
 * dependency because no DSH service is used: a profile whose composition has
 * no workspace registry still gets a working panel, because the workspace comes
 * from the request rather than from a registry lookup.
 */

import { handleOpenSpec } from './api.js'
import type { HostFeature, HostPlatform } from '../../platform/context.js'
import type { OpenSpecApiDeps } from './types.js'

export const openSpecFeature: HostFeature = {
  id: 'openspec',

  mount(platform: HostPlatform): void {
    const deps: OpenSpecApiDeps = { logger: platform.logger }
    platform.handlers.push((req, res, facts) => handleOpenSpec(req, res, facts, deps))
  },
}
