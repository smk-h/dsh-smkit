/**
 * The add button above the server list.
 *
 * Glyph ported verbatim from @deepseek-ai/dsh-client-ui-primitives 0.1.5-rc.2 (MIT, © 2026 DeepSeek)
 * (`IconPlusOutline16`), so the section draws the same shapes DSH does without
 * taking a runtime dependency on that package.
 */

import { createIcon, type IconFactory } from '../../../platform/icons/Icon'
import type { ClientDeps } from '../../../platform/types'

export function createPlusIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, {
    size: 16,
    viewBox: '0 0 16 16',
    nodes: [
      { tag: 'path', attrs: { d: 'M8.64453 1.5V7.34961H14.5V8.65039H8.64453V14.5H7.34473V8.65039H1.5V7.34961H7.34473V1.5H8.64453Z', fill: 'currentColor' } }
    ],
  })
}
