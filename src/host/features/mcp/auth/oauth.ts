/**
 * OAuth 2.0 authorization-code + PKCE flow for HTTP MCP servers.
 *
 * Contract (see AGENTS.md in the reference implementation):
 * - The redirect origin is derived **per request** from the incoming `Host`
 *   header — never hardcoded, so any listen address works.
 * - Client registration (RFC 7591) is bound to the exact redirect URI and is
 *   re-done whenever the origin changes, because `redirect_uri` must match at
 *   exchange time.
 * - Tokens and the client registration live in the sensitive state file.
 */

import { createHash, randomBytes } from 'node:crypto'
import { CALLBACK_PATH } from '../constants.js'
import { persistServer } from '../state.js'
import { httpPostForm, httpPostJson, parseJsonText } from '../../../platform/util/http.js'
import { b64url, isRecord } from '../../../platform/util/text.js'
import type { Runtime } from '../runtime.js'
import type { ServerConfig, ServerStatus } from '../types.js'

export interface OAuthMetadata {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
}

export type SetServerAuthStatus = (
  server: ServerConfig,
  status: ServerStatus,
  error?: string,
) => void

export interface OAuthDeps {
  setServerAuthStatus: SetServerAuthStatus
}

export interface OAuthService {
  /** Issuer base URL: the configured override, else the server URL origin. */
  issuerOf(server: ServerConfig): string
  discoverOauthMetadata(server: ServerConfig): Promise<OAuthMetadata>
  callbackFor(origin: string, serverId: string): string
  ensureClientId(server: ServerConfig, md: OAuthMetadata, origin: string): Promise<string>
  /** Start a flow: returns the URL the browser must open. */
  startAuth(server: ServerConfig, origin: string): Promise<string>
  exchangeCode(server: ServerConfig, code: string, origin: string): Promise<void>
  /** Refresh an expired access token; `false` means "re-authenticate". */
  refreshTokens(server: ServerConfig): Promise<boolean>
}

export function createOAuth(runtime: Runtime, deps: OAuthDeps): OAuthService {
  const { setServerAuthStatus } = deps
  const state = runtime.state

  function issuerOf(server: ServerConfig): string {
    if (server.oauth?.issuer) return server.oauth.issuer.replace(/\/$/, '')
    return new URL(String(server.url)).origin
  }

  async function discoverOauthMetadata(server: ServerConfig): Promise<OAuthMetadata> {
    const issuer = issuerOf(server)
    try {
      const resp = await fetch(`${issuer}/.well-known/oauth-authorization-server`, {
        signal: AbortSignal.timeout(15_000),
      })
      if (resp.ok) {
        const md = (await resp.json().catch(() => null)) as OAuthMetadata | null
        if (md && md.authorization_endpoint && md.token_endpoint) return md
      }
    } catch {
      // Fall through to the conventional endpoints below.
    }
    return {
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/register`,
    }
  }

  function callbackFor(origin: string, serverId: string): string {
    return `${origin}${CALLBACK_PATH}/${serverId}`
  }

  async function ensureClientId(server: ServerConfig, md: OAuthMetadata, origin: string): Promise<string> {
    const redirect = callbackFor(origin, server.id)
    if (server.oauth?.clientId && server.oauth.redirect === redirect) return server.oauth.clientId
    const regEndpoint = md.registration_endpoint ?? `${issuerOf(server)}/register`
    const resp = await httpPostJson(regEndpoint, {}, {
      client_name: `dsh-mcp-manager-${server.name}`,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      redirect_uris: [redirect],
    })
    const reg = parseJsonText(resp)
    const clientId = isRecord(reg) ? reg.client_id : undefined
    if (typeof clientId !== 'string' || !clientId) {
      throw new Error(`client registration failed: HTTP ${resp.status} ${String(resp.text).slice(0, 200)}`)
    }
    server.oauth = server.oauth ?? {}
    server.oauth.clientId = clientId
    server.oauth.redirect = redirect
    persistServer(state, server)
    return clientId
  }

  async function startAuth(server: ServerConfig, origin: string): Promise<string> {
    const md = await discoverOauthMetadata(server)
    const clientId = await ensureClientId(server, md, origin)
    const verifier = b64url(randomBytes(48))
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    const csrf = b64url(randomBytes(16))
    runtime.pending.set(server.id, { state: csrf, verifier })
    const url = new URL(md.authorization_endpoint)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', callbackFor(origin, server.id))
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', csrf)
    setServerAuthStatus(server, 'authorizing')
    return url.toString()
  }

  async function exchangeCode(server: ServerConfig, code: string, origin: string): Promise<void> {
    const flow = runtime.pending.get(server.id)
    if (!flow) throw new Error('no pending authorization for this server')
    runtime.pending.delete(server.id)
    const md = await discoverOauthMetadata(server)
    const clientId = await ensureClientId(server, md, origin)
    const resp = await httpPostForm(md.token_endpoint, {}, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackFor(origin, server.id),
      client_id: clientId,
      code_verifier: flow.verifier,
    })
    const tok = parseJsonText(resp)
    const accessToken = isRecord(tok) ? tok.access_token : undefined
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new Error(`token exchange failed: HTTP ${resp.status} ${String(resp.text).slice(0, 200)}`)
    }
    const expiresIn = isRecord(tok) && typeof tok.expires_in === 'number' ? tok.expires_in : 3600
    server.oauth = server.oauth ?? {}
    server.oauth.tokens = {
      access_token: accessToken,
      refresh_token:
        (isRecord(tok) && typeof tok.refresh_token === 'string' ? tok.refresh_token : undefined) ??
        server.oauth.tokens?.refresh_token ??
        '',
      expires_at: Date.now() + expiresIn * 1000 - 60_000,
    }
    persistServer(state, server)
  }

  async function refreshTokens(server: ServerConfig): Promise<boolean> {
    const tokens = server.oauth?.tokens
    if (!tokens?.refresh_token) return false
    const md = await discoverOauthMetadata(server)
    const clientId = server.oauth?.clientId
    if (!clientId) return false
    const resp = await httpPostForm(md.token_endpoint, {}, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    })
    const tok = parseJsonText(resp)
    const accessToken = isRecord(tok) ? tok.access_token : undefined
    if (typeof accessToken !== 'string' || !accessToken) return false
    const expiresIn = isRecord(tok) && typeof tok.expires_in === 'number' ? tok.expires_in : 3600
    server.oauth = server.oauth ?? {}
    server.oauth.tokens = {
      access_token: accessToken,
      refresh_token:
        (isRecord(tok) && typeof tok.refresh_token === 'string' ? tok.refresh_token : undefined) ??
        tokens.refresh_token,
      expires_at: Date.now() + expiresIn * 1000 - 60_000,
    }
    persistServer(state, server)
    return true
  }

  return {
    issuerOf,
    discoverOauthMetadata,
    callbackFor,
    ensureClientId,
    startAuth,
    exchangeCode,
    refreshTokens,
  }
}
