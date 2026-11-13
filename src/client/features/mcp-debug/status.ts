/**
 * One status value, one dictionary key.
 *
 * The status strings are the host's own vocabulary (`shared/mcp/contract`), and
 * every surface that prints one has to name it in the reader's language. Mapping
 * by lookup rather than by interpolating the value into a key keeps a status the
 * host adds later from resolving to a missing key: an unknown one reads as
 * "disconnected", which is the conservative half of whatever it means.
 *
 * The same status also tints the row's dot; that part is the stylesheet's
 * (`[data-smkit-status=…]`), so nothing here knows a colour.
 */

const STATUS_KEYS: Record<string, string> = {
  connected: 'statusConnected',
  'needs-auth': 'statusNeedsAuth',
  authorizing: 'statusAuthorizing',
  connecting: 'statusConnecting',
  reconnecting: 'statusReconnecting',
  error: 'statusError',
  disconnected: 'statusDisconnected',
  disabled: 'statusDisabled',
  conflict: 'statusConflict',
  configured: 'statusConfigured',
}

/**
 * The dictionary key naming one status.
 *
 * @param status - the host's status string.
 * @returns a key of the `mcp-debug` dictionary.
 */
export function statusKey(status: string): string {
  return STATUS_KEYS[status] ?? 'statusDisconnected'
}

/** Whether a status means "no live transport", so the tools column can explain itself. */
export function isDown(status: string): boolean {
  return status !== 'connected'
}
