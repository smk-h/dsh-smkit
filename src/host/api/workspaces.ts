/**
 * Workspace-tier server API: `/workspaces` and `/workspaces/*`.
 *
 * Every mutating route rewrites `<workspace>/.dsh/dshmm/mcp.json` and then
 * rescans that workspace, so the change lands in live agent sessions without a
 * restart (the file watcher covers external edits too). `path` must be a
 * registered or already-active workspace — the routes refuse arbitrary paths.
 * The one non-mutating exception is `/workspaces/open-config`, which opens
 * the config file with the platform's default association (creating the empty
 * file when absent) and never rescans.
 */

import { existsSync } from 'node:fs'
import { readBody, sendJson } from '../util/http.js'
import { openPath } from '../util/open.js'
import { workspaceTokenKey } from '../mcp/naming.js'
import { dropWorkspaceToken, saveState } from '../state.js'
import {
  buildWorkspaceEntry,
  normalizeWorkspaceServer,
  readWorkspaceRaw,
  writeWorkspaceRaw,
  wsConfigPath,
} from '../workspace/config.js'
import { resolveWorkspace } from './context.js'
import type { ApiContext, ApiHandler } from './context.js'

async function respondWithWorkspaces(api: ApiContext, res: Parameters<ApiHandler>[1]): Promise<void> {
  sendJson(res, 200, { workspaces: api.workspaces.listWorkspaces() })
}

