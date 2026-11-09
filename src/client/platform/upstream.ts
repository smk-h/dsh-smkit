/**
 * Is the upstream MCP manager part of this client's entry graph?
 *
 * The host half decides the same question from the profile manifest
 * (`src/host/platform/upstream.ts`); the browser needs its own answer because
 * the failure it prevents happens here, at registration time: both plugins
 * register the `mcp` locale namespace, and dsh 0.2.2 answers a duplicate
 * namespace + language with an exception that costs the whole client entry.
 *
 * The boot graph `window.__DSH_BOOT__` is the host's own list of entries being
 * started, so reading it keeps this decision on the same data the loader uses —
 * no extra round trip, and no guessing from a package that is installed but not
 * loaded.
 */

/** Package name of the upstream project, as the boot graph spells it. */
export const UPSTREAM_MCP_PLUGIN = 'dsh-mcp-manager'

/**
 * Whether the upstream MCP manager is one of the entries being booted.
 *
 * @returns `false` when there is no boot graph at all (unit harnesses, a host
 *   that publishes none), which keeps this plugin's full surface on.
 */
export function upstreamMcpManagerPresent(): boolean {
  // The shell publishes the graph on `window`; a unit harness that runs this
  // bundle in a VM has no `window`, so fall back to the context's global.
  const scope = (typeof window === 'undefined' ? globalThis : window) as { __DSH_BOOT__?: unknown }
  const graph = scope.__DSH_BOOT__
  if (graph === null || typeof graph !== 'object') return false
  const entries = (graph as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return false
  return entries.some(
    (entry) =>
      entry !== null
      && typeof entry === 'object'
      && (entry as { id?: unknown }).id === UPSTREAM_MCP_PLUGIN,
  )
}
