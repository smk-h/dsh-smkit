/**
 * Broker runtime installation.
 *
 * Installing adds the three broker tools, a guard that hides direct
 * `mcp__*` tools (except nested executions the broker approved), and a
 * `system-prompt/assemble` hook that strips MCP tools from the prompt — but
 * only for agents using **native** tool presentation. A `code`/`both` agent
 * keeps the full MCP surface, because the broker's value depends on the tools
 * being described rather than embedded in generated code.
 */

import { LOG_PREFIX } from '../constants.js'
import { saveState } from '../state.js'
import { registrationSignature } from '../mcp/tools.js'
import { serviceOf } from '../../../platform/util/services.js'
import { errorText } from '../../../platform/util/text.js'
import { isMcpToolName, makeBrokerDefinitions } from './definitions.js'
import { stubDefinition } from './shadow.js'
import type { BrokerCatalogEntry } from './definitions.js'
import type { Runtime } from '../runtime.js'
import type {
  AgentLike,
  LoggerLike,
  ServiceAccessor,
  ToolDefinition,
  ToolExecContext,
  ToolsRegistry,
} from '../types.js'

/**
 * The prompt-assembly snapshot the hook inspects and rewrites.
 *
 * `tools` is optional on purpose: dsh 0.2 passes only the presentation
 * (`sections`/`contexts`/`variables`) through this waterfall and appends the
 * registry-owned tool list afterwards, so a hook that assumed `tools` existed
 * threw on every turn. On those hosts the direct tools are hidden through the
 * registry's deferred-loading marker instead.
 */
export interface PromptAssembly {
  sections: { name: string; text: string }[]
  tools?: { name: string }[]
}

export interface PromptAssembleContext {
  agent?: unknown
  scope?: unknown
  /** `{ provider, model }` of the route this assembly is for, on dsh 0.2.2+. */
  modelSelection?: unknown
}

export interface BrokerRuntimeDeps {
  runtime: Runtime
  logger: LoggerLike
  tools: ToolsRegistry
  /** Subscribe to a Cordis event; returns the disposer. */
  on(
    event: string,
    handler: (
      assembly: PromptAssembly,
      context: PromptAssembleContext,
      next: () => Promise<PromptAssembly>,
    ) => Promise<PromptAssembly>,
    options?: { prepend?: boolean; global?: boolean },
  ): () => void
  /**
   * Re-register every live MCP tool so the deferred-loading marker matches
   * `runtime.deferDirectTools`. The flag is part of a registration's signature,
   * so this is what actually changes the model request after a toggle.
   */
  resyncRegistrations(): void
  /** Optional services, for `llm.resolveModelInfo` on hosts that expose it. */
  services?: ServiceAccessor | null
  /**
   * The MCP catalogue as the connection records hold it — descriptions and
   * schemas of the **full** definitions, even when the registry row is a stub.
   */
  catalogOf(agent: AgentLike): BrokerCatalogEntry[]
  /**
   * Tell the host this agent's route can (or cannot) defer loading. The host
   * records it and re-registers that agent's workspace tools, because a stub
   * and a full definition have different signatures.
   */
  applyAgentStubMode(agent: object, stubbed: boolean): void
}

export interface BrokerRuntime {
  /** Install the broker surface; returns its disposer. */
  install(): () => void
  /** Toggle broker mode, persisting the setting (rolled back on write failure). */
  setOnDemandToolInjection(enabled: boolean): void
  /**
   * Approve one host-side call for the guard — the `/mcp` command.
   *
   * `callId` is the identity that survives on every host generation: dsh 0.1
   * carries the minted `token` through as the call's `parent`, dsh 0.2's batch
   * entry point drops it but keeps `calls[].id`, which the caller sets from the
   * same value. Both are registered, so the guard waves the call through either
   * way. While broker mode is off there is no guard to satisfy; `release`
   * stays a no-op either way.
   */
  approveDirectCall(callId: string): { token: unknown; release: () => void }
}

