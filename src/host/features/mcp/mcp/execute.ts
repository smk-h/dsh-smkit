/**
 * One host-side tool execution, shaped for both generations of `ctx.tools`.
 *
 * DSH 0.1.x exposed `execute(exec: ToolExecutionInput)`: one call described by
 * `callId`/`name`/`arguments`. 0.2.x replaced it with `execute(batch)`, which
 * takes raw model calls (`calls: ToolCallBlock[]`, arguments as the JSON string
 * the model produced) and answers one settled outcome per call.
 *
 * A caller that fills in **both** shapes works on either service: each release
 * reads the fields it knows and ignores the rest. That is deliberate — trying
 * one shape and retrying on failure would run the call twice on the other, and
 * these calls drive devices (a serial command, an SSH login), where a duplicate
 * is not a wasted millisecond but a second side effect.
 *
 * The two releases also answer differently, so the result is flattened here:
 * the batch answer becomes the first settled outcome, which is the one call the
 * caller asked for.
 */

import type { AgentLike, ToolExecOutcome, ToolsRegistry } from '../types.js'

/** One tool call, described the way this plugin's callers think of it. */
export interface ToolCallRequest {
  /** Pairs the call with its log record. */
  callId: string
  /** The outer call this one belongs to, when nested. */
  rootCallId?: string
  /** Exact public tool name, e.g. `mcp__board__serial_exec`. */
  name: string
  /** Parsed arguments; the services validate them against the tool schema. */
  arguments?: unknown
  /** The agent whose scope and context the call runs in. */
  agent: AgentLike
  /** Broker approval token (0.1.x guard). */
  parent?: unknown
  signal?: AbortSignal
}

/**
 * Run one tool call through whichever service this host provides.
 *
 * @param tools - the registry the call belongs to (agent-scoped or global).
 * @param call - the call to run.
 * @returns the settled outcome, flattened off a 0.2.x batch.
 */
export async function executeToolCall(
  tools: ToolsRegistry,
  call: ToolCallRequest,
): Promise<ToolExecOutcome> {
  const args = call.arguments ?? {}
  const outcome = await tools.execute({
    // 0.1.x reads these.
    callId: call.callId,
    ...(call.rootCallId === undefined ? {} : { rootCallId: call.rootCallId }),
    name: call.name,
    arguments: args,
    agent: call.agent,
    ...(call.parent === undefined ? {} : { parent: call.parent }),
    // 0.2.x requires a signal; a caller without one simply cannot cancel.
    signal: call.signal ?? new AbortController().signal,
    // 0.2.x reads this, and ignores the flat fields above.
    calls: [{
      type: 'tool-call',
      id: call.callId,
      name: call.name,
      arguments: JSON.stringify(args),
    }],
  })
  if (!Array.isArray(outcome.results)) return outcome
  const settled = outcome.results.find((entry) => entry?.result !== undefined)?.result
  return settled ?? { isError: true, error: { message: 'the tool batch settled no result' } }
}
