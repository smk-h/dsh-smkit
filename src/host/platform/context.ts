/**
 * The Cordis context the plugin mounts on, and what a feature mounts with.
 *
 * `PluginContext` is kept structural so the plugin needs no import from
 * `@deepseek-ai/cordis` and stays mountable on the stub contexts in `test/`.
 */

import type { ApiHandler } from './routes.js'
import type { LoggerLike, ServiceAccessor, ToolsRegistry, WebServerLike } from './types.js'

/** Structural view of the Cordis context handed to the plugin's `apply`. */
export interface PluginContext {
  logger: LoggerLike
  tools: ToolsRegistry
  webServer?: WebServerLike
  get?(name: string): unknown
  /** Cordis event publication. The session delete announces itself with it. */
  emit?(event: string, ...args: unknown[]): void
  /**
   * Cordis hook registration. The prompt-assembly payload is the harness's own
   * shape, declared structurally where it is consumed (`broker/runtime.ts`), so
   * the platform layer stays free of business types.
   */
  on(
    event: string,
    handler: (...args: any[]) => any,
    options?: { prepend?: boolean; global?: boolean },
  ): () => void
  inject(names: string[], callback: (childCtx: PluginContext) => void): { dispose(): void }
  effect(callback: () => void | (() => void), label?: string): unknown
  [key: string]: unknown
}

/**
 * What a feature gets to mount with.
 *
 * `handlers` and `outsideApi` are the feature's route contribution: it pushes
 * its own handlers while mounting, and the composition root mounts the single
 * prefix route afterwards. Registration order is match order.
 */
export interface HostPlatform {
  logger: LoggerLike
  tools: ToolsRegistry
  services: ServiceAccessor
  /** The raw Cordis context, for the services a feature injects lazily. */
  ctx: PluginContext
  /** Handlers for paths outside the API prefix (the OAuth callback is one). */
  outsideApi: ApiHandler[]
  /** Handlers inside the API prefix. */
  handlers: ApiHandler[]
}

/**
 * One host-side feature. `mount` wires its subsystems, contributes its
 * handlers, installs its own teardown, and leaves nothing for the composition
 * root to know about it beyond this interface.
 */
export interface HostFeature {
  /** Stable id, used in diagnostics and by the composition root's list. */
  id: string
  mount(platform: HostPlatform): void
}
