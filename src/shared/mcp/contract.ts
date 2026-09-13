/**
 * The wire contract of the MCP feature.
 *
 * The host projects its runtime state into these shapes and serializes them
 * over `/mcp-manager/api/*`; the browser half renders exactly these shapes.
 * They live outside both `src/host` and `src/client` because each half used to
 * declare its own copy — with the client quietly widening `status` to `string`,
 * so nothing caught a host-side status the UI had no label for.
 *
 * Type-only by design: the browser bundle is a single CommonJS script with no
 * module resolver, and `import type` is erased before bundling, so nothing here
 * reaches any emitted code.
 *
 * The session delete's contract lives with its own feature
 * (`shared/session-delete/contract.ts`); the two used to share this file.
 */

export type ServerType = 'http' | 'stdio'
export type AuthMode = 'oauth' | 'static' | 'none'
export type EnvMap = Record<string, string>

export type ServerStatus =
  | 'connected'
  | 'needs-auth'
  | 'authorizing'
  | 'connecting'
  | 'error'
  | 'disconnected'
  | 'disabled'
  | 'conflict'
  | 'configured'

/** A global-tier server as `GET /servers` reports it. */
export interface ServerView {
  id: string
  name: string
  type: ServerType
  enabled: boolean
  status: ServerStatus
  toolCount: number
  error: string
  command?: string
  args?: string[]
  env?: EnvMap
  cwd?: string
  url?: string
  authMode?: AuthMode | ''
  headers?: EnvMap
  headerEnv?: EnvMap
  tokenEnv?: string
}

/** A workspace-tier server as `GET /workspaces` reports it. */
export interface WorkspaceServerView {
  id: string
  name: string
  type: ServerType
  authMode: AuthMode | ''
  source: 'workspace'
  status: ServerStatus
  toolCount: number
  error: string
  command?: string
  args?: string[]
  env?: EnvMap
  cwd?: string
  url?: string
  headers?: EnvMap
  headerEnv?: EnvMap
  tokenEnv?: string
}

export interface WorkspaceView {
  path: string
  servers: WorkspaceServerView[]
  exclude: string[]
  error: string
}

export interface SettingsView {
  onDemandToolInjection: boolean
}
