/**
 * The shell's slash-command UI service (`ctx.commandUi`, `ui-commands`), read
 * through reflection, plus the one submission call a decoration makes.
 *
 * Reflect rather than `inject`: `ui-commands` is part of the web shell's own
 * bundle and publishes this service from DSH 0.2.x on, but a host whose shell
 * predates the decoration hook would otherwise unload the whole client entry
 * instead of costing the one panel that decorates a command. A reflection read
 * that answers `undefined` (or throws) leaves the feature standing down, which
 * is exactly the fallback `/mcp` already has — the command keeps working from
 * the keyboard, it just has no picker.
 */

import type { ClientContext, CommandUiLike } from './types'

/** The remote face used when the session binding carries no command submission. */
interface RemoteCommandsLike {
  commands?: {
    execute?(sessionId: string, line: string, attachments: readonly unknown[]): Promise<unknown>
  }
}

/**
 * Read the command UI service without declaring it.
 * @param ctx - the client context.
 * @returns the service when this host publishes one, otherwise undefined.
 */
export function commandUiOf(ctx: ClientContext): CommandUiLike | undefined {
  try {
    const commands = ctx.reflect?.get('commandUi') as CommandUiLike | undefined
    return typeof commands?.decorate === 'function' ? commands : undefined
  } catch {
    // A reflection read that throws resolves nothing: the feature stands down
    // and `/mcp` stays a keyboard-only command.
    return undefined
  }
}

/**
 * Submit one slash-command line to a session's agent.
 *
 * Two faces, because they arrive at different host versions: the session
 * binding's `command(line)` is the public client call (0.2.x), while the
 * reflection route through `remote.commands.execute` is what the shell's own
 * command UI falls back on. Either settles through the host's command executor,
 * so the lifecycle records and the result card are the same as a typed line —
 * the panel only saves the typing.
 *
 * Failures are swallowed on purpose: the picker has already closed, and there
 * is no surface here that could report anything the host would not also write
 * to the session log. A host with neither face simply runs nothing.
 *
 * @param ctx - the client context.
 * @param sessionId - the session whose agent receives the line.
 * @param line - the full command line, leading slash included.
 */
export function runCommandLine(ctx: ClientContext, sessionId: string, line: string): void {
  try {
    const session = ctx.sessions?.binding?.(sessionId)?.session
    if (typeof session?.command === 'function') {
      void Promise.resolve(session.command(line)).catch(() => {})
      return
    }
    const remote = ctx.reflect?.get('remote') as RemoteCommandsLike | undefined
    const execute = remote?.commands?.execute
    if (typeof execute === 'function') {
      void Promise.resolve(execute.call(remote?.commands, sessionId, line, [])).catch(() => {})
    }
  } catch {
    // See above: a refused submission is not this layer's to report.
  }
}
