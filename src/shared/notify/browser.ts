/**
 * The address of the browser's own notification settings, per browser.
 *
 * No page can open it: `chrome://`, `edge://`, `opera://`, `vivaldi://` and
 * `about:` are privileged schemes, so a web-context `window.open` on one is
 * refused outright (it answers `null`, sometimes with a console error) and an
 * `<a href>` is equally dead. What a page *can* do is name the address: the
 * panel shows it and copies it to the clipboard, and the user pastes it into
 * the address bar, where the scheme is allowed. That is the whole of this
 * module — there is no navigation to attempt.
 *
 * The user agent is the only hint available for picking the right address, so
 * a browser this does not recognize (Safari, an embedded webview, a stripped
 * UA) answers `null` and the panel keeps its plain "allow it in the browser's
 * site settings" line instead of naming an address that would not open.
 */

/**
 * @param userAgent - the page's `navigator.userAgent`.
 * @returns the address to paste, or `null` when no known browser matches.
 */
export function notifySettingsUrl(userAgent: string): string | null {
  const ua = typeof userAgent === 'string' ? userAgent : ''
  // Order is load-bearing: every Chromium fork's UA also carries `Chrome/`
  // (and Firefox's never does), so the forks claim their own address before
  // the generic Chromium branch gets a chance to. Forks that do not brand
  // their UA — Brave, for one — fall into that branch, and `chrome://` is
  // accepted as an alias there anyway.
  if (/Edg[A-Za-z]*\//.test(ua)) return 'edge://settings/content/notifications'
  if (/OPR\//.test(ua)) return 'opera://settings/content/notifications'
  if (/Vivaldi\//.test(ua)) return 'vivaldi://settings/content/notifications'
  if (/Firefox\//.test(ua)) return 'about:preferences#privacy'
  if (/Chrome\//.test(ua) || /Chromium\//.test(ua)) return 'chrome://settings/content/notifications'
  return null
}
