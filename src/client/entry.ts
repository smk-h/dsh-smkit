/**
 * Client half entry module.
 *
 * Exports the two symbols the DSH client-runtime expects from a bundle:
 * `apply` (mount) and `inject` (the client service names it needs). The loader
 * wrapper around this module is contributed by tsdown's output options, so this
 * file stays a plain module with no knowledge of how it is shipped.
 */

import { createMcpContent } from './components/McpContent'
import { createApi } from './runtime/api'
import { createApply } from './runtime/plugin'
import { installStyles } from './style'
import { MCP_LOCALE_EN } from './i18n/en'
import { MCP_LOCALE_ZH } from './i18n/zh'
import type { ClientContext, ClientDeps, LocaleDict } from './runtime/types'

/**
 * Client services injected by the DSH client runtime.
 *
 * `sessions` is the client session store: the delete control uses it to move
 * this browser off a session it just removed. The header registration itself is
 * optional (its slot is injected, not required), but the service is a hard
 * dependency of the control, so the bundle declares it the same way DSH's own
 * session-header contributions do.
 */
export const inject = ['slots', 'locale', 'sessions']

export function createPlugin(): { apply(ctx: ClientContext): void; inject: string[] } {
  const react = require('react')

  // The settings-header breadcrumb portals into the shell's title strip, which
  // needs react-dom. The host module table carries it (the shell's own plugins
  // resolve it the same way); an older host without it only loses the bar —
  // the section renders whole.
  let createPortal: ClientDeps['createPortal']
  try {
    createPortal = require('react-dom').createPortal
  } catch {
    // No react-dom in the platform module table: no header breadcrumb.
  }

  // The header control's hover bubble is the shell's own: the web shell seeds
  // ui-primitives into the same module table (`packages/client/web/src/seed.ts`),
  // so requiring it hands back the very component DSH's header buttons use —
  // same theme variables, same animation, and the same viewport fit pass that
  // keeps a bubble near an edge from being cut off. Porting a copy would mean
  // re-deriving all three, and guessing at variables an older theme may not
  // define; a host without the module only loses the bubble (see `ClientDeps`).
  let Tooltip: ClientDeps['Tooltip']
  try {
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    if (typeof primitives.Tooltip === 'function') Tooltip = primitives.Tooltip as ClientDeps['Tooltip']
  } catch {
    // No ui-primitives in the platform module table: the browser's own bubble.
  }

  installStyles()

  const deps: ClientDeps = {
    react,
    h: react.createElement,
    api: createApi(),
    zh: MCP_LOCALE_ZH as LocaleDict,
    en: MCP_LOCALE_EN as LocaleDict,
    createPortal,
    Tooltip,
  }
  const McpContent = createMcpContent(deps)

  return { apply: createApply(deps, McpContent), inject }
}

export const { apply } = createPlugin()
