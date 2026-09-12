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

/** Client services injected by the DSH client runtime. */
export const inject = ['slots', 'locale']

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

  installStyles()

  const deps: ClientDeps = {
    react,
    h: react.createElement,
    api: createApi(),
    zh: MCP_LOCALE_ZH as LocaleDict,
    en: MCP_LOCALE_EN as LocaleDict,
    createPortal,
  }
  const McpContent = createMcpContent(deps)

  return { apply: createApply(deps, McpContent), inject }
}

export const { apply } = createPlugin()
