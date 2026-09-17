/**
 * Types the skills feature owns.
 *
 * The page reads the filesystem directly (see `scan.ts` for why), so the only
 * harness surface left in this feature is the workspace registry the scope
 * picker is filled from — read per call through the platform's structural
 * accessor, and therefore declared there rather than here.
 */

import type { RequestFacts } from '../../platform/routes.js'
import type { LoggerLike, RequestLike, ResponseLike, ServiceAccessor } from '../../platform/types.js'

/** What the skills route handler is built with. */
export interface SkillsApiDeps {
  /** The workspace registry the scope picker lists, when the composition has one. */
  services: ServiceAccessor | null | undefined
  logger: LoggerLike
}

/** This feature's handler shape: the platform's, plus this feature's deps. */
export type SkillsHandler = (
  req: RequestLike,
  res: ResponseLike,
  facts: RequestFacts,
  deps: SkillsApiDeps,
) => Promise<boolean> | boolean
