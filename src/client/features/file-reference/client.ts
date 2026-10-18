/**
 * The file-reference feature: an `@file` chip on the shell's explorer rows.
 *
 * This is the one affordance in this plugin that lives on a surface the plugin
 * does not own. It rides the host's file tree (`ui-sidebar-files`) instead of
 * replacing it, and it yields to anyone who already provides the same thing —
 * `dsh-better-sidebar` owns the `files` page while its editor type is enabled
 * and gives every row exactly this chip, so only one of the two may be active.
 * When that type is switched off the plugin hands the page back to the shell
 * and this feature takes the seat. That decision is made by the watcher (see
 * `watch.ts`) and published here as `smkitFileReference`, so a cooperating
 * plugin can yield in the other direction.
 */

import { FILE_REFERENCE_LOCALE_EN } from './i18n/en'
import { FILE_REFERENCE_LOCALE_ZH } from './i18n/zh'
import { FILE_REFERENCE_CSS } from './styles'
import { watchFileReferences } from './watch'
import type { FileReferenceStatus } from './watch'
import type { ClientContext, ClientDeps, ClientFeature } from '../../platform/types'

/** The service name this feature publishes its decision under. */
export const FILE_REFERENCE_SERVICE = 'smkitFileReference'

export const fileReferenceFeature: ClientFeature = {
  id: 'file-reference',
  locale: {
    namespace: 'file-reference',
    zh: FILE_REFERENCE_LOCALE_ZH,
    en: FILE_REFERENCE_LOCALE_EN,
  },
  styles: [{ name: 'ref', css: FILE_REFERENCE_CSS }],

  register(ctx: ClientContext, _deps: ClientDeps, t): void {
    // The decision record outlives the effect body: the published service has
    // to answer after teardown too, and a getter is what keeps it current.
    const status: FileReferenceStatus = { active: false, reason: 'no-dom' }
    try {
      ctx.provide?.(FILE_REFERENCE_SERVICE, {
        get active() { return status.active },
        get reason() { return status.reason },
      })
    } catch {
      // Cordis throws on a second registration of one name. Losing the handle
      // costs other plugins the read; letting it throw costs the whole entry.
    }
    ctx.effect(
      () => watchFileReferences(ctx, status, t),
      'smkit: file-reference/explorer',
    )
  },
}
