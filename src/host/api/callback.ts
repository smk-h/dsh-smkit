/**
 * `GET /mcp-manager/callback/:id` — the OAuth redirect receiver.
 *
 * This is a browser navigation, not a fetch, so it answers with a tiny HTML
 * page. Every failure path still trips `setServerAuthStatus` so the Settings
 * page shows why the round trip stopped, and a workspace-tier success
 * reconnects the server in place and re-registers its tools for every live
 * agent of that workspace.
 */

import { toErrorMessage } from '../util/text.js'
import type { ApiContext, ApiHandler } from './context.js'

const CALLBACK_RE = /^\/mcp-manager\/callback\/([A-Za-z0-9_-]+)$/

function htmlPage(res: Parameters<ApiHandler>[1], ok: boolean, message: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(
    `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px"><h2>${
      ok ? '✅ Authorized' : '❌ Authorization failed'
    }</h2><p>${message}</p><p><a href="/">Back to DSH</a></p></body>`,
  )
}

export const handleCallback: ApiHandler = async (req, res, facts, api: ApiContext) => {
  const match = CALLBACK_RE.exec(facts.url.pathname)
  if (!match || req.method !== 'GET') return false

  const done = (ok: boolean, message: string): void => htmlPage(res, ok, message)

  const found = api.workspaces.findServerById(match[1])
  const server = found?.server
  const code = facts.url.searchParams.get('code')
  const flowState = facts.url.searchParams.get('state')
  const oauthError = facts.url.searchParams.get('error')

  if (!server) return done(false, 'No MCP server config matches this callback'), true
  if (oauthError) {
    api.setServerAuthStatus(server, 'needs-auth', oauthError)
    return done(false, `Server returned: ${oauthError}`), true
  }
  if (!code || api.runtime.pending.get(server.id)?.state !== flowState) {
    api.setServerAuthStatus(server, 'needs-auth', 'session expired')
    return (
      done(false, 'Authorization session expired or invalid — start again from Settings → MCP'), true
    )
  }

  try {
    await api.oauth.exchangeCode(server, code, facts.origin)
    if (found?.wsPath) {
      // Reconnect the workspace server in place and re-register its tools into
      // every live agent in that workspace. The reconnect keeps the row
      // registered in the server map (the contract the transport-open guard
      // relies on), so a rescan landing mid-open supersedes it safely.
      await api.workspaces.restartWorkspaceServer(found.wsPath, server.name)
      const conn = api.runtime.workspaces.get(found.wsPath)?.servers.get(server.name)
      return (
        done(
          true,
          `Connected to ${server.name}${
            conn && conn.status === 'connected' ? `; ${conn.toolCount} tools registered` : ''
          }. You can close this page.`,
        ),
        true
      )
    }
    const conn = await api.registry.connect(server)
    return (
      done(true, `Connected to ${server.name}; ${conn.toolCount} tools registered. You can close this page.`),
      true
    )
  } catch (error) {
    api.setServerAuthStatus(server, 'error', toErrorMessage(error))
    return done(false, `Token exchange failed: ${toErrorMessage(error)}`), true
  }
}
