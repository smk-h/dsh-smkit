/**
 * A folder: one workspace, whose own servers live in `.dsh/dshmm/mcp.json`.
 */

import { createIcon, type IconFactory } from './Icon'
import type { ClientDeps } from '../../runtime/types'

export function createFolderIcon(deps: ClientDeps): IconFactory {
  return createIcon(
    deps,
    [
      'M13.33 13.33a1.33 1.33 0 001.34-1.33V5.33a1.33 1.33 0 00-1.34-1.33H8.07a1.33 1.33 0 01-1.13-.6L6.4 2.6A1.33 1.33 0 005.29 2H2.67a1.33 1.33 0 00-1.34 1.33v8.67a1.33 1.33 0 001.34 1.33z',
    ],
    1.3,
  )
}
