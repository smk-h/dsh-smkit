/**
 * The confirmation the menu's "delete" row opens.
 *
 * Ported from `dsh-better-sidebar` (`src/client/FileTree.tsx`: `confirmDelete` +
 * `performDelete`), which asks first because the removal is permanent — there is
 * no trash behind it — and says in the body what exactly is going:
 *
 * - the title names the entry (`deleteTitle`, interpolated with its name);
 * - the file wording, or the directory wording that promises the contents go
 *   with it (`deleteDescFile` / `deleteDescDir`);
 * - the confirm button in the danger style.
 *
 * The dialog itself is this plugin's shared confirm (`platform/ui/ConfirmDialog`,
 * the one session delete uses) rather than the reference's private kit, so the
 * two destructive confirmations in this plugin look the same. The reference
 * closes the dialog before the request and reports failures in the tree's error
 * strip; this one keeps the dialog open with the failure inside it, because that
 * strip is not something this plugin has.
 */

import type { ClientDeps, Translator } from '../../platform/types'
import { createConfirmDialog } from '../../platform/ui/ConfirmDialog'

/** What the dialog needs from the caller. */
export interface DeleteDialogOptions {
  /** The platform deps (the dialog reads `h` and its two button labels). */
  deps: ClientDeps
  /** A React root factory, as the menu host uses. */
  createRoot: (container: Element) => { render(node: unknown): void; unmount(): void }
  /** The feature's translator (`explorer` namespace). */
  t: Translator
  /** Absolute path of the entry. */
  path: string
  /** The entry's own name, for the title. */
  name: string
  /** Whether the entry is a directory (the body says its contents go too). */
  isDir: boolean
}

/** One open confirmation: close it (nothing was deleted). */
export interface DeleteDialogHandle {
  close(): void
}

/**
 * Ask, then remove.
 *
 * The caller owns the single-dialog rule and closes this handle with the
 * effect's disposer.
 * @param options - the channel, the copy, and the target.
 * @returns the handle whose `close()` dismisses the dialog without deleting.
 */
export function openDeleteDialog(options: DeleteDialogOptions): DeleteDialogHandle {
  const { deps, createRoot, t, path, name, isDir } = options
  const ConfirmDialog = createConfirmDialog(deps)

  const host = document.createElement('div')
  host.setAttribute('data-smkit-explorer-confirm', '')
  document.body.appendChild(host)
  const root = createRoot(host)

  let busy = false
  let failure: string | undefined
  let settled = false

  /** Dismiss, deleting nothing. Idempotent. */
  const close = (): void => {
    if (settled) return
    settled = true
    root.unmount()
    host.remove()
  }

  /** Paint the dialog for the current state. */
  const draw = (): void => {
    root.render(deps.h(ConfirmDialog, {
      title: t('deleteTitle', { name }),
      body: t(isDir ? 'deleteDescDir' : 'deleteDescFile'),
      busy,
      ...(failure === undefined ? {} : { error: failure }),
      onCancel: () => { if (!busy) close() },
      onConfirm: () => { confirm() },
    }))
  }

  /** Run the removal, keeping the dialog up until it settles. */
  const confirm = (): void => {
    if (busy || settled) return
    busy = true
    failure = undefined
    draw()
    deps.api('/explorer/delete', { method: 'POST', body: JSON.stringify({ path }) }).then((result) => {
      if (settled) return
      busy = false
      if (result.ok) {
        close()
        return
      }
      failure = typeof result.body.error === 'string' && result.body.error !== ''
        ? result.body.error
        : t('deleteFailed')
      draw()
    }).catch(() => {
      if (settled) return
      busy = false
      failure = t('deleteFailed')
      draw()
    })
  }

  draw()
  return { close }
}
