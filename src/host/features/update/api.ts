/**
 * The update route: one read, and no write.
 *
 * The host answers "is there a newer release, and which command installs it".
 * It deliberately does not install: updating means writing into the profile and
 * restarting the host, so the gesture belongs in a terminal where the user can
 * see it happen. The dialog shows the command and copies it.
 *
 * A failed check is still a 200 — the answer is `{ error }`, which the button
 * prints. Only a request that is not the check at all leaves this handler.
 */

import { sendJson } from '../../platform/util/http.js'
import { PLUGIN_ID, PLUGIN_VERSION } from '../../platform/constants.js'
import { checkForUpdate } from './check.js'
import { installCommand } from './command.js'
import type { ApiHandler } from '../../platform/routes.js'
import type { LoggerLike, ServiceAccessor } from '../../platform/types.js'

/** What the route needs: the host services and this build's identity. */
export interface UpdateApiDeps {
  services: ServiceAccessor
  logger: LoggerLike
  /** The profile this host runs, when the harness says. */
  profile?: string | null
  /**
   * Whether this is the Desktop application, whose profile is owned by the
   * Electron app: `dsh plugin --profile desktop` is refused, so there is no
   * command to hand out.
   */
  desktop?: boolean
  /** Package name; defaults to the package that ships this build. */
  packageName?: string
  /** Running version; defaults to `package.json`'s. */
  current?: string
}

/** The profile a web host almost always runs; the fallback when unknown. */
const DEFAULT_PROFILE = 'web'

/** The feature's handlers, in matching order. */
export function createUpdateHandlers(deps: UpdateApiDeps): ApiHandler[] {
  const packageName = deps.packageName ?? PLUGIN_ID
  const current = deps.current ?? PLUGIN_VERSION

  return [
    async (req, res, facts) => {
      if (facts.rest !== '/update/check' || req.method !== 'GET') return false

      const view = await checkForUpdate({ packageName, current, logger: deps.logger })
      const latest = view.latest
      if (!view.hasUpdate || latest === null) {
        sendJson(res, 200, view)
        return true
      }
      if (deps.desktop === true) {
        sendJson(res, 200, view)
        return true
      }
      sendJson(res, 200, {
        ...view,
        installCommand: installCommand(deps.profile ?? DEFAULT_PROFILE, packageName, latest),
      })
      return true
    },
  ]
}
