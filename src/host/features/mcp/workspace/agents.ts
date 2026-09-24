/**
 * Agent-creation decoration: per-agent workspace scoping.
 *
 * The plugin wraps `agents.create` / `agents.resume` so that every agent gets
 * its workspace's MCP servers registered into its own tool registry. Two
 * compatibility rules make this safe across harness generations:
 *
 * - The Agent may arrive as an explicit second argument (0.1.5-rc.*) or behind
 *   the context's `agent` accessor (older builds). See `resolveSetupAgent`.
 * - Scoping is **best effort**: a missing/invalid cwd or any failure degrades to
 *   "global tools only" and must never reject session creation.
 *
 * The wrapper is installed on the raw provider target behind Cordis' traceable
 * proxy, reached through the process-global `Symbol.for('cordis.original')`,
 * so the plugin still needs no import from `@deepseek-ai/cordis`.
 */

import { isAbsolute } from 'node:path'
import { LOG_PREFIX } from '../constants.js'
import { canonicalize } from './config.js'
import { errorText, isRecord } from '../../../platform/util/text.js'
import type { Runtime } from '../runtime.js'
import type { WorkspaceManager } from './manager.js'
import type { WorkspaceScope } from './scope.js'
import type { AgentLike, LoggerLike } from '../types.js'

const ORIGINAL = Symbol.for('cordis.original')

/**
 * Resolve the Agent handed to an agent-setup callback.
 *
 * Older harness builds call `setup(agentCtx)` and expose the Agent through an
 * `agent` accessor declared on the context. Newer builds (0.1.5-rc.*) dropped
 * that accessor and pass the Agent as the second argument instead, so reading
 * `agentCtx.agent` there throws "cannot get property \"agent\" without inject"
 * and used to fail every session create/resume. Prefer the explicit argument,
 * fall back to the guarded accessor, and never throw.
 */
export function resolveSetupAgent(agentCtx: unknown, agent?: unknown): AgentLike | undefined {
  if (agent !== undefined && agent !== null) return agent as AgentLike
  if (agentCtx === null || typeof agentCtx !== 'object') return undefined
  try {
    if ('agent' in agentCtx) return (agentCtx as { agent?: AgentLike }).agent
  } catch {
    // A context whose `agent` accessor exists but refuses to resolve: no agent.
  }
  return undefined
}

interface InstalledWrapper {
  dispose(): void
}

function getPropertyDescriptor(target: object, prop: string): PropertyDescriptor | undefined {
  let proto: object | null = target
  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop)
    if (descriptor) return descriptor
    proto = Object.getPrototypeOf(proto) as object | null
  }
  return undefined
}

function installMethodWrapper(
  value: unknown,
  method: string,
  wrap: (original: (...args: unknown[]) => unknown, thisArg: unknown, args: unknown[]) => unknown,
): InstalledWrapper {
  const holder = isRecord(value) ? (value as Record<string | symbol, unknown>) : undefined
  const raw = holder?.[ORIGINAL] ?? value
  if (!isRecord(raw) && typeof raw !== 'function') {
    throw new TypeError(`${LOG_PREFIX}: cannot wrap non-function method ${String(method)}`)
  }
  const target = raw as object
  const before = getPropertyDescriptor(target, method)
  if (!before || typeof before.value !== 'function') {
    throw new TypeError(`${LOG_PREFIX}: cannot wrap non-function method ${String(method)}`)
  }
  const original = before.value as (...args: unknown[]) => unknown
  const hadOwn = Object.prototype.hasOwnProperty.call(target, method)
  const installed = function (this: unknown, ...args: unknown[]): unknown {
    return wrap(original, this, args)
  }
  Object.defineProperty(target, method, {
    value: installed,
    writable: true,
    configurable: true,
    enumerable: before.enumerable ?? false,
  })
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      if ((target as Record<string, unknown>)[method] !== installed) return
      if (hadOwn) Object.defineProperty(target, method, before)
      else delete (target as Record<string, unknown>)[method]
    },
  }
}

