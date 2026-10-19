/**
 * The inline editor behind three of the menu's rows: new folder, new file, and
 * rename.
 *
 * Ported from `dsh-better-sidebar` (`src/client/FileTree.tsx`: `renderNewFolderRow`
 * / `renderNewFileRow` / `renderRenameRow` and their commits), with the one
 * structural difference the surface forces:
 *
 * - the reference inserts those rows into its own tree, where each is an
 *   ordinary React child of the level: it takes its place in the flow, pushes
 *   the siblings down (create) or replaces the row it edits (rename), and
 *   scrolls with them;
 * - this plugin decorates `ui-sidebar-files`, whose level `ul` React renders,
 *   and an injected row there is a foreign node React never adopted:
 *
 *   - the level is a fragment of `li`s keyed by name, swapped as a whole when
 *     it moves between its loading note and its entries, and the `ul` itself is
 *     unmounted when the directory collapses or the tab remounts — an injected
 *     row disappears with the subtree that carried it, mid-typing included;
 *   - being unkeyed, it never takes part in that reconciliation: a watch
 *     refresh that inserts or reorders entries anchors `insertBefore` on the
 *     host's own rows, so the injected row can end up at the wrong index;
 *   - the tree's own semantics (row hover, selection, keyboard walking, drop
 *     targets) apply to the rows the shell renders, not to the ones beside them;
 *   - and its styles could only ever be ours — the host's row classes are
 *     CSS-modules hashes this plugin cannot address.
 *
 *   So the same row floats instead, at the same measurements (`CARD_HEIGHT`, the
 *   same font, the same input box):
 *
 *   - create: in the gap under the directory row, at that level's indent and
 *     width — the level lends the height as padding while the editor is open, so
 *     the children are pushed down rather than covered. The tree's ROOT is the
 *     one directory without a row: that create takes the header row's box and
 *     borrows the listing's top level instead (see `anchor` / `list`);
 *   - rename: over the row it edits, at that row's own box — the same row the
 *     source's editor replaces in place.
 *
 * What is kept from the source, deliberately:
 *
 * - Enter and blur both commit; Escape cancels; composition keys never commit;
 * - a create on a collapsed directory expands it first;
 * - a rename pre-fills the current name and selects all of it;
 * - an unchanged name is a silent no-op, an empty name cancels silently;
 * - a refusal keeps the editor open with the reason under the input, so a typo
 *   costs no reopening.
 */

import type { ApiFn, Translator } from '../../platform/types'
import type { IconSpec } from '../../platform/icons/Icon'
import { NEW_FILE_ICON } from './icons/NewFileIcon'
import { PLUS_ICON } from './icons/PlusIcon'
import { baseName, parentOf } from './paths'

/** Which row opened the editor. */
export type RowEditorMode = 'create' | 'rename'

/** Which glyph the editor's kind implies (a folder has none of its own). */
export type RowEditorKind = 'file' | 'folder'

/** The shell's per-extension glyph, as the editor needs it. */
export interface RowEditorTypeIcon {
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
const MODE_ATTR = 'data-smkit-explorer-editor-mode'
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
 * The client-side twin of the host's create rule
 * (`host/features/explorer-ops/fs.ts`), kept here so an obviously broken name
 * never costs a round trip; the host re-checks, and it is the one that knows
 * the platform.
 * @param name - the trimmed name.
 * @returns whether it is one storable path segment.
 */
export function isCreatableName(name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false
  if (name.includes('/') || name.includes('\\')) return false
  if (name.length > MAX_NAME_LENGTH) return false
  return !ILLEGAL_NAME_CHARS.test(name)
}

/**
 * Whether one typed name is usable as a RENAME, by the source's own rule
 * (`validName`): non-empty, not a dot entry, no separators. The stricter
 * Windows rules are the host's to apply, exactly as they were that plugin's.
 * @param name - the trimmed name.
 * @returns whether the rename can be sent.
 */
export function isRenameableName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')
}

