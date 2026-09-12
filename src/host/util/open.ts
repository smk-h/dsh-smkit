/**
 * Open a file with the platform's default association (the same thing the
 * OS file manager's double-click does).
 *
 * DSH's own settings dialog has an "open config file" affordance of this
 * kind, and both config surfaces here follow it: the JSON lands in whatever
 * editor the user associated with `.json`, not in a file-manager window.
 * When nothing is associated, the OS asks — which is still the right outcome
 * for a hand-editable file.
 *
 * The child is detached and unref'd — the opened app outlives the HTTP
 * request, and a lingering child would keep the host process alive. The
 * best-effort contract means a failed spawn is swallowed (the route still
 * answers with the path, so the user can open it by hand). Test suites set
 * `DSH_SMKIT_SKIP_OPEN=1` to keep real windows from popping up.
 */

import { spawn } from 'node:child_process'

export function openPath(filePath: string): void {
  if (process.env.DSH_SMKIT_SKIP_OPEN === '1') return
  try {
    // `explorer <file>` opens with the default handler on Windows (no `cmd`
    // /c start indirection, so no extra quoting layer); `open`/`xdg-open` are
    // the same verb on macOS/Linux.
    const child =
      process.platform === 'win32'
        ? spawn('explorer', [filePath], { detached: true, stdio: 'ignore' })
        : process.platform === 'darwin'
          ? spawn('open', [filePath], { detached: true, stdio: 'ignore' })
          : spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Best-effort: the caller answers with the path regardless.
  }
}
