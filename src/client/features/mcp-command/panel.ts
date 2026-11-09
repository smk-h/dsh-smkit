/**
 * The `/mcp` picker: typing `/mcp` and pressing Tab (or picking it from the
 * slash menu) opens the shell's shared select panel — the same one `/model` and
 * `/permission` open — listing the tools this project can reach.
 *
 * Why a picker and not a second level of the menu: the composer's `/` trigger
 * ends at the command name. Once `/mcp` claims its input (`input.hint`), the
 * rest of the line is plain text, so there is no hook that could open a panel
 * after `help`. One panel with a search box covers both levels instead — group a
 * server's tools under its name, type a fragment to filter, pick a row, and the
 * row's own command line is submitted.
 *
 * What the panel never does: invent a command. It decorates the HOST `/mcp`
 * command, so a host without the command (an old shell, a trimmed profile) has
 * nothing to decorate and this feature stays out of the way; the command's own
 * `list` / `help` / `call` parsing, its broker approval and its error cards stay
 * the host's.
 */

import { commandUiOf, runCommandLine } from '../../platform/command-ui'
import { setComposerLine } from '../../platform/composer'
import { CALL_LINE_PREFIX, commandRows, projectTools } from './rows'
import type { ServerView, WorkspaceView } from '../../../shared/mcp/contract'
import type {
  ApiResult,
  ClientContext,
  ClientDeps,
  CommandUiLike,
  Translator,
} from '../../platform/types'

/** The host command this feature decorates; the name the user types. */
const MCP_COMMAND = 'mcp'

/**
 * The context as a Cordis fork point: `inject(deps, callback)` runs the
 * callback once those services exist — how an outside bundle waits for a shell
 * service that mounts after it. Absent on the offline harness and on a shell
 * that publishes no fork point.
 */
interface InjectableContext extends ClientContext {
  inject?(deps: readonly string[], callback: (scope: ClientContext) => void): unknown
}

/** What mounting the panel needs: the context, the wire channel and the copy. */
export interface McpCommandPanelDeps {
  ctx: ClientContext
  deps: ClientDeps
  t: Translator
}

/** One list out of a wire answer, or nothing when that call failed. */
function listOf<T>(result: ApiResult, key: string): readonly T[] {
  const value = result.ok ? result.body[key] : undefined
  return Array.isArray(value) ? (value as T[]) : []
}

/**
 * The session's working directory — the project whose servers it can see.
 * Absent for a session the list has not reported yet, in which case the scope
 * falls back to the global tier alone.
 */
function cwdOf(ctx: ClientContext, sessionId: string): string | undefined {
  try {
    const cwd = ctx.sessions?.list?.getSnapshot()?.byId?.[sessionId]?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  } catch {
    // A sessions store that answers by throwing costs the scope, not the panel.
    return undefined
  }
}

/**
 * Decorate the host `/mcp` command with the tool picker.
 *
 * @param panel - the context, the wire channel and the feature's bound `t`.
 * @returns the decoration's disposer, or a no-op when the host has no command UI.
 */
export function registerMcpCommandPanel({ ctx, deps, t }: McpCommandPanelDeps): () => void {
  // The shell's own client plugins mount after an outside bundle does, so the
  // service is normally not there yet when this runs. `inject` waits for it;
  // a context without `inject` (the offline harness, an older shell) takes the
  // immediate read and stands down when it finds nothing.
  const present = commandUiOf(ctx)
  if (present !== undefined) return decorateWith(present, ctx, deps, t)
  const inject = (ctx as InjectableContext).inject
  if (typeof inject !== 'function') return () => {}
  inject.call(ctx, ['commandUi'], (scope) => {
    const commandUi = commandUiOf(scope)
    if (commandUi === undefined) return
    scope.effect(() => decorateWith(commandUi, scope, deps, t), 'smkit: mcp/command panel (late)')
  })
  return () => {}
}

/**
 * Hang the picker on the host command once the service is in hand.
 *
 * @param commandUi - the shell's command UI service.
 * @param ctx - the context the panel reads its sessions and reflection from.
 * @param deps - the wire channel.
 * @param t - the feature's bound `t`.
 * @returns the decoration's disposer, or a no-op when the host refuses it.
 */
function decorateWith(
  commandUi: CommandUiLike,
  ctx: ClientContext,
  deps: ClientDeps,
  t: Translator,
): () => void {
  try {
    return commandUi.decorate({
      name: MCP_COMMAND,
      // The host command's own presence decides the row; nothing here can make
      // the menu show a command that does not exist. A session always gets the
      // panel, because the scope can change under it (a server connects later).
      available: () => true,
      ui: {
        kind: 'popupSelect',
        // The model picker's own mode: matches across a group's labels, so
        // "ssh" finds `serial_exec` inside the transport server's group too.
        searchMode: 'fuzzy-label',
        searchLabels: () => ({
          placeholder: t('searchPlaceholder'),
          empty: t('empty'),
          noResults: t('noResults'),
        }),
        async options(session, signal) {
          // The settings page's two sources, read once per opening rather than
          // polled: the panel is a momentary surface, and a stale row only costs
          // a re-open (the host command re-checks the tool name anyway).
          const [serversResult, workspacesResult] = await Promise.all([
            deps.api('/servers', { signal }),
            deps.api('/workspaces', { signal }),
          ])
          if (!serversResult.ok && !workspacesResult.ok) throw new Error(t('loadFailed'))
          const scope = projectTools(
            listOf<ServerView>(serversResult, 'servers'),
            listOf<WorkspaceView>(workspacesResult, 'workspaces'),
            cwdOf(ctx, session.sessionId),
          )
          return commandRows(scope, t)
        },
        onSelect(option, session) {
          // A call row completes the line instead of running it: the line
          // already carries every declared parameter with a placeholder value,
          // so the reader replaces the `…`s, drops what this call does not
          // need, and presses Enter. Nothing runs on the way in.
          if (option.id.startsWith(CALL_LINE_PREFIX)) {
            setComposerLine(ctx, session.sessionId, option.id)
            return
          }
          runCommandLine(ctx, session.sessionId, option.id)
        },
      },
    })
  } catch {
    // A host that rejects the registration (an older decoration shape) only
    // loses the panel; the command itself is untouched.
    return () => {}
  }
}