/** What the editor needs from the caller. */
export interface RowEditorOptions {
  /** Same-origin JSON channel to `/smkit/api`. */
  api: ApiFn
  /** The feature's translator (`explorer` namespace). */
  t: Translator
  mode: RowEditorMode
  /** The glyph the row wears (a folder's own, or a file's by extension). */
  kind: RowEditorKind
  /**
   * create: absolute path of the directory the row names.
   * rename: absolute path of the entry being renamed.
   */
  path: string
  /** Just the entry's own name, for the menu row and the card's glyph. */
  name: string
  /** That row's element: expanded when collapsed, and the editor's anchor. */
  row: Element
  /**
   * The box the editor aligns to, when that is not the row's own button.
   *
   * A create at the tree's root passes the header row instead: the root has no
   * row of its own, and the entry it creates lands at the top of the listing,
   * immediately under that header.
   */
  anchor?: Element
  /**
   * The level list the editor takes its one row of height from. Defaults to the
   * row's own child list; a create at the root borrows the listing's top level,
   * which belongs to the tree body rather than to any row. Resolved on every
   * reposition, because a refresh replaces the list.
   */
  list?: () => Element | null
  /**
   * The shell's file-type glyph, so the editor shows the glyph of the name it
   * holds (the source's `fileIcon(probe, 14)`). Optional: an older shell
   * without it keeps this feature's own generic glyph.
   */
  typeIcon?: RowEditorTypeIcon
}