export const handleWorkspaces: ApiHandler = async (req, res, facts, api) => {
  const { rest } = facts
  const state = api.runtime.state

  if (req.method === 'GET' && rest === '/workspaces') {
    await respondWithWorkspaces(api, res)
    return true
  }

  if (req.method === 'POST' && rest === '/workspaces/auth') {
    const body = await readBody(req)
    const path = String(body.path ?? '').trim()
    const name = String(body.name ?? '').trim()
    if (!path || !name) {
      sendJson(res, 400, { error: 'path and name are required' })
      return true
    }
    const canonical = resolveWorkspace(api, res, path)
    if (!canonical) return true
    const ws = api.runtime.workspaces.get(canonical)
    const conn = ws?.servers.get(name)
    if (!conn) {
      sendJson(res, 404, { error: `workspace server "${name}" not found in ${path}` })
      return true
    }
    if ((conn.server.type ?? 'http') !== 'http' || conn.server.authMode !== 'oauth') {
      sendJson(res, 400, { error: 'only HTTP OAuth workspace servers need authorization' })
      return true
    }
    const authorizeUrl = await api.oauth.startAuth(conn.server, facts.origin)
    sendJson(res, 200, { authorizeUrl })
    return true
  }

  if (req.method === 'POST' && rest === '/workspaces/exclude') {
    const body = await readBody(req)
    const path = String(body.path ?? '').trim()
    const server = String(body.server ?? '').trim()
    const exclude = body.exclude === true
    if (!path) {
      sendJson(res, 400, { error: 'path is required' })
      return true
    }
    if (!state.servers.some((candidate) => candidate.name === server)) {
      sendJson(res, 400, { error: `unknown global server "${server}"` })
      return true
    }
    const canonical = resolveWorkspace(api, res, path)
    if (!canonical) return true
    const raw = readWorkspaceRaw(canonical)
    const list = (Array.isArray(raw.exclude) ? raw.exclude : []).filter(
      (value): value is string => typeof value === 'string' && value !== server,
    )
    if (exclude) list.push(server)
    raw.exclude = [...new Set(list)]
    writeWorkspaceRaw(canonical, raw)
    if (api.runtime.workspaces.get(canonical)) await api.workspaces.rescanWorkspace(canonical)
    await respondWithWorkspaces(api, res)
    return true
  }

  if (req.method === 'POST' && rest === '/workspaces/servers') {
    const body = await readBody(req)
    const path = String(body.path ?? '').trim()
    if (!path) {
      sendJson(res, 400, { error: 'path is required' })
      return true
    }
    const { name, entry, error } = buildWorkspaceEntry(body)
    if (error || !name || !entry) {
      sendJson(res, 400, { error: error ?? 'invalid server payload' })
      return true
    }
    const canonical = resolveWorkspace(api, res, path)
    if (!canonical) return true
    const raw = readWorkspaceRaw(canonical)
    if (raw.mcpServers && typeof raw.mcpServers === 'object' && name in raw.mcpServers) {
      sendJson(res, 409, { error: `a server named ${name} already exists in this workspace` })
      return true
    }
    if (api.workspaces.serverNameTaken(name, canonical)) {
      sendJson(res, 409, { error: `a server named ${name} already exists (global or in another workspace)` })
      return true
    }
    raw.mcpServers = raw.mcpServers && typeof raw.mcpServers === 'object' && !Array.isArray(raw.mcpServers)
      ? raw.mcpServers
      : {}
    raw.mcpServers[name] = entry
    writeWorkspaceRaw(canonical, raw)
    // Register the rows without waiting for their transports: the response
    // already lists the new server in `connecting` state and the settings
    // page's poll settles it, so a slow server cannot pin the form open.
    await api.workspaces.rescanWorkspace(canonical, { awaitConnect: false })
    await respondWithWorkspaces(api, res)
    return true
  }

  if (req.method === 'PUT' && rest === '/workspaces/servers') {
    const body = await readBody(req)
    const path = String(body.path ?? '').trim()
    const oldName = String(body.oldName ?? '').trim()
    if (!path || !oldName) {
      sendJson(res, 400, { error: 'path and oldName are required' })
      return true
    }
    const { name, entry, error } = buildWorkspaceEntry(body)
    if (error || !name || !entry) {
      sendJson(res, 400, { error: error ?? 'invalid server payload' })
      return true
    }
    const canonical = resolveWorkspace(api, res, path)
    if (!canonical) return true
    const raw = readWorkspaceRaw(canonical)
    if (!raw.mcpServers || typeof raw.mcpServers !== 'object' || !(oldName in raw.mcpServers)) {
      sendJson(res, 404, { error: `workspace server "${oldName}" not found` })
      return true
    }
    let keepOAuth = false
    if (name === oldName && entry.type === 'http' && entry.authMode === 'oauth') {
      const previous = normalizeWorkspaceServer(oldName, raw.mcpServers[oldName], canonical)
      if (previous?.type === 'http' && previous.authMode === 'oauth') {
        try {
          keepOAuth = api.oauth.issuerOf(previous) === api.oauth.issuerOf({ url: String(entry.url) } as never)
        } catch {
          keepOAuth = false
        }
      }
    }
    if (name !== oldName) {
      if (name in raw.mcpServers) {
        sendJson(res, 409, { error: `a server named ${name} already exists in this workspace` })
        return true
      }
      if (api.workspaces.serverNameTaken(name, canonical)) {
        sendJson(res, 409, { error: `a server named ${name} already exists (global or in another workspace)` })
        return true
      }
    }
    delete raw.mcpServers[oldName]
    raw.mcpServers[name] = entry
    writeWorkspaceRaw(canonical, raw)
    // Preserve OAuth state only while the same named server stays on the same
    // issuer; otherwise an old token/client registration is unsafe.
    if (!keepOAuth && dropWorkspaceToken(state, workspaceTokenKey(canonical, oldName))) {
      saveState(state)
    }
    // Same as the add route: apply the diff and answer; transports reconnect
    // in the background while the card shows `connecting`.
    await api.workspaces.rescanWorkspace(canonical, { awaitConnect: false })
    await respondWithWorkspaces(api, res)
    return true
  }

  if (req.method === 'POST' && rest === '/workspaces/servers/delete') {
    const body = await readBody(req)
    const path = String(body.path ?? '').trim()
    const name = String(body.name ?? '').trim()
    if (!path || !name) {
      sendJson(res, 400, { error: 'path and name are required' })
      return true
    }
    const canonical = resolveWorkspace(api, res, path)
    if (!canonical) return true
    const raw = readWorkspaceRaw(canonical)
    if (raw.mcpServers && typeof raw.mcpServers === 'object') delete raw.mcpServers[name]
    writeWorkspaceRaw(canonical, raw)
    if (dropWorkspaceToken(state, workspaceTokenKey(canonical, name))) saveState(state)
    if (api.runtime.workspaces.get(canonical)) await api.workspaces.rescanWorkspace(canonical)
    await respondWithWorkspaces(api, res)
    return true
  }

  if (req.method === 'POST' && rest === '/workspaces/open-config') {
    const body = await readBody(req)
    const path = String(body.path ?? '').trim()
    if (!path) {
      sendJson(res, 400, { error: 'path is required' })
      return true
    }
    const canonical = resolveWorkspace(api, res, path)
    if (!canonical) return true
    const file = wsConfigPath(canonical)
    // The open needs a target: create the minimal config when absent. A
    // present-but-broken file still opens — the user must see it to fix it.
    if (!existsSync(file)) writeWorkspaceRaw(canonical, {})
    openPath(file)
    sendJson(res, 200, { file })
    return true
  }

  return false
}