export interface AgentDecoratorsDeps {
  runtime: Runtime
  logger: LoggerLike
  manager: WorkspaceManager
  scope: WorkspaceScope
}

export interface AgentDecorators {
  installAgentDecorators(agents: unknown): () => void
}

export function createAgentDecorators(deps: AgentDecoratorsDeps): AgentDecorators {
  const { runtime, logger, manager, scope } = deps

  /**
   * Compose the caller's agent setup with workspace scoping. Best-effort: a
   * missing/invalid cwd or any scoping failure degrades to "global tools only"
   * and never rejects agent creation.
   *
   * The scan never *waits* for the workspace's transports: connecting is
   * background work, so opening a session is not gated on a cold MCP server
   * (a stdio server can spend tens of seconds in `initialize` while npx
   * resolves its package). Everything here is therefore inside the same guard
   * — including the release hook, whose installation is the last thing that
   * could previously escape it and reject the caller's session creation.
   */
  function composeAgentSetup(
    callerSetup: unknown,
  ): (agentCtx: unknown, explicitAgent?: unknown) => Promise<unknown> {
    return async (agentCtx, explicitAgent) => {
      const agent = resolveSetupAgent(agentCtx, explicitAgent)
      const cwd = agent?.session?.header?.cwd
      if (typeof cwd === 'string' && cwd.length > 0 && isAbsolute(cwd)) {
        try {
          const wsPath = canonicalize(cwd)
          const ws = manager.ensureWorkspace(wsPath, cwd)
          // Register with the transports that are connected *now*; `doRescan`'s
          // background settle callback rebuilds this agent's scope once each
          // transport lands. This is the posture the settings save routes already
          // take (see `api/workspaces.ts`), applied to the seam that decides how
          // long opening a session takes.
          await manager.rescanWorkspace(wsPath, { awaitConnect: false })
          ws.agents.add(agent as AgentLike)
          runtime.agentScopeState.set(agent as AgentLike, {
            wsPath,
            disposers: new Map(),
            restrictDisposer: undefined,
            restrictKey: undefined,
          })
          scope.rebuildAgentWorkspace(agent as AgentLike, wsPath)
          // Released through the agent's own context, so it runs exactly when the
          // session's scope unwinds. A hook that cannot be installed now degrades
          // the workspace tier with a warning instead of failing the session.
          if (isRecord(agentCtx) && typeof agentCtx.effect === 'function') {
            ;(agentCtx.effect as (callback: () => () => void, label: string) => void)(
              () => () => {
                manager.releaseWorkspace(wsPath, agent as AgentLike)
              },
              'mcp-workspace-release',
            )
          }
        } catch (error) {
          logger.warn(`${LOG_PREFIX}: workspace scoping failed for ${cwd}: ${errorText(error)}`)
        }
      }
      const setup = typeof callerSetup === 'function' ? (callerSetup as (a: unknown, b?: unknown) => unknown) : undefined
      return (await setup?.(agentCtx, agent)) ?? undefined
    }
  }

  function installAgentDecorators(agents: unknown): () => void {
    const wrapCreate = (original: (...args: unknown[]) => unknown, thisArg: unknown, args: unknown[]): unknown => {
      const options = args[0]
      if (!isRecord(options)) throw new TypeError(`${LOG_PREFIX}: agents.create() requires options`)
      return original.call(thisArg, { ...options, setup: composeAgentSetup(options.setup) })
    }
    const wrapResume = (original: (...args: unknown[]) => unknown, thisArg: unknown, args: unknown[]): unknown => {
      const options = args[0]
      if (!isRecord(options)) throw new TypeError(`${LOG_PREFIX}: agents.resume() requires options`)
      return original.call(thisArg, { ...options, setup: composeAgentSetup(options.setup) })
    }
    const create = installMethodWrapper(agents, 'create', wrapCreate)
    const resume = installMethodWrapper(agents, 'resume', wrapResume)
    return () => {
      resume.dispose()
      create.dispose()
    }
  }

  return { installAgentDecorators }
}
