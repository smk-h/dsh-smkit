/**
 * Global-tier server API: `/servers` and `/servers/:id/*`.
 *
 * Editing is a three-phase operation: validate everything first (so a rejected
 * edit leaves the live server untouched), then disconnect + rewrite the config,
 * then reconnect from the new config. Disable/enable is profile-global:
 * disabling unregisters every tool and drops the transport while config and
 * OAuth tokens persist.
 */

import { SERVER_NAME_RE } from '../constants.js'
import { hasToken } from '../credentials.js'
import { newServerId } from '../mcp/naming.js'
import { saveState } from '../state.js'
import { readBody, sendJson } from '../util/http.js'
import { parseArgs, parseEnv } from '../util/text.js'
import type { ApiContext, ApiHandler } from './context.js'
import type { AuthMode, EnvMap, ServerConfig } from '../types.js'

const NAME_ERROR = 'name must be 1-32 chars of [A-Za-z0-9_-] (it becomes the mcp__<name>__ tool prefix)'
const COMMAND_ERROR = 'stdio server requires a command (executable, e.g. npx / uvx / python)'
const URL_ERROR = 'url must be an http(s) URL'

interface NextConfig {
  command?: string
  args?: string[]
  env?: EnvMap
  cwd?: string
  url?: string
  authMode?: AuthMode
  headers?: EnvMap
  headerEnv?: EnvMap
  tokenEnv?: string
}

/** Connect, or record why we cannot (missing credentials). */
async function connectOrMark(api: ApiContext, server: ServerConfig): Promise<void> {
  if ((server.type ?? 'http') === 'stdio' || hasToken(server)) {
    await api.registry.connect(server)
    return
  }
  api.runtime.setLive(server.id, {
    status: 'needs-auth',
    error: server.authMode === 'static' ? 'missing token (set the env var)' : '',
  })
}

