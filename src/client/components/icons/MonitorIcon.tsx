/**
 * A display: the global scope, whose servers apply to every workspace.
 */

import { createIcon, type IconFactory } from './Icon'
import type { ClientDeps } from '../../runtime/types'

export function createMonitorIcon(deps: ClientDeps): IconFactory {
  return createIcon(
    deps,
    [
      'M2.67 2h10.66a1.33 1.33 0 011.34 1.33v6.67a1.33 1.33 0 01-1.34 1.33H2.67A1.33 1.33 0 011.33 10V3.33A1.33 1.33 0 012.67 2z',
      'M8 11.33V14',
      'M5.4 14h5.2',
    ],
    1.3,
  )
}
