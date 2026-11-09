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
 *
 * The settings dialog is the exception worth naming: the MCP, skills and
 * custom-settings pages are three feature directories but one seat, taken by
 * `settingsFeature` (see `settings.ts`) — the composition layer above them.
 */

import { explorerCollapseFeature } from './features/explorer-collapse/client'
import { explorerMenuFeature } from './features/explorer-menu/client'
import { inputHistoryFeature } from './features/input-history/client'
import { lineJumpFeature } from './features/line-jump/client'
import { markdownOutlineFeature } from './features/markdown-outline/client'
import { mcpCommandFeature } from './features/mcp-command/client'
import { openSpecFeature } from './features/openspec/client'
import { outlineFeature } from './features/outline/client'
import { selectionQuoteFeature } from './features/selection-quote/client'
import { sessionDeleteFeature } from './features/session-delete/client'
import { tabMenuFeature } from './features/tab-menu/client'
import { themeCenterFeature } from './features/theme-center/client'
import { notifyFeature } from './features/notify/client'
import { settingsFeature } from './settings'
import { createApi, createStream } from './platform/api'
import { upstreamMcpManagerPresent } from './platform/upstream'
import { PLATFORM_LOCALE_EN } from './platform/i18n/en'
import { PLATFORM_LOCALE_ZH } from './platform/i18n/zh'
import { PLATFORM_CSS, installStylesheet } from './platform/styles'
import { watchTabsScroll } from './platform/ui/tabs-scroll'
import type { ClientContext, ClientDeps, ClientFeature } from './platform/types'

/**
 * Client services injected by the DSH client runtime.
 *
 * `sessions` is the client session store: the delete control uses it to move
 * this browser off a session it just removed. The header registration itself is
 * optional (its slot is injected, not required), but the service is a hard
 * dependency of the control, so the bundle declares it the same way DSH's own
 * session-header contributions do.
 *
 * `theme` is the shell's registry (`@deepseek-ai/dsh-client-ui-theme`, the
 * module the manifest lists in `dsh.client.inject`). It is declared rather than
 * read ad hoc because a declared service is a property on the context by the
 * time `apply` runs — the same way `ui-layout` reaches it (`ctx.theme`) — while
 * an undeclared one is not there to read, and a read that throws lands inside
 * the mount effect, where it costs the whole entry rather than one feature.
 * That is exactly how the first cut of the registry support failed
 * (`web boot: 1 entry did not activate`).
 */
export const inject = ['slots', 'locale', 'sessions', 'theme']

/** The features this plugin ships; the order here is the order they register. */
const FEATURES: ClientFeature[] = [
  sessionDeleteFeature,
  notifyFeature,
  settingsFeature,
  // The `/mcp` picker: it decorates the HOST command's bare invocation, so it
  // registers after the pages and before the surfaces that decorate the shell.
  mcpCommandFeature,
  openSpecFeature,
  themeCenterFeature,
  tabMenuFeature,
  // These decorate surfaces another plugin may own (the explorer, its rows, the
  // Markdown preview, the file view), so they register after every seat of this
  // plugin. Most stand themselves down when `dsh-better-sidebar` is the one
  // providing the affordance; the code outline does not — that plugin has no
  // symbol list, so it decorates the neighbour's editor alongside the host
  // preview instead (see `features/outline`).
  markdownOutlineFeature,
  lineJumpFeature,
  selectionQuoteFeature,
  outlineFeature,
  explorerMenuFeature,
  explorerCollapseFeature,
  // The composer's own keystroke: last, because it reads the draft store the
  // others write through and must never outrank a seat that draws something.
  inputHistoryFeature,
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
  // Each sheet is keyed by `data-smkit-css`, so a hot reload cannot stack
  // copies.
  installStylesheet('smkit/platform', PLATFORM_CSS)
  for (const feature of FEATURES) {
    for (const sheet of feature.styles ?? []) {
      installStylesheet(`smkit/${sheet.name}`, sheet.css)
    }
  }

  return {
    apply(ctx: ClientContext): void {
      // The upstream MCP manager (`dsh-mcp-manager`) owns MCP when it is loaded
      // next to this plugin: it registers the same `mcp` locale namespace, and
      // dsh answers that duplicate — not the feature — with an exception that
      // costs the whole entry. So the MCP half stands down here: no `mcp`
      // dictionary, no `/mcp` picker. The host half makes the same call from the
      // profile manifest, so both sides agree on which plugin owns MCP.
      const upstream = upstreamMcpManagerPresent()
      const features = upstream
        ? FEATURES.filter((feature) => feature !== mcpCommandFeature)
        : FEATURES
      // The platform dictionary is registered before the features: the platform
      // layer's own components read their copy through `platformT`, and each
      // feature binds its own namespace afterwards.
      ctx.effect(
        () => ctx.locale.register('platform', { zh: PLATFORM_LOCALE_ZH, en: PLATFORM_LOCALE_EN }),
        'smkit: platform/dictionaries',
      )
      // The tab strip is one row that scrolls (`platform/ui/tabs-scroll`): its
      // watch is armed here, once, rather than by each strip, because it finds
      // every strip in the document — present and future — and only ever needs
      // one of itself. A strip that mounts later (a page swapping under the
      // settings dialog) is picked up by its own scan.
      ctx.effect(() => watchTabsScroll(), 'smkit: tab strip scrolling')
      const deps: ClientDeps = {
        react,
        h: react.createElement,
        api: createApi(),
        stream: createStream(),
        platformT: ctx.locale.bind('platform'),
        createPortal,
        Tooltip,
      }
      for (const feature of features) {
        for (const dictionary of [feature.locale, ...(feature.extraLocales ?? [])]) {
          // `mcp` belongs to the upstream manager when it is present; claiming
          // it here is exactly the duplicate registration dsh refuses.
          if (upstream && dictionary.namespace === 'mcp') continue
          ctx.effect(
            () => ctx.locale.register(dictionary.namespace, {
              zh: dictionary.zh,
              en: dictionary.en,
            }),
            `smkit: ${dictionary.namespace}/dictionaries`,
          )
        }
      }
      // Dictionaries first, seats second: a section's own copy must resolve on
      // the very first render the shell makes of it, and a feature that
      // composes another's components (the merged settings section) reads
      // namespaces a later entry would not yet have declared.
      for (const feature of features) {
        feature.register(ctx, deps, ctx.locale.bind(feature.locale.namespace))
      }
    },
    inject,
  }
}

export const { apply } = createPlugin()
