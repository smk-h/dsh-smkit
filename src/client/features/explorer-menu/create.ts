/**
 * The inline editor behind the menu's "new folder" / "new file" rows.
 *
 * Ported from `dsh-better-sidebar` (`src/client/FileTree.tsx`: `startNewFolder`
 * / `commitNewFolder` / `startNewFile` / `commitNewFile` and the two row
 * renderers), with one structural difference that the surface forces:
 *
 * - the reference types the name into a row it inserts at the TOP of that
 *   directory's level, because the tree is its own;
 * - this plugin decorates `ui-sidebar-files`, whose DOM React owns. Injecting a
 *   row into that `ul` would be deleted by the next render of the level (a
 *   watch notice, a reload, the sibling list changing), so the same row floats
 *   instead: a fixed-position card pinned to the directory row's own left edge
 *   and width, one line tall, right under it. It is the same editor to use —
 *   typing, Enter, Escape, click-away, a refusal line under the input — and it
 *   survives the tree re-rendering beneath it.
 *
 * What is kept from the source, deliberately:
 *
 * - a collapsed directory is expanded first, so the new entry lands where the
 *   reader is looking;
 * - Enter and blur both commit; Escape cancels;
 * - the name is one path segment, checked here AND by the host (the host also
 *   knows the Windows rules a name must survive);
 * - a refusal keeps the editor open with the reason under the input, so a typo
 *   costs no reopening;
 * - an empty name cancels silently (the source reported it as invalid, which
 *   turned "click away" into an error).
 */

import type { ApiFn, Translator } from '../../platform/types'
import type { IconSpec } from '../../platform/icons/Icon'
import { NEW_FILE_ICON } from './icons/NewFileIcon'
import { PLUS_ICON } from './icons/PlusIcon'

/** Which of the two rows opened the editor. */
export type CreateKind = 'file' | 'folder'

/** The shell's per-extension glyph, as the editor needs it. */
export interface CreateTypeIcon {
  /** The React factory the bundle threads in as `h`. */
  h: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => unknown
  /** The shell's file-type glyph. */
  FileTypeIcon: (props: { kind: string; size: number }) => unknown
  /** The shell's name → glyph classifier. */
  classifyFileType: (name: string) => string
  /** A React root, for the glyph slot the editor owns. */
  createRoot: (container: Element) => { render(node: unknown): void; unmount(): void }
}

/** This feature's markers on the floating row. */
const ROW_ATTR = 'data-smkit-explorer-new-row'
const KIND_ATTR = 'data-smkit-explorer-new-kind'
const INVALID_ATTR = 'data-smkit-explorer-new-invalid'
const ROW_CLASS = 'smkit-explorer-new-row'
const ICON_CLASS = 'smkit-explorer-new-row-icon'
const INPUT_CLASS = 'smkit-explorer-new-row-input'
const ERROR_CLASS = 'smkit-explorer-new-row-error'

/** The editor row's height, in pixels — the source's `explorerRow` height. */
const CARD_HEIGHT = 28

/** The refusal line's height: 11px text, one line, 2px above and 2px below. */
const ERROR_HEIGHT = 20

