/**
 * The input-history feature: ↑ in the conversation composer brings back the
 * last `/mcp` command, ↓ walks forward again.
 *
 * The shell's composer has no history of its own and publishes no submitted
 * lines, so this is a decoration of the one control it cannot extend: a
 * capture-phase key listener (see `history.ts`). It draws nothing, carries no
 * copy, and keeps its whole state in `localStorage` under the workspace path —
 * a workspace never sees another's commands, and a host whose storage refuses
 * writes simply has no history.
 */

import { watchCommandHistory } from './history'
import type { ClientContext, ClientFeature } from '../../platform/types'

export const inputHistoryFeature: ClientFeature = {
  id: 'input-history',
  // No copy of its own: the feature is a keystroke, not a surface.
  locale: { namespace: 'input-history', zh: {}, en: {} },

  register(ctx: ClientContext): void {
    ctx.effect(
      () => watchCommandHistory(ctx),
      'smkit: input history',
    )
  },
}
