/**
 * The Windows toast, fired from the host process.
 *
 * One `powershell.exe` child per notification does both halves: it shows a
 * WinRT toast (silent — the sound is ours, not the OS default) and then plays
 * the mp3 through MCI, waiting so the child does not outlive its playback.
 * The script travels as `-EncodedCommand` (UTF-16LE base64) because the copy
 * is Chinese and a bare `-Command` argument is one codepage away from the
 * parser error the ASCII-only test caught on the first try.
 *
 * Toast text is XML-escaped here and PowerShell-quoted here too, so no title
 * or body can break out of either layer. Failures are logged, never thrown:
 * a notification that could not show must not turn into an agent error.
 *
 * Clicking the toast opens `launchUrl` in the default browser — the closest
 * a protocol launch gets to ZCode's click-to-focus, and `launchUrl` is the
 * origin the web page itself last reported (via its heartbeat), so it always
 * points at where dsh is actually served.
 */

import { spawn } from 'node:child_process'
import { POWERSHELL_TIMEOUT_MS, TOAST_AUMID } from './constants.js'
import type { NotifyDuration } from './types.js'
import type { LoggerLike } from '../../platform/types.js'

const LOG_PREFIX = 'smkit notify:'

/** What one toast carries. `soundFile` null keeps the toast silent. */
export interface ToastOptions {
  title: string
  body?: string
  soundFile?: string | null
  /** Origin the toast's click opens; omitted when nothing was reported yet. */
  launchUrl?: string
  /** How long the toast stays: default `short` (~5 s), `long` (~25 s), or
   * `reminder` (pinned until dismissed — see the shared contract). */
  duration?: NotifyDuration
}

/** Escape the five XML characters for toast text and attribute values. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Escape one value into a single-quoted PowerShell literal. */
function psQuote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

/**
 * Build the PowerShell script: show the toast, then play the sound if one was
 * given. Everything is ASCII except the escaped copy riding inside the XML —
 * which is exactly what `-EncodedCommand` is for.
 *
 * The duration maps onto the toast XML's own vocabulary: `long` sets
 * `duration="long"`; `reminder` sets `scenario="reminder"` and must bring at
 * least one action button or Windows silently downgrades the toast to a
 * normal one — so a dismiss button is always attached there (plus the
 * protocol button when an origin is known).
 */
export function buildToastScript(options: ToastOptions): string {
  const attrs: string[] = []
  if (options.launchUrl) attrs.push(`activationType="protocol" launch="${escapeXml(options.launchUrl)}"`)
  if (options.duration === 'long') attrs.push('duration="long"')
  if (options.duration === 'reminder') attrs.push('scenario="reminder"')
  const rootAttrs = attrs.length === 0 ? '' : ` ${attrs.join(' ')}`

  const lines = [
    options.title,
    ...(options.body === undefined ? [] : [options.body]),
  ]
    .map((line) => `<text>${escapeXml(line)}</text>`)
    .join('')
  const xml = `<toast${rootAttrs}><visual><binding template="ToastGeneric">${lines}</binding></visual><audio silent="true"/>${actionsXml(options)}</toast>`

  const soundBlock =
    options.soundFile === undefined || options.soundFile === null
      ? ''
      : `
$sound = ${psQuote(options.soundFile)}
if (Test-Path -LiteralPath $sound) {
  Add-Type -Namespace WinMM -Name SmkitMCI -MemberDefinition '[DllImport("winmm.dll")] public static extern int mciSendString(string c, System.Text.StringBuilder b, int n, System.IntPtr h);' | Out-Null
  $buf = New-Object System.Text.StringBuilder 256
  $mci = "open \`"$sound\`" type mpegvideo alias smkitpop"
  [WinMM.SmkitMCI]::mciSendString($mci, $buf, 256, [System.IntPtr]::Zero) | Out-Null
  [WinMM.SmkitMCI]::mciSendString("play smkitpop wait", $buf, 256, [System.IntPtr]::Zero) | Out-Null
  [WinMM.SmkitMCI]::mciSendString("close smkitpop", $buf, 256, [System.IntPtr]::Zero) | Out-Null
}`

  return `
$ErrorActionPreference = 'SilentlyContinue'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml(${psQuote(xml)})
$toast = New-Object Windows.UI.Notifications.ToastNotification($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${psQuote(TOAST_AUMID)}).Show($toast)${soundBlock}
`.trim()
}

/**
 * The `<actions>` block, present only under the reminder scenario: the
 * dismiss button the scenario's contract requires, and the open-dsh button
 * when an origin is known. Any other duration renders no actions — a plain
 * toast has none.
 */
function actionsXml(options: ToastOptions): string {
  if (options.duration !== 'reminder') return ''
  const buttons = [
    ...(options.launchUrl
      ? [`<action content="打开 dsh" activationType="protocol" arguments="${escapeXml(options.launchUrl)}"/>`]
      : []),
    '<action content="知道了" activationType="system" arguments="dismiss"/>',
  ]
  return `<actions>${buttons.join('')}</actions>`
}

/**
 * Fire the toast (and its sound) without waiting for it: the child is spawned
 * and reaped in the background, killed at the timeout, and its failures are
 * logged at warn. Safe to call for every decision.
 */
export function showToast(options: ToastOptions, logger: LoggerLike): void {
  if (process.platform !== 'win32') return
  const script = buildToastScript(options)
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
    { stdio: 'ignore', windowsHide: true },
  )
  const timer = setTimeout(() => {
    child.kill()
  }, POWERSHELL_TIMEOUT_MS)
  timer.unref?.()
  child.on('error', (error) => {
    clearTimeout(timer)
    logger.warn?.(`${LOG_PREFIX} toast failed to spawn: ${error.message}`)
  })
  child.on('close', (code) => {
    clearTimeout(timer)
    // A non-zero exit is a PowerShell-level failure; the script itself
    // swallows per-statement errors, so anything here is environmental.
    if (code !== 0) logger.warn?.(`${LOG_PREFIX} toast child exited ${code}`)
  })
}
