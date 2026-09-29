/**
 * Putting the settings dialog back after the shell closes it on its own.
 *
 * **The close the user never asked for.** The dialog's open state belongs to
 * the settings shell's own store — the entry
 * `@deepseek-ai/dsh-client-ui-settings-general` registers into DSH's
 * `sidebar.settings` slot. Beside the close paths a dialog normally has (the
 * header button, the mask, Escape) that shell runs a fourth one: its onboarding
 * coordinator follows the sessions store, and the moment the session the main
 * view displays turns absent *or blank* it declares onboarding active — and, if
 * an onboarding step is mounted that has not been completed, closes the dialog
 * outright (`SettingsRoot`'s appearance effect). The step itself may paint
 * nothing — an already-acknowledged welcome notice returns `null` — so all the
 * user sees is the dialog vanishing.
 *
 * That is exactly what deleting the session this browser is viewing does, and
 * no preparation avoids it: the browser's session store drops the row, the
 * workspace clears its main view, and the shell reads `main === undefined`. A
 * replacement session trips the very same close, because a freshly created one
 * is blank by definition and `main.blank` is the other half of the same
 * condition. Deleting any other session leaves the main view alone, which is
 * why only some deletes close the dialog.
 *
 * **The fix reads the shell's own state back — and it must read it in the
 * right order.** Whether the removal can trip the close is only decidable
 * *before* the request: once the removals land, the viewed session's row is
 * gone from the store, so "is the viewed session among them" is no longer
 * readable and a read at commit time finds no main view at all. Hence the two
 * phases: `arm` captures the fact pre-request, `commit` schedules the restore.
 * The restore itself polls briefly — the close is a React effect behind the
 * sessions-store update, so it can land several frames after the answer the
 * delete flow resumes on — and every check is a no-op while the dialog is open,
 * so a needless arm costs nothing.
 *
 * **Two ways back in.** The primary one is the shell's own store handle: it
 * rides the `sidebar.settings` entry on the public slot ledger (`ctx.slots`),
 * and `openSection` is the very call the shell's own nav makes, so the dialog
 * comes back on the section the user was working in. Should that read come up
 * empty — a host that moved the slot, the entry or the handle — a DOM fallback
 * clicks the shell's own trigger (the `aria-haspopup="dialog"` button whose
 * `aria-expanded` follows the dialog) and then this section's nav row, the one
 * `markSettingsNavRow` keeps marked. Both paths degrade to today's behavior —
 * the dialog stays closed and the user reopens it by hand — and every decision
 * leaves one `console.debug` line, so a restore that did not happen says why.
 */

import { SETTINGS_NAV_ATTRIBUTE } from './settings-nav'
import type { ClientContext } from '../types'

/** The slice of the settings shell's store instance this module drives. */
interface SettingsShellInstanceLike {
  getSnapshot?: () => { open?: boolean; activeId?: string | undefined }
  actions?: { openSection?: (sectionId: string) => void }
}

/** The slice of a slot-ledger entry this module reads the shell's handle off. */
interface ShellSlotEntryLike {
  store?: { create?: () => SettingsShellInstanceLike | undefined }
}

/** The slice of the client sessions list this module reads to arm the restore. */
interface SessionListSlice {
  readonly byId?: Readonly<Record<string, {
    readonly retainedBy?: Readonly<Record<string, number | undefined>>
  }>>
}

/** The contract the session-manager page drives the restore through. */
export interface SettingsShellGuard {
  /**
   * Called with the ids a confirmed batch is about to remove, *before* the
   * request — the last moment the viewed session is still readable in the
   * sessions store.
   */
  arm(removingSessionIds: readonly string[]): void
  /**
   * Called with the ids the host actually removed, once the batch settles. A
   * refusal leaves its session in place, so it cannot have moved the view the
   * shell watches.
   */
  commit(removedSessionIds: readonly string[]): void
}

/** The slot the settings shell registers into (declared by DSH's sidebar). */
const SHELL_SLOT = 'sidebar.settings'

/**
 * The nav-row marker's owner value — it must match the string `settings.ts`
 * hands `markSettingsNavRow`, which is also this plugin's own namespace.
 */
const NAV_OWNER = 'smkit'

/**
 * How often the restore re-checks, and how many checks it allows. The close is
 * a React effect behind the sessions-store update, so it can land a frame or
 * two after the HTTP answer the delete flow resumes on; ten 100 ms ticks cover
 * that with room to spare, and stay far short of a close the user makes
 * themselves.
 */
const RESTORE_TICK_MS = 100
const RESTORE_TICKS = 10