export const handleServers: ApiHandler = async (req, res, facts, api) => {
  const { rest, idMatch } = facts
  const state = api.runtime.state

  if (req.method === 'GET' && rest === '/servers') {
    sendJson(res, 200, { servers: state.servers.map((server) => api.registry.serverView(server)) })
    return true
  }

  if (req.method === 'POST' && rest === '/servers') {
    const body = await readBody(req)
    const name = String(body.name ?? '').trim()
    const type = body.type === 'stdio' ? 'stdio' : 'http'
    if (!SERVER_NAME_RE.test(name)) {
      sendJson(res, 400, { error: NAME_ERROR })
      return true
    }
    if (api.workspaces.serverNameTaken(name)) {
      sendJson(res, 409, { error: `a server named ${name} already exists (global or in a workspace)` })
      return true
    }

    let server: ServerConfig
    if (type === 'stdio') {
      const command = String(body.command ?? '').trim()
      if (!command) {
        sendJson(res, 400, { error: COMMAND_ERROR })
        return true
      }
      server = {
        id: newServerId(),
        name,
        type: 'stdio',
        command,
        args: parseArgs(body.args),
        env: parseEnv(body.env),
      }
      const cwd = String(body.cwd ?? '').trim()
      if (cwd) server.cwd = cwd
    } else {
      const serverUrl = String(body.url ?? '').trim()
      const authMode: AuthMode = body.authMode === 'static' ? 'static' : 'oauth'
      if (!/^https?:\/\//.test(serverUrl)) {
        sendJson(res, 400, { error: URL_ERROR })
        return true
      }
      server = {
        id: newServerId(),
        name,
        type: 'http',
        url: serverUrl,
        authMode,
        headers: parseEnv(body.headers),
        headerEnv: parseEnv(body.headerEnv),
      }
      if (authMode === 'static') server.tokenEnv = String(body.tokenEnv ?? '').trim()
    }

    state.servers.push(server)
    saveState(state)
    await connectOrMark(api, server)
    sendJson(res, 201, { server: api.registry.serverView(server) })
    return true
  }

  if (!idMatch) return false

  const server = state.servers.find((candidate) => candidate.id === idMatch[1])
  if (!server) {
    sendJson(res, 404, { error: 'server not found' })
    return true
  }
  const action = idMatch[2]

  if (req.method === 'POST' && action === '/auth') {
    const authorizeUrl = await api.oauth.startAuth(server, facts.origin)
    sendJson(res, 200, { authorizeUrl })
    return true
  }

  if (req.method === 'POST' && action === '/connect') {
    await api.registry.connect(server)
    sendJson(res, 200, { server: api.registry.serverView(server) })
    return true
  }

  if (req.method === 'POST' && action === '/enabled') {
    const body = await readBody(req)
    const enabled = body.enabled !== false
    if (enabled === (server.enabled !== false)) {
      sendJson(res, 200, { server: api.registry.serverView(server) })
      return true
    }
    server.enabled = enabled
    saveState(state)
    if (!enabled) {
      // Unregister every tool and tear down the transport; config and OAuth
      // tokens stay persisted for the next enable.
      api.registry.disconnect(server.id)
    } else {
      await connectOrMark(api, server)
    }
    sendJson(res, 200, { server: api.registry.serverView(server) })
    return true
  }

  if (req.method === 'PUT' && !action) {
    const body = await readBody(req)
    const type = body.type === 'stdio' ? 'stdio' : 'http'
    const previousType = server.type ?? 'http'
    const previousAuthMode = server.authMode
    let previousIssuer = ''
    if (previousType === 'http' && previousAuthMode === 'oauth') {
      try {
        previousIssuer = api.oauth.issuerOf(server)
      } catch {
        previousIssuer = ''
      }
    }

    // 1. Validate first: nothing below mutates `server` until every check passed.
    const newName = String(body.name ?? server.name).trim()
    if (!SERVER_NAME_RE.test(newName)) {
      sendJson(res, 400, { error: NAME_ERROR })
      return true
    }
    if (newName !== server.name && api.workspaces.serverNameTaken(newName)) {
      sendJson(res, 409, { error: `a server named ${newName} already exists (global or in a workspace)` })
      return true
    }

    const next: NextConfig = {}
    if (type === 'stdio') {
      const command = String(body.command ?? '').trim()
      if (!command) {
        sendJson(res, 400, { error: COMMAND_ERROR })
        return true
      }
      next.command = command
      next.args = parseArgs(body.args)
      next.env = parseEnv(body.env)
      const cwd = String(body.cwd ?? '').trim()
      if (cwd) next.cwd = cwd
    } else {
      const serverUrl = String(body.url ?? '').trim()
      if (!/^https?:\/\//.test(serverUrl)) {
        sendJson(res, 400, { error: URL_ERROR })
        return true
      }
      next.url = serverUrl
      next.authMode = body.authMode === 'static' ? 'static' : 'oauth'
      next.headers = parseEnv(body.headers)
      next.headerEnv = parseEnv(body.headerEnv)
      if (next.authMode === 'static') {
        // An empty field means "keep the existing env var name" (the edit form
        // only refills the name, never the token itself).
        next.tokenEnv = String(body.tokenEnv ?? '').trim() || server.tokenEnv || ''
      }
    }

    // 2. Drop the old connection, then apply the new config.
    api.registry.disconnect(server.id)
    server.name = newName
    server.type = type
    if (type === 'stdio') {
      server.command = next.command
      server.args = next.args
      server.env = next.env
      if (next.cwd) server.cwd = next.cwd
      else delete server.cwd
      delete server.url
      delete server.authMode
      delete server.tokenEnv
      delete server.headers
      delete server.headerEnv
      delete server.oauth
      delete server.staticToken
    } else {
      server.url = next.url
      server.authMode = next.authMode
      server.headers = next.headers
      server.headerEnv = next.headerEnv
      if (next.authMode === 'static') {
        server.tokenEnv = next.tokenEnv
        delete server.oauth
        // Once an env var name is set (or kept), the legacy plaintext token is
        // obsolete — drop it.
        if (server.tokenEnv) delete server.staticToken
      } else {
        delete server.tokenEnv
        delete server.staticToken
        let nextIssuer = ''
        try {
          nextIssuer = api.oauth.issuerOf(server)
        } catch {
          nextIssuer = ''
        }
        if (previousType !== 'http' || previousAuthMode !== 'oauth' || previousIssuer !== nextIssuer) {
          delete server.oauth
        }
      }
      delete server.command
      delete server.args
      delete server.env
      delete server.cwd
    }
    saveState(state)

    // 3. Reconnect from the new config.
    await connectOrMark(api, server)
    sendJson(res, 200, { server: api.registry.serverView(server) })
    return true
  }

  if (req.method === 'DELETE' && !action) {
    api.registry.disconnect(server.id)
    state.servers = state.servers.filter((candidate) => candidate.id !== server.id)
    saveState(state)
    sendJson(res, 200, { ok: true })
    return true
  }

  return false
}
