/**
 * The CodeMirror surface a file can be shown in, and how to land on a line.
 *
 * The host's document preview is one place a file appears; an editor tab is the
 * other. When an editor plugin (`dsh-better-sidebar`) is loaded, files open in
 * its CodeMirror view and the host preview is never rendered — so anything that
 * decorates "the open file" has to know both surfaces, or it silently loses half
 * its readers.
 *
 * The view is reached the way CodeMirror's own `findFromDOM` reaches it: the
 * content box carries the tile, the tile's root is the doc tile, and the doc
 * tile holds the view. Nothing here imports CodeMirror — the members named below
 * are its public API, and a structurally different object simply fails the
 * `editorViewOf` check.
 */

/** A CodeMirror view, as much of it as this plugin reads. */
export interface EditorViewLike {
  readonly dom: Element
  readonly contentDOM: Element
  readonly scrollDOM: Element & { clientHeight: number; scrollTop: number }
  readonly state: {
    readonly doc: {
      readonly lines: number
      line(number: number): { from: number }
    }
  }
  dispatch(spec: { selection: { anchor: number } }): void
  focus(): void
  lineBlockAt(position: number): { top: number }
  requestMeasure?(): void
}

/** Line numbers: the chat composer has none, and it is not a file. */
const GUTTER = '.cm-lineNumbers'
const CONTENT = '.cm-content'

/**
 * The file editor inside one element, or null.
 *
 * The gutter is the filter, exactly as `line-jump` uses it: a CodeMirror
 * instance without line numbers is the chat composer, where a "line 12" means
 * nothing.
 *
 * @param host - an element that may contain an editor.
 * @returns the view, or null when the element holds no file editor.
 */
export function editorViewOf(host: Element): EditorViewLike | null {
  if (host.querySelector(GUTTER) === null) return null
  const content = host.querySelector(CONTENT) as
    | (Element & { cmTile?: { root?: { view?: EditorViewLike } } })
    | null
  const view = content?.cmTile?.root?.view
  return view === undefined || view === null ? null : view
}

/**
 * Scroll one editor to a line and put the caret there.
 *
 * A collapsed caret rather than a selection: an editor plugin may grow a
 * floating "add to conversation" button over any non-empty selection, and the
 * caret already says where the reader is.
 *
 * @param view - the editor to move.
 * @param line - the 1-based line to reveal.
 */
export function revealEditorLine(view: EditorViewLike, line: number): void {
  const doc = view.state.doc
  const target = Math.min(Math.max(line, 1), doc.lines)
  const start = doc.line(target).from
  view.dispatch({ selection: { anchor: start } })
  view.focus()
  const block = view.lineBlockAt(start)
  view.scrollDOM.scrollTop = Math.max(0, block.top - view.scrollDOM.clientHeight / 3)
  view.requestMeasure?.()
}
