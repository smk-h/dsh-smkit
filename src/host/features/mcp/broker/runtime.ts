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
import { isMcpToolName, makeBrokerDefinitions } from './definitions.js'
import type { Runtime } from '../runtime.js'
import type { LoggerLike, ToolExecContext, ToolsRegistry } from '../types.js'

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
  const { runtime, logger, tools, on } = deps
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
      for (const definition of makeBrokerDefinitions(tools, approvedParents, approvedCallIds)) {
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
              return assembled
            }
            unsupportedAgents.delete(agent)
            // Hosts before 0.2 still hand the tool list to this waterfall; there
            // the broker's own filter is what hides the direct tools. A 0.2 host
            // sends only the presentation, and the registry-side deferred marker
            // already covers it — touching `tools` here would throw.
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
      // Direct tools are the model's again: drop the marker and re-register.
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
