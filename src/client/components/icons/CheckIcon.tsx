/**
 * The tick marking the current choice inside an open menu.
 */

import { createIcon, type IconFactory } from './Icon'
import type { ClientDeps } from '../../runtime/types'

export function createCheckIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, ['M3.5 8.5l3 3 6-7'], 1.6)
}
