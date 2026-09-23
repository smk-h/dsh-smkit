/**
 * What applying a skin is: one body attribute.
 *
 * The ported stylesheets scope every rule on `body[data-dsh-<id>]` (dark mode
 * on the same attribute plus the shell's own `data-ds-dark-theme`), so the
 * applier's whole job is to keep exactly the chosen skin's attribute on the
 * body — the CSS itself rides in the bundle (see `styles.ts`) and is always
 * present, the way a dsh-themes skin package works. Day/night costs nothing
 * here: the shell's display-mode toggle flips the attribute the dark block
 * scopes on, and both modes of the applied skin follow.
 *
 * The choice persists under `smkit:skin` — a key under this plugin's own
 * prefix, which is exactly what the local-cache tab promises to leave alone.
 * Storage sits behind try/catch because a private-mode browser throws on any
 * access, and a skin that cannot persist should still apply for the session.
 *
 * `registerThemeSkin` runs at plugin mount, not when the settings panel opens:
 * the panel is one tab inside a dialog the user visits twice a month, while
 * the skin has to be on the body the whole time.
 */

import type { ClientContext } from '../../platform/types'
import { SKINS } from './skins'

/** The key the last choice persists under, inside this plugin's namespace. */
const STORAGE_KEY = 'smkit:skin'

/** The persisted choice, or null when nothing (or something unknown) is stored. */
export function currentSkinId(): string | null {
  try {
    const id = localStorage.getItem(STORAGE_KEY)
    return id !== null && SKINS.some((skin) => skin.id === id) ? id : null
  } catch {
    return null
  }
}

/** Put the chosen skin's attribute on the body; null clears every skin this
 * feature ships, so switching can never leave a predecessor's scope behind.
 * The guard covers the Node test harnesses too: some stub a `document` whose
 * body carries no `dataset` map, and the skin has nothing to paint on there. */
export function paintSkinAttribute(id: string | null): void {
  const dataset = typeof document === 'undefined' ? undefined : document.body?.dataset
  if (dataset === undefined) return
  for (const skin of SKINS) delete dataset[skin.dataset]
  if (id !== null) {
    const skin = SKINS.find((candidate) => candidate.id === id)
    if (skin) dataset[skin.dataset] = ''
  }
}

/** Persist the choice; a denied storage keeps the session's paint. */
export function saveSkinChoice(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Private-mode browsers throw on any storage access.
  }
}

/** Apply one skin: paint now, remember for the next reload. */
export function applySkin(id: string): void {
  paintSkinAttribute(id)
  saveSkinChoice(id)
}

/** Back to no skin: clear the paint and the memory together. */
export function clearSkin(): void {
  paintSkinAttribute(null)
  saveSkinChoice(null)
}

/** Mount-time half of the feature: restore whatever this browser last chose,
 * and take the attribute back off when the plugin unloads, so the hot-reload
 * contract (everything apply() writes, dispose() retracts) holds for skins too. */
export function registerThemeSkin(ctx: ClientContext): void {
  ctx.effect(
    () => {
      paintSkinAttribute(currentSkinId())
      return () => paintSkinAttribute(null)
    },
    'dsh-mcp-manager: theme/skin attribute',
  )
}