/** Characters Windows refuses in a name (control characters included). */
const ILLEGAL_NAME_CHARS = /[<>:"|?*\u0000-\u001f]/

/** The longest name Windows stores. */
const MAX_NAME_LENGTH = 255

/**
 * Whether one typed name is creatable, as far as its SHAPE goes.
 *
 * The client-side twin of the host's rule (`host/features/explorer-ops/fs.ts`),
 * kept here so an obviously broken name never costs a round trip; the host
 * re-checks, and it is the one that knows the platform.
 * @param name - the trimmed name.
 * @returns whether it is one storable path segment.
 */
export function isCreatableName(name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false
  if (name.includes('/') || name.includes('\\')) return false
  if (name.length > MAX_NAME_LENGTH) return false
  return !ILLEGAL_NAME_CHARS.test(name)
}

/** What the editor needs from the caller. */
export interface CreateEditorOptions {
  /** Same-origin JSON channel to `/smkit/api`. */
  api: ApiFn
  /** The feature's translator (`explorer` namespace). */
  t: Translator
  kind: CreateKind
  /** Absolute path of the directory row the menu was opened on. */
  dir: string
  /** That row's element: expanded when collapsed, and the editor's anchor. */
  row: Element
  /**
   * The shell's file-type glyph, so the new-FILE editor shows the glyph of the
   * name being typed (the source's `service.fileIcon(probe, 14)`). Optional: an
   * older shell without it keeps this feature's own generic glyph.
   */
  typeIcon?: CreateTypeIcon
}

/** One open editor: close it (the menu opens at most one at a time). */
export interface CreateEditorHandle {
  close(): void
}

/** The `<svg>` shell around one glyph, as plain DOM (the Menu path is React). */
function iconElement(spec: IconSpec): Element {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('width', String(spec.size ?? 16))
  svg.setAttribute('height', String(spec.size ?? 16))
  svg.setAttribute('viewBox', spec.viewBox)
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke-width', '1')
  svg.setAttribute('aria-hidden', 'true')
  for (const node of spec.nodes) {
    const child = document.createElementNS(NS, node.tag)
    for (const [name, value] of Object.entries(node.attrs)) child.setAttribute(name, String(value))
    svg.appendChild(child)
  }
  return svg
}

/**
 * Open the inline editor under one directory row.
 *
 * The caller owns the single-editor rule: it closes the previous handle before
 * opening the next, and closes this one with the effect's disposer.
 * @param options - the channel, the copy, which row, and the directory.
 * @returns the handle whose `close()` dismisses the editor without creating.
 */
export function openCreateEditor(options: CreateEditorOptions): CreateEditorHandle {
  const { api, t, kind, dir } = options
  const row = options.row
  const anchor = (row.querySelector(':scope > button') ?? row) as HTMLElement

  // The source expands the directory first, so the new row is visible in the
  // level it belongs to. The shell's row button is the toggle.
  if (row.getAttribute('data-files-entry') === 'directory' && row.querySelector(':scope > ul') === null) {
    anchor.click()
  }

  /** Settled: committed, cancelled, or dismissed — nothing may run afterwards. */
  let settled = false
  /** A request is in flight; Enter and blur must not send a second one. */
  let pending = false

  const editor = document.createElement('div')
  editor.className = ROW_CLASS
  editor.setAttribute(ROW_ATTR, '')
  editor.setAttribute(KIND_ATTR, kind)

  const typeIcon = options.typeIcon
  const icon = document.createElement('span')
  icon.className = ICON_CLASS

  /** Repaint the glyph slot with the typed name's own file type, when seeded. */
  let iconRoot: { render(node: unknown): void; unmount(): void } | null = null
  const paintIcon = (name: string): void => {
    if (kind !== 'file' || typeIcon === undefined) return
    // The source probes `untitled` while the field is still empty, so the slot
    // shows the generic file glyph rather than nothing.
    const probe = name.trim() === '' ? 'untitled' : name.trim()
    const node = typeIcon.h(typeIcon.FileTypeIcon, { kind: typeIcon.classifyFileType(probe), size: 14 })
    if (iconRoot === null) iconRoot = typeIcon.createRoot(icon)
    iconRoot.render(node)
  }
  if (kind === 'file' && typeIcon !== undefined) paintIcon('')
  else icon.appendChild(iconElement(kind === 'folder' ? PLUS_ICON : NEW_FILE_ICON))

  const input = document.createElement('input')
  input.className = INPUT_CLASS
  input.setAttribute('type', 'text')
  input.setAttribute('spellcheck', 'false')
  input.setAttribute('autocomplete', 'off')
  input.setAttribute('placeholder', t(kind === 'folder' ? 'newFolderPlaceholder' : 'newFilePlaceholder'))
  input.setAttribute('aria-label', t(kind === 'folder' ? 'newFolder' : 'newFile'))

  const error = document.createElement('span')
  error.className = ERROR_CLASS

  editor.appendChild(icon)
  editor.appendChild(input)
  editor.appendChild(error)
  document.body.appendChild(editor)

  /** The viewport, where `resize` actually fires (guarded for the Node harness). */
  const viewport = typeof window === 'undefined' ? undefined : window

  /**
   * The directory's children list, borrowed for the editor's height.
   *
   * The source INSERTS a row at the top of that level, so its children move
   * down by one row. This plugin cannot insert into a list React owns, so it
   * takes the same one row out of the list as padding while the editor is open
   * — the card lands in a gap instead of covering the first entry — and puts
   * the list back exactly as it was on close.
   */
  let list: HTMLElement | null = null
  let listPadding = ''
  /** The gap the list has to give up: the card, plus the refusal line when shown. */
  let reserve = CARD_HEIGHT

  const releaseList = (): void => {
    if (list === null) return
    list.style.paddingTop = listPadding
    list = null
  }

  /** Take (or re-take) the card's height from the children list. */
  const reserveList = (): void => {
    const next = row.querySelector(':scope > ul')
    if (next === null || !(next instanceof Element)) return
    const element = next as HTMLElement
    if (element !== list) {
      releaseList()
      list = element
      listPadding = element.style.paddingTop
    }
    const padding = `${reserve}px`
    if (list.style.paddingTop !== padding) list.style.paddingTop = padding
  }

  /** Pin the card into the gap, at the level's own indent; also on scroll and resize. */
  const reposition = (): void => {
    if (!anchor.isConnected) {
      close()
      return
    }
    reserveList()
    const rect = anchor.getBoundingClientRect()
    // The card belongs to the level INSIDE the row, so it starts where that
    // level's rows start — the list's padding, which is the shell's indent.
    const indent = list === null || typeof getComputedStyle !== 'function'
      ? 0
      : Number.parseFloat(getComputedStyle(list).paddingLeft) || 0
    editor.style.left = `${rect.left + indent}px`
    editor.style.top = `${rect.bottom}px`
    editor.style.width = `${Math.max(rect.width - indent, 0)}px`
  }

  // The children list of a just-expanded directory arrives after the click, and
  // the shell may replace it on any re-render; both are why this watches.
  const watcher = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => { reposition() })
  watcher?.observe(row, { childList: true })
  reposition()

  /** Close without creating anything. Idempotent. */
  function close(): void {
    if (settled) return
    settled = true
    watcher?.disconnect()
    releaseList()
    iconRoot?.unmount()
    document.removeEventListener('scroll', reposition, true)
    viewport?.removeEventListener?.('resize', reposition)
    editor.remove()
  }

  /** Keep the editor open and say why the name was refused. */
  const fail = (message: string): void => {
    error.textContent = message
    editor.setAttribute(INVALID_ATTR, '')
    // The refusal line needs its own gap, or it would sit on the first entry.
    reserve = CARD_HEIGHT + ERROR_HEIGHT
    reserveList()
    input.focus()
  }

  /** The source's two shape sentences, one per editor kind. */
  const invalidMessage = (): string => t(kind === 'folder' ? 'folderNameInvalid' : 'fileNameInvalid')

  /** The host's own sentence when it has one, else the generic fallback. */
  const hostMessage = (body: Record<string, any>): string =>
    typeof body.error === 'string' && body.error !== '' ? body.error : t('createFailed')

  /** Send the name, or say why it cannot be sent. */
  const commit = (): void => {
    if (settled || pending) return
    const name = input.value.trim()
    if (name === '') {
      close()
      return
    }
    if (!isCreatableName(name)) {
      fail(invalidMessage())
      return
    }
    pending = true
    api(`/explorer/create-${kind}`, {
      method: 'POST',
      body: JSON.stringify({ path: dir, name }),
    }).then((result) => {
      pending = false
      if (settled) return
      if (result.ok) {
        close()
        return
      }
      const code = result.body.code
      if (code === 'explorer/exists') {
        // The reference pre-checks a file name against the level it lists and
        // says so itself; a FOLDER duplicate there falls through to the host's
        // raw sentence — the same split is kept here.
        fail(kind === 'file' ? t('fileNameExists') : hostMessage(result.body))
      } else if (code === 'explorer/invalid-name') {
        fail(invalidMessage())
      } else {
        fail(hostMessage(result.body))
      }
    }).catch(() => {
      pending = false
      if (!settled) fail(t('createFailed'))
    })
  }

  // The glyph follows the typed extension, as the source's row does.
  input.addEventListener('input', () => { paintIcon(input.value) })
  input.addEventListener('keydown', (event: KeyboardEvent) => {
    // `isComposing` is the standard signal; 229 is what the IMEs that do not
    // set it report — the same pair the source's `isLikelyImeKey` tests.
    if (event.isComposing === true || event.keyCode === 229) return
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  })
  // The source commits on blur; so does this, which is also what makes "click
  // somewhere else" behave like Enter rather than like a silent discard.
  input.addEventListener('blur', () => { commit() })
  document.addEventListener('scroll', reposition, true)
  viewport?.addEventListener?.('resize', reposition)
  input.focus()

  return { close }
}