export function createBrokerRuntime(deps: BrokerRuntimeDeps): BrokerRuntime {
  const { runtime, logger, tools, on, services, catalogOf, applyAgentStubMode } = deps
  // Hoisted out of `install()`: the guard and a host-side caller (the `/mcp`
  // command) have to agree on the same set across install/uninstall cycles.
  const approvedParents = new Set<unknown>()
  // dsh 0.2's batch entry point (`tools.execute({ calls })`) carries neither
  // `parent` nor the flat fields, so the token above is invisible to the guard
  // there. The batch keeps the caller's `callId` (`calls[].id`), and that is the
  // identity both host-side callers already pass, so approvals are tracked by
  // call id as well — one mechanism per generation, same guard.
  const approvedCallIds = new Set<string>()
  let hostCallSeq = 0
  /** Per-agent shadow rows for the **global** tools (a shared registry). */
  const agentShadows = new Map<object, Map<string, { dispose: () => void; signature: string; sourceSignature: string }>>()

  function disposeAgentShadows(agent: object): void {
    const rows = agentShadows.get(agent)
    if (rows === undefined) return
    agentShadows.delete(agent)
    for (const row of rows.values()) {
      try {
        row.dispose()
      } catch {
        // The agent's scope may already be gone.
      }
    }
  }

  function disposeAllShadows(): void {
    for (const agent of [...agentShadows.keys()]) disposeAgentShadows(agent)
  }

  /**
   * Does the route carry tools through the session (`toolUpdate` declared), or
   * does the core send every tool immediately?
   *
   * Any doubt — no selection, no llm service, a throw — answers `true`, which
   * keeps the pre-existing shape (marker only). The verdict is resolved per
   * assembly and never persisted.
   */
  async function routeHonoursToolUpdate(modelSelection: unknown): Promise<boolean> {
    const selection = modelSelection as { provider?: unknown; model?: unknown } | undefined
    if (selection === undefined || selection === null) return true
    if (typeof selection.provider !== 'string' || typeof selection.model !== 'string') return true
    const llm = serviceOf(services, 'llm') as
      | {
          resolveModelInfo?: (
            provider: string,
            model: string,
            signal?: unknown,
          ) => Promise<{ toolUpdate?: unknown } | undefined>
        }
      | undefined
    if (llm === undefined || typeof llm.resolveModelInfo !== 'function') return true
    try {
      const info = await llm.resolveModelInfo(selection.provider, selection.model)
      return info?.toolUpdate === 'in-history' || info?.toolUpdate === 'addition-only'
    } catch (error) {
      logger.warn(
        `${LOG_PREFIX}: model-info resolution failed for ${selection.provider}/${selection.model}; keeping the full direct MCP surface (${errorText(error)})`,
      )
      return true
    }
  }

  /**
   * Replace the global MCP definitions this agent sees with stubs.
   *
   * Workspace tools are registered into the agent's own registry, so their
   * stubbing happens at registration (`runtime.stubAgents`); the global tier is
   * shared by every agent, and the only per-agent lever is a same-name
   * registration in the agent's scope. Rows are diffed by both signatures: the
   * stub's own, and the full definition it was derived from, so a server that
   * changes its schema refreshes the stub too.
   */
  function syncAgentShadows(agent: object, stubbed: boolean): void {
    if (!stubbed) {
      disposeAgentShadows(agent)
      return
    }
    const registry = (agent as { ctx?: { tools?: ToolsRegistry } }).ctx?.tools
    if (registry === undefined || typeof registry.register !== 'function') {
      disposeAgentShadows(agent)
      return
    }
    const visible = new Set(
      tools
        .schemas(agent as AgentLike)
        .filter((schema) => isMcpToolName(schema.name))
        .map((schema) => schema.name),
    )
    const desired = new Map<string, { stub: ToolDefinition; signature: string; sourceSignature: string }>()
    for (const conn of runtime.live.values()) {
      for (const entry of conn.tools?.values() ?? []) {
        const base = entry.definition
        if (base === undefined || !visible.has(base.name) || desired.has(base.name)) continue
        const stub = stubDefinition(base)
        desired.set(stub.name, {
          stub,
          signature: registrationSignature(stub),
          sourceSignature: registrationSignature(base),
        })
      }
    }
    let rows = agentShadows.get(agent)
    if (desired.size === 0) {
      disposeAgentShadows(agent)
      return
    }
    if (rows === undefined) {
      rows = new Map()
      agentShadows.set(agent, rows)
    }
    for (const [name, row] of rows) {
      const next = desired.get(name)
      if (next !== undefined && next.signature === row.signature && next.sourceSignature === row.sourceSignature) continue
      try {
        row.dispose()
      } catch {
        // Already released.
      }
      rows.delete(name)
    }
    for (const [name, next] of desired) {
      if (rows.has(name)) continue
      try {
        rows.set(name, { ...next, dispose: registry.register(next.stub) })
      } catch (error) {
        logger.warn(`${LOG_PREFIX}: could not register a shadow stub for ${name} (${errorText(error)})`)
      }
    }
  }

  function install(): () => void {
    const unsupportedAgents = new WeakSet<object>()
    const warnedUnsupportedAgents = new WeakSet<object>()
    const disposers: (() => void)[] = []
    try {
      // Registrations made while the broker is on carry the host's deferred
      // loading hint, which is what keeps the direct tools out of the model
      // request on hosts that no longer hand the tool list to this waterfall.
      runtime.deferDirectTools = true
      deps.resyncRegistrations()
      for (const definition of makeBrokerDefinitions(tools, approvedParents, approvedCallIds, catalogOf)) {
        disposers.push(tools.register(definition))
      }
      disposers.push(
        tools.guard((exec: ToolExecContext & { name: string }) => {
          if (!isMcpToolName(exec.name) || exec.agent === undefined) return undefined
          const agent = exec.agent as object
          if (unsupportedAgents.has(agent)) return undefined
          if (exec.parent !== undefined && approvedParents.has(exec.parent)) return undefined
          if (approvedCallIds.has(exec.callId)) return undefined
          return `direct MCP tool "${exec.name}" is hidden while on-demand MCP tools are enabled; use mcp_execute_tool`
        }),
      )
      disposers.push(
        on(
          'system-prompt/assemble',
          async (_assembly, context, next) => {
            // Resolve the route **before** the waterfall: what the core does
            // with the deferred marker after this returns depends on it, and a
            // route without `toolUpdate` strips the marker (so those agents
            // need stubs instead). Any doubt answers "honours" — the older,
            // safe shape.
            const honours = await routeHonoursToolUpdate(context.modelSelection)
            const assembled = await next()
            const agent = (context.agent ?? context.scope) as object | undefined
            if (!agent || (typeof agent !== 'object' && typeof agent !== 'function')) return assembled
            const hasCodeSdk = assembled.sections.some(
              (section) => section.name === 'tools:sdk' && section.text.trim() !== '',
            )
            if (hasCodeSdk) {
              unsupportedAgents.add(agent)
              if (!warnedUnsupportedAgents.has(agent)) {
                warnedUnsupportedAgents.add(agent)
                logger.warn(
                  `${LOG_PREFIX}: on-demand MCP tools require native presentation; keeping the full MCP tool surface for a code/both agent`,
                )
              }
              // A code/PTC agent keeps the full catalogue; make sure a previous
              // native turn's stubs are not left behind.
              applyAgentStubMode(agent, false)
              syncAgentShadows(agent, false)
              return assembled
            }
            unsupportedAgents.delete(agent)
            const stubbed = runtime.deferDirectTools && !honours
            applyAgentStubMode(agent, stubbed)
            syncAgentShadows(agent, stubbed)
            // Hosts before 0.2 still hand the tool list to this waterfall; there
            // the broker's own filter is what hides the direct tools. A 0.2 host
            // sends only the presentation, and the registry-side marker (or the
            // stub) already covers it — touching `tools` here would throw.
            if (!Array.isArray(assembled.tools)) return assembled
            return { ...assembled, tools: assembled.tools.filter((tool) => !isMcpToolName(tool.name)) }
          },
          { prepend: true, global: true },
        ),
      )
    } catch (error) {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {
          // Best-effort rollback of a partially installed runtime.
        }
      }
      throw error
    }
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      approvedParents.clear()
      approvedCallIds.clear()
      for (let index = disposers.length - 1; index >= 0; index -= 1) {
        try {
          disposers[index]()
        } catch {
          // Already released.
        }
      }
      // Direct tools are the model's again: drop every stub, tell the host the
      // agents are no longer stubbed (that re-registers their workspace tools),
      // then drop the marker and re-register the global tier.
      disposeAllShadows()
      for (const agent of [...runtime.agentScopeState.keys()]) applyAgentStubMode(agent, false)
      runtime.deferDirectTools = false
      deps.resyncRegistrations()
    }
  }

  function setOnDemandToolInjection(enabled: boolean): void {
    if (enabled === runtime.state.onDemandToolInjection) return
    const previous = runtime.state.onDemandToolInjection
    let installed: (() => void) | null = null
    if (enabled) installed = install()
    runtime.state.onDemandToolInjection = enabled
    try {
      saveState(runtime.state)
    } catch (error) {
      runtime.state.onDemandToolInjection = previous
      installed?.()
      throw error
    }
    if (enabled) {
      runtime.brokerRuntimeDispose = installed
    } else {
      runtime.brokerRuntimeDispose?.()
      runtime.brokerRuntimeDispose = null
    }
  }

  function approveDirectCall(callId: string): { token: unknown; release: () => void } {
    const token = Symbol(`host-call-${hostCallSeq++}`)
    approvedParents.add(token)
    approvedCallIds.add(callId)
    return {
      token,
      release: () => {
        approvedParents.delete(token)
        approvedCallIds.delete(callId)
      },
    }
  }

  return { install, setOnDemandToolInjection, approveDirectCall }
}
