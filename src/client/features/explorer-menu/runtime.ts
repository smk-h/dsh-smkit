/**
 * The host modules the explorer menu cannot work without, resolved once.
 *
 * Two halves use them: the drawn menu (`menu.ts`) needs the shell's `Menu`
 * component itself, while the rows — whichever door opens them — need a React
 * root (the inline editor and the confirmation), the shell's clipboard write,
 * and the per-extension glyph the editor shows. A host that seeds none of them
 * keeps the browser's own right-click behaviour, and every path that would need
 * one stands down instead of failing the client entry.
 */

/** The React factory the client bundle threads in as `h`. */
export type ElementFactory = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => unknown

/** The modules both doors share. */
export interface ExplorerRuntime {
  /** The shell's clipboard write (async API, `execCommand` fallback). */
  writeClipboard: (text: string) => Promise<boolean>
  /** React root for the inline editor and the confirmation. */
  createRoot: (container: Element) => { render(node: unknown): void; unmount(): void }
  /**
   * The shell's per-extension glyph and classifier — optional, because an older
   * shell may not seed them; the editor then keeps its own generic glyph.
   */
  FileTypeIcon?: (props: { kind: string; size: number }) => unknown
  classifyFileType?: (name: string) => string
}

/** Plus the one module only the drawn menu needs. */
export interface MenuRuntime extends ExplorerRuntime {
  /** The shell's menu card/rows/keyboard, exactly as the source uses it. */
  Menu: (props: Record<string, unknown>) => unknown
}

/**
 * Resolve the host modules, once per caller.
 * @param h - the React factory from the client deps.
 * @returns the runtime, or undefined when this host cannot draw or copy.
 */
export function loadRuntime(h: unknown): MenuRuntime | undefined {
  if (typeof h !== 'function') return undefined
  try {
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives') as {
      Menu?: unknown
      writeClipboard?: unknown
      FileTypeIcon?: unknown
      classifyFileType?: unknown
    }
    const client = require('react-dom/client') as { createRoot?: unknown }
    if (typeof primitives.Menu !== 'function') return undefined
    if (typeof primitives.writeClipboard !== 'function') return undefined
    if (typeof client.createRoot !== 'function') return undefined
    return {
      Menu: primitives.Menu as MenuRuntime['Menu'],
      writeClipboard: primitives.writeClipboard as MenuRuntime['writeClipboard'],
      createRoot: client.createRoot as MenuRuntime['createRoot'],
      FileTypeIcon: typeof primitives.FileTypeIcon === 'function'
        ? primitives.FileTypeIcon as MenuRuntime['FileTypeIcon']
        : undefined,
      classifyFileType: typeof primitives.classifyFileType === 'function'
        ? primitives.classifyFileType as MenuRuntime['classifyFileType']
        : undefined,
    }
  } catch {
    // An older shell may not seed one of them; the tree then keeps the host's
    // default right-click behaviour instead of this feature failing the bundle.
    return undefined
  }
}
