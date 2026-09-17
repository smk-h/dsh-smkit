/**
 * Client half entry module.
 *
 * Exports the two symbols the DSH client-runtime expects from a bundle: `apply`
 * (mount) and `inject` (the client service names it needs). The loader wrapper
 * around this module is contributed by tsdown's output options, so this file
 * stays a plain module with no knowledge of how it is shipped.
 *
 * The plugin's features are the list below. Everything they share — the
 * platform stylesheet, the platform dictionary, the stylesheet injector — is
 * set up once here; each feature then registers its own seats through its
 * descriptor, so this file needs to know nothing about MCP, about session
 * deletion, or about custom settings beyond which one sits where. Adding a
 * feature is a directory plus one entry in `FEATURES`.
 */

import { customSettingsFeature } from './features/custom-settings/client'
import { mcpFeature } from './features/mcp/client'
import { sessionDeleteFeature } from './features/session-delete/client'
import { skillsFeature } from './features/skills/client'
import { createApi } from './platform/api'
import { PLATFORM_LOCALE_EN } from './platform/i18n/en'
import { PLATFORM_LOCALE_ZH } from './platform/i18n/zh'
import { PLATFORM_CSS, installStylesheet } from './platform/styles'
import type { ClientContext, ClientDeps, ClientFeature } from './platform/types'

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

/** The features this plugin ships; the order here is the order they register. */
const FEATURES: ClientFeature[] = [
  mcpFeature,
  sessionDeleteFeature,
  customSettingsFeature,
  skillsFeature,
]

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

  // Styles go in at load time, as they always have: the platform layer's rules
  // first, then each feature's own, so a feature wins wherever the two overlap.
  // Each sheet is keyed by `data-plugin-css`, so a hot reload cannot stack
  // copies.
  installStylesheet('dsh-mcp-manager/platform', PLATFORM_CSS)
  for (const feature of FEATURES) {
    for (const sheet of feature.styles) {
      installStylesheet(`dsh-mcp-manager/${sheet.name}`, sheet.css)
    }
  }

  return {
    apply(ctx: ClientContext): void {
      // The platform dictionary is registered before the features: the platform
      // layer's own components read their copy through `platformT`, and each
      // feature binds its own namespace afterwards.
      ctx.effect(
        () => ctx.locale.register('platform', { zh: PLATFORM_LOCALE_ZH, en: PLATFORM_LOCALE_EN }),
        'dsh-mcp-manager: platform/dictionaries',
      )
      const deps: ClientDeps = {
        react,
        h: react.createElement,
        api: createApi(),
        platformT: ctx.locale.bind('platform'),
        createPortal,
        Tooltip,
      }
      for (const feature of FEATURES) {
        ctx.effect(
          () => ctx.locale.register(feature.locale.namespace, {
            zh: feature.locale.zh,
            en: feature.locale.en,
          }),
          `dsh-mcp-manager: ${feature.id}/dictionaries`,
        )
        feature.register(ctx, deps, ctx.locale.bind(feature.locale.namespace))
      }
    },
    inject,
  }
}

export const { apply } = createPlugin()