/** One decision, visible only to whoever looks for it: `console.debug` is
 * filtered out of the browser's default console view. */
const trace = (message: string): void => {
  if (typeof console === 'undefined') return
  console.debug(`[smkit] settings-shell: ${message}`)
}

/**
 * Build the guard that undoes the shell's own close after a batch delete.
 * @param ctx - the plugin's client context (slot ledger and sessions store).
 * @param sectionId - the settings-section id to re-open the dialog on.
 * @returns The two-phase guard the page arms before a delete and commits after.
 */
export function createSettingsShellRestore(
  ctx: ClientContext,
  sectionId: string,
): SettingsShellGuard {
  let resolved: SettingsShellInstanceLike | undefined
  let armed = false

  /** Resolve the shell's store instance once; a host whose ledger or handle
   * does not match answers undefined and the DOM fallback takes over. */
  const shell = (): SettingsShellInstanceLike | undefined => {
    if (resolved !== undefined) return resolved
    try {
      const entries = ctx.slots.entries?.(SHELL_SLOT) ?? []
      const store = (entries[0] as ShellSlotEntryLike | undefined)?.store
      const instance = typeof store?.create === 'function' ? store.create() : undefined
      if (instance !== undefined) resolved = instance
      else trace(`no store handle on the ${SHELL_SLOT} entry`)
    } catch (error) {
      trace(`ledger read failed: ${String(error)}`)
    }
    return resolved
  }

  const dialogIsUp = (): boolean => {
    if (typeof document === 'undefined') return false
    // The panel carries this attribute; no other surface reuses the name.
    return document.querySelector('[data-shortcut-modal="settings"]') !== null
  }

  /**
   * The DOM fallback: the shell's own trigger flips `aria-expanded` with the
   * dialog, so the closed one is the button to click — the same gesture the
   * user makes, landing on the shell's default section — and this section's
   * nav row (marked by `markSettingsNavRow` once the dialog exists) puts the
   * page back. Returns whether the click was made at all.
   */
  const reopenViaDom = (): boolean => {
    if (typeof document === 'undefined') return false
    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"][aria-expanded="false"]',
    )
    if (trigger === null) {
      trace('dom fallback found no closed settings trigger')
      return false
    }
    trace('dom fallback: clicking the settings trigger')
    trigger.click()
    // The nav row only exists once the dialog does; the marker's own observer
    // runs on that mutation, so one tick later the row is there to click.
    setTimeout(() => {
      document.querySelector<HTMLButtonElement>(`[${SETTINGS_NAV_ATTRIBUTE}="${NAV_OWNER}"]`)?.click()
    }, 0)
    return true
  }

  /** One restore attempt: true when the dialog is up afterwards. */
  const restore = (): boolean => {
    if (dialogIsUp()) return true
    const instance = shell()
    if (instance !== undefined) {
      if (instance.getSnapshot?.()?.open !== false) return true
      try {
        instance.actions?.openSection?.(sectionId)
        trace(`re-opened on "${sectionId}" through the shell store`)
        return true
      } catch (error) {
        trace(`openSection failed: ${String(error)}`)
      }
    }
    return reopenViaDom()
  }

  return {
    arm(removingSessionIds) {
      armed = false
      if (removingSessionIds.length === 0) return
      const byId: SessionListSlice['byId'] = ctx.sessions?.list?.getSnapshot?.()?.byId
      if (byId === undefined) {
        // The list this client keeps is out of reach: arm anyway. A needless
        // restore is a no-op while the dialog is open, while skipping a needed
        // one is the bug this module exists for.
        armed = true
        trace('armed conservatively (sessions list unreadable)')
        return
      }
      for (const [id, row] of Object.entries(byId)) {
        if ((row?.retainedBy?.mainView ?? 0) <= 0) continue
        // The one session the view displays: only its own removal trips the
        // close, and this is the last read that still sees it.
        armed = removingSessionIds.includes(id)
        trace(armed
          ? `armed: the viewed session ${id} is among the removals`
          : `not armed: the viewed session ${id} survives this batch`)
        return
      }
      // No main view at all: onboarding is already active, so no close can
      // *appear* from this delete and there is nothing here to put back.
      trace('not armed: no main view to empty')
    },

    commit(removedSessionIds) {
      if (!armed || removedSessionIds.length === 0) return
      let remaining = RESTORE_TICKS
      const tick = (): void => {
        if (restore()) return
        if ((remaining -= 1) <= 0) {
          trace('gave up: the dialog never came back within the window')
          return
        }
        setTimeout(tick, RESTORE_TICK_MS)
      }
      setTimeout(tick, 0)
    },
  }
}
