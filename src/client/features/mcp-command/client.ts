/**
 * The mcp-command feature: the `/mcp` slash command's tool picker.
 *
 * It draws nothing of its own — the shell's select panel is the surface — so the
 * feature is a registration and its copy. It stands down whole on a host whose
 * client has no command UI (`platform/command-ui` answers undefined), and the
 * host `/mcp` command keeps working from the keyboard there.
 */

import { MCP_COMMAND_LOCALE_EN } from './i18n/en'
import { MCP_COMMAND_LOCALE_ZH } from './i18n/zh'
import { registerMcpCommandPanel } from './panel'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from '../../platform/types'

export const mcpCommandFeature: ClientFeature = {
  id: 'mcp-command',
  locale: {
    namespace: 'mcp-command',
    zh: MCP_COMMAND_LOCALE_ZH,
    en: MCP_COMMAND_LOCALE_EN,
  },

  register(ctx: ClientContext, deps: ClientDeps, t: Translator): void {
    ctx.effect(
      () => registerMcpCommandPanel({ ctx, deps, t }),
      'smkit: mcp/command panel',
    )
  },
}