/** One open editor: close it (the menu opens at most one at a time). */
export interface RowEditorHandle {
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
 * Open the inline editor for one menu row.
 *
 * The caller owns the single-editor rule: it closes the previous handle before
 * opening the next, and closes this one with the effect's disposer.
 * @param options - the channel, the copy, which row, and the target.
 * @returns the handle whose `close()` dismisses the editor without committing.
 */
export function openRowEditor(options: RowEditorOptions): RowEditorHandle {
  const { api, t, kind, row } = options
  const renaming = options.mode === 'rename'
  const anchor = (options.anchor ?? row.querySelector(':scope > button') ?? row) as HTMLElement

  /** The directory a creation lands in, and the directory the editor indents to. */
  const directory = renaming ? parentOf(options.path) : options.path
  /** The name the field starts with: '' for a creation, the entry's for a rename. */
  const current = renaming ? (options.name === '' ? baseName(options.path) : options.name) : ''

  // The source expands the directory first, so the new row is visible in the
  // level it belongs to. The shell's row button is the toggle. A rename edits a
  // row that is already on screen, so it never toggles anything.
  if (!renaming && row.getAttribute('data-files-entry') === 'directory' && row.querySelector(':scope > ul') === null) {
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
  editor.setAttribute(MODE_ATTR, options.mode)

  const typeIcon = options.typeIcon
  const icon = document.createElement('span')
  icon.className = ICON_CLASS

  /** Repaint the glyph slot with the name's own file type, when seeded. */
  let iconRoot: { render(node: unknown): void; unmount(): void } | null = null
  const paintIcon = (value: string): void => {
    if (typeIcon === undefined) return
    const typed = value.trim()
    // The source probes `untitled` while a creation's field is empty, so the
    // slot shows the generic file glyph rather than nothing.
    const probe = typed === '' ? (renaming ? current : 'untitled') : typed
    const glyphKind = kind === 'folder' ? 'folder' : typeIcon.classifyFileType(probe)
    const node = typeIcon.h(typeIcon.FileTypeIcon, { kind: glyphKind, size: 14 })
    if (iconRoot === null) iconRoot = typeIcon.createRoot(icon)
    iconRoot.render(node)
  }
  if (typeIcon === undefined) {
    icon.appendChild(iconElement(kind === 'folder' ? PLUS_ICON : NEW_FILE_ICON))
  } else {
    paintIcon(current)
  }

  const input = document.createElement('input')
  input.className = INPUT_CLASS
  input.setAttribute('type', 'text')
  input.setAttribute('spellcheck', 'false')
  input.setAttribute('autocomplete', 'off')
  if (renaming) {
    input.setAttribute('aria-label', t('rename'))
    input.value = current
  } else {
    input.setAttribute('placeholder', t(kind === 'folder' ? 'newFolderPlaceholder' : 'newFilePlaceholder'))
    input.setAttribute('aria-label', t(kind === 'folder' ? 'newFolder' : 'newFile'))
  }

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
   * The source's creation row is inserted at the top of that level, so the
   * children move down by one row. This plugin cannot insert into a list React
   * owns, so it takes the same one row out of the list as padding while the
   * editor is open — the card lands in a gap instead of covering the first
   * entry — and puts the list back exactly as it was on close. A rename has no
   * list to borrow from: it sits over the row it edits.
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
    if (renaming) return
    const next = options.list === undefined ? row.querySelector(':scope > ul') : options.list()
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

  /** Pin the card: into the gap for a creation, over the row for a rename. */
  const reposition = (): void => {
    if (!anchor.isConnected) {
      close()
      return
    }
    reserveList()
    const rect = anchor.getBoundingClientRect()
    if (renaming) {
      editor.style.left = `${rect.left}px`
      editor.style.top = `${rect.top}px`
      editor.style.width = `${rect.width}px`
      return
    }
    // A creation belongs to the level INSIDE the row, so it starts where that
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

  /** Close without committing anything. Idempotent. */
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
    // The refusal line needs its own gap, or it would sit on the next entry.
    reserve = CARD_HEIGHT + ERROR_HEIGHT
    reserveList()
    input.focus()
  }

  /** The source's two shape sentences, one per editor kind. */
  const invalidMessage = (): string => t(kind === 'folder' ? 'folderNameInvalid' : 'fileNameInvalid')

  /** The host's own sentence when it has one, else the caller's fallback. */
  const hostMessage = (body: Record<string, any>, fallback: string): string =>
    typeof body.error === 'string' && body.error !== '' ? body.error : t(fallback)

  /** Send the name, or say why it cannot be sent. */
  const commit = (): void => {
    if (settled || pending) return
    const name = input.value.trim()
    if (name === '') {
      close()
      return
    }
    if (renaming) {
      // The source treats an unchanged name as a no-op rather than a request.
      if (name === current) {
        close()
        return
      }
      if (!isRenameableName(name)) {
        fail(t('renameInvalid'))
        return
      }
    } else if (!isCreatableName(name)) {
      fail(invalidMessage())
      return
    }

    pending = true
    const request = renaming
      ? api('/explorer/rename', { method: 'POST', body: JSON.stringify({ path: options.path, name }) })
      : api(`/explorer/create-${kind}`, { method: 'POST', body: JSON.stringify({ path: directory, name }) })
    request.then((result) => {
      pending = false
      if (settled) return
      if (result.ok) {
        close()
        return
      }
      const code = result.body.code
      if (renaming) {
        // The source reports the rename's failure with the host's own words.
        fail(hostMessage(result.body, 'renameFailed'))
        return
      }
      if (code === 'explorer/exists') {
        // The reference pre-checks a file name against the level it lists and
        // says so itself; a FOLDER duplicate there falls through to the host's
        // raw sentence — the same split is kept here.
        fail(kind === 'file' ? t('fileNameExists') : hostMessage(result.body, 'createFailed'))
      } else if (code === 'explorer/invalid-name') {
        fail(invalidMessage())
      } else {
        fail(hostMessage(result.body, 'createFailed'))
      }
    }).catch(() => {
      pending = false
      if (!settled) fail(t(renaming ? 'renameFailed' : 'createFailed'))
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
  // A rename opens with the whole name selected, as the source's ref does.
  if (renaming && typeof input.select === 'function') input.select()

  return { close }
}
