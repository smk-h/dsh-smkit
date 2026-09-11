/**
 * The caret on a picker trigger, drawn to match the server card's chevron.
 */

import { createIcon, type IconFactory } from './Icon'
import type { ClientDeps } from '../../runtime/types'

export function createChevronDownIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, ['M4 6l4 4 4-4'], 1.6)
}
