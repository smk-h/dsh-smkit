/**
 * The skills feature's host half: `mount()`.
 *
 * The feature owns no runtime and no state file — the catalog lives in DSH's
 * own skill registry, and a removal is a filesystem delete — so mounting it is
 * one handler against the platform's service accessor. Nothing is declared as a
 * hard dependency: a profile whose composition has no `skills` service only
 * loses the list (the page says so), and one without a `workspaceRegistry` only
 * loses the project scope.
 */

import { handleSkills } from './api.js'
import type { HostFeature, HostPlatform } from '../../platform/context.js'
import type { SkillsApiDeps } from './types.js'

export const skillsFeature: HostFeature = {
  id: 'skills',

  mount(platform: HostPlatform): void {
    const deps: SkillsApiDeps = { services: platform.services, logger: platform.logger }
    platform.handlers.push((req, res, facts) => handleSkills(req, res, facts, deps))
  },
}
