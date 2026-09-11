/**
 * Client-side `apply`.
 *
 * Two responsibilities, both delegated to DSH:
 * - register the bilingual `mcp` dictionary (`ctx.locale.register`), so DSH owns
 *   language selection, browser fallback, persistence and live updates;
 * - register the Settings → MCP tab in the `settings.section` slot, tagged with
 *   `locale: "mcp"` so its component receives the standard `t` prop.
 *
 * The plugin deliberately has no language selector, no language state and no
 * language API of its own.
 */

import type { ClientContext, ClientDeps } from './types'

const NAMESPACE = 'mcp'

export function createApply(deps: ClientDeps, McpContent: unknown): (ctx: ClientContext) => void {
  return function apply(ctx: ClientContext): void {
    ctx.effect(
      () => ctx.locale.register(NAMESPACE, { zh: deps.zh, en: deps.en }),
      'dsh-mcp-manager: dictionaries',
    )
    const t = ctx.locale.bind(NAMESPACE)
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'mcp-manager',
          order: 50,
          label: () => t('sectionLabel'),
          locale: NAMESPACE,
        },
        McpContent,
      ),
    )
  }
}
