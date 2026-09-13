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

/** The prompt-assembly snapshot the hook inspects and rewrites. */
export interface PromptAssembly {
  sections: { name: string; text: string }[]
  tools: { name: string }[]
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
}

export interface BrokerRuntime {
  /** Install the broker surface; returns its disposer. */
  install(): () => void
  /** Toggle broker mode, persisting the setting (rolled back on write failure). */
  setOnDemandToolInjection(enabled: boolean): void
}

export function createBrokerRuntime(deps: BrokerRuntimeDeps): BrokerRuntime {
  const { runtime, logger, tools, on } = deps

  function install(): () => void {
    const approvedParents = new Set<unknown>()
    const unsupportedAgents = new WeakSet<object>()
    const warnedUnsupportedAgents = new WeakSet<object>()
    const disposers: (() => void)[] = []
    try {
      for (const definition of makeBrokerDefinitions(tools, approvedParents)) {
        disposers.push(tools.register(definition))
      }
      disposers.push(
        tools.guard((exec: ToolExecContext & { name: string }) => {
          if (!isMcpToolName(exec.name) || exec.agent === undefined) return undefined
          const agent = exec.agent as object
          if (unsupportedAgents.has(agent)) return undefined
          if (exec.parent !== undefined && approvedParents.has(exec.parent)) return undefined
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
      for (let index = disposers.length - 1; index >= 0; index -= 1) {
        try {
          disposers[index]()
        } catch {
          // Already released.
        }
      }
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

  return { install, setOnDemandToolInjection }
}
