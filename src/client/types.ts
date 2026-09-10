/**
 * Shared client-side types and the dependency bundle every factory receives.
 *
 * The browser half is compiled as CommonJS and bundled by
 * `scripts/build-client.mjs`; `react` arrives through `require("react")` in
 * `entry.ts` and is threaded down as an explicit dependency so no module needs
 * a global.
 */

/** Element returned by the injected `createElement`.
 *
 * Opaque by design: the client half builds a tree and hands it back to React,
 * never inspecting it (the reference implementation did the same). Declaring it
 * structurally would mean claiming a shape React does not have — the hook test
 * harness returns `{ type, props, children }`, real React returns an element
 * whose children live in `props`. Both are transparent to this code. */
export interface Element {
  readonly type: unknown
  readonly props: unknown
}

export type CreateElement = (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
) => Element

export interface ReactLike {
  createElement: CreateElement
  useState<T>(initial: T | (() => T)): [T, (value: T) => void]
  useEffect(effect: () => void | (() => void), deps?: unknown[]): void
  useCallback<T>(callback: T, deps?: unknown[]): T
}

/** Dictionary with `{placeholder}` interpolation. */
export type Translator = (key: string, values?: Record<string, unknown>) => string

export type LocaleDict = Record<string, string>

/** The slot/runtime context DSH hands to a client plugin's `apply`. */
export interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  locale: {
    register(namespace: string, dictionaries: { zh: LocaleDict; en: LocaleDict }): () => void
    bind(namespace: string): Translator
  }
  slots: {
    inject(name: string, setup: () => void): void
    register(options: SlotOptions, component: unknown): unknown
  }
}

export interface SlotOptions {
  name: string
  id: string
  order: number
  label: () => string
  locale: string
}

/** Props every settings section component receives from the slot system. */
export interface SectionProps {
  t: Translator
}

/** Result of one `/mcp-manager/api/*` call. */
export interface ApiResult {
  ok: boolean
  status: number
  body: Record<string, any>
}

export type ApiFn = (path: string, options?: RequestInit) => Promise<ApiResult>

/** Everything the components need, threaded explicitly (no module globals). */
export interface ClientDeps {
  react: ReactLike
  h: CreateElement
  api: ApiFn
  zh: LocaleDict
  en: LocaleDict
}

/* ------------------------------------------------------------ view models */

/** A global-tier server as `GET /servers` reports it. */
export interface ServerView {
  id: string
  name: string
  type: 'http' | 'stdio'
  enabled: boolean
  status: string
  toolCount: number
  error: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  authMode?: string
  headers?: Record<string, string>
  headerEnv?: Record<string, string>
  tokenEnv?: string
}

/** A workspace-tier server as `GET /workspaces` reports it. */
export interface WorkspaceServerView {
  id: string
  name: string
  type: 'http' | 'stdio'
  authMode: string
  source: 'workspace'
  status: string
  toolCount: number
  error: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  headerEnv?: Record<string, string>
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

/** One editable key/value row in the server form. */
export interface KeyValueRow {
  key: string
  value: string
}

/** Either tier can seed the edit form. */
export type EditableServer = ServerView | WorkspaceServerView

/* --------------------------------------------------------------- DOM events */

/*
 * Handlers are typed through `JSX.EventLike` in `ambient.d.ts`: JSX infers the
 * parameter from the element's `onChange`/`onClick`, so no per-component event
 * aliases are needed here.
 */
