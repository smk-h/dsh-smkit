/**
 * On-disk per-workspace config: `<workspace>/.dsh/dshmm/mcp.json`.
 *
 * Claude/Codex-style shape — `{ mcpServers: { <name>: {...} }, exclude: [...] }`
 * — where `exclude` masks named global servers inside that workspace. The file
 * is declarative and contains **no secrets**: OAuth client registrations and
 * tokens live in the sensitive profile state file, keyed by workspace path.
 */

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  SERVER_COMMAND_ERROR,
  SERVER_NAME_ERROR,
  SERVER_NAME_RE,
  SERVER_URL_ERROR,
  WORKSPACE_CONFIG_REL,
} from '../constants.js'
import { normalizeAuthMode } from '../auth/credentials.js'
import { newWorkspaceServerId } from '../mcp/naming.js'
import { errorText, isHttpUrl, isRecord, parseArgs, parseEnv } from '../util/text.js'
import type { ServerConfig, WorkspaceConfig, WorkspaceRawConfig } from '../types.js'

export function wsConfigPath(cwd: string): string {
  return join(cwd, WORKSPACE_CONFIG_REL)
}

export function canonicalize(cwd: string): string {
  try {
    return realpathSync(cwd)
  } catch {
    return cwd
  }
}

/** Read/write the raw config object, preserving unrelated keys. */
export function readWorkspaceRaw(cwd: string): WorkspaceRawConfig {
  try {
    const raw: unknown = JSON.parse(readFileSync(wsConfigPath(cwd), 'utf8'))
    if (!isRecord(raw)) throw new Error('root must be a JSON object')
    return raw as WorkspaceRawConfig
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return {}
    throw new Error(`invalid ${WORKSPACE_CONFIG_REL}: ${errorText(error)}`)
  }
}

export function writeWorkspaceRaw(cwd: string, raw: WorkspaceRawConfig): void {
  mkdirSync(dirname(wsConfigPath(cwd)), { recursive: true })
  writeFileSync(wsConfigPath(cwd), `${JSON.stringify(raw, null, 2)}\n`)
}

/** Normalize one `mcpServers[name]` entry; `null` means "not usable, skip it". */
export function normalizeWorkspaceServer(name: string, cfg: unknown, cwd: string): ServerConfig | null {
  if (typeof name !== 'string' || !SERVER_NAME_RE.test(name)) return null
  if (!isRecord(cfg)) return null
  const type = cfg.type === 'stdio' ? 'stdio' : 'http'
  if (type === 'stdio') {
    const command = String(cfg.command ?? '').trim()
    if (!command) return null
    const server: ServerConfig = {
      id: newWorkspaceServerId(),
      name,
      type: 'stdio',
      command,
      args: parseArgs(cfg.args),
      env: parseEnv(cfg.env),
    }
    const workspaceCwd = String(cfg.cwd ?? '').trim()
    server.cwd = workspaceCwd || cwd
    return server
  }
  const url = String(cfg.url ?? '').trim()
  if (!isHttpUrl(url)) return null
  const authMode = normalizeAuthMode(cfg.authMode)
  const server: ServerConfig = {
    id: newWorkspaceServerId(),
    name,
    type: 'http',
    url,
    authMode,
    headers: parseEnv(cfg.headers),
    headerEnv: parseEnv(cfg.headerEnv),
  }
  if (authMode === 'static') server.tokenEnv = String(cfg.tokenEnv ?? '').trim()
  return server
}

export function readWorkspaceConfig(cwd: string): WorkspaceConfig {
  try {
    const raw: unknown = JSON.parse(readFileSync(wsConfigPath(cwd), 'utf8'))
    if (!isRecord(raw)) throw new Error('root must be a JSON object')
    const servers: ServerConfig[] = []
    const mcpServers = raw.mcpServers
    if (isRecord(mcpServers)) {
      for (const [name, cfg] of Object.entries(mcpServers)) {
        const server = normalizeWorkspaceServer(name, cfg, cwd)
        if (server) servers.push(server)
      }
    }
    const exclude = Array.isArray(raw.exclude)
      ? raw.exclude.filter((value): value is string => typeof value === 'string')
      : []
    return { servers, exclude, error: '' }
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return { servers: [], exclude: [], error: '' }
    return { servers: [], exclude: [], error: `invalid ${WORKSPACE_CONFIG_REL}: ${errorText(error)}` }
  }
}

export interface WorkspaceEntryResult {
  name?: string
  entry?: Record<string, unknown>
  error?: string
}

/**
 * Normalize + validate a flat server payload (from the Settings form) into a
 * Claude/Codex-style `mcpServers[name]` entry.
 */
export function buildWorkspaceEntry(body: Record<string, unknown>): WorkspaceEntryResult {
  const name = String(body?.name ?? '').trim()
  if (!SERVER_NAME_RE.test(name)) return { error: SERVER_NAME_ERROR }
  const type = body?.type === 'stdio' ? 'stdio' : 'http'
  const entry: Record<string, unknown> = { type }
  if (type === 'stdio') {
    const command = String(body?.command ?? '').trim()
    if (!command) return { error: SERVER_COMMAND_ERROR }
    entry.command = command
    entry.args = parseArgs(body?.args)
    entry.env = parseEnv(body?.env)
    const cwd = String(body?.cwd ?? '').trim()
    if (cwd) entry.cwd = cwd
  } else {
    const url = String(body?.url ?? '').trim()
    if (!isHttpUrl(url)) return { error: SERVER_URL_ERROR }
    entry.url = url
    entry.authMode = normalizeAuthMode(body?.authMode)
    entry.headers = parseEnv(body?.headers)
    entry.headerEnv = parseEnv(body?.headerEnv)
    if (entry.authMode === 'static') entry.tokenEnv = String(body?.tokenEnv ?? '').trim()
  }
  return { name, entry }
}

/** Compare the connection-relevant fields of two server configs. */
export function sameServerConfig(a: ServerConfig, b: ServerConfig): boolean {
  const norm = (server: ServerConfig): string =>
    JSON.stringify({
      type: server.type ?? 'http',
      url: server.url ?? '',
      authMode: server.authMode ?? '',
      tokenEnv: server.tokenEnv ?? '',
      headers: server.headers ?? {},
      headerEnv: server.headerEnv ?? {},
      command: server.command ?? '',
      args: server.args ?? [],
      env: server.env ?? {},
      cwd: server.cwd ?? '',
    })
  return norm(a) === norm(b)
}
