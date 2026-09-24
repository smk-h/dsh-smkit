/**
 * Upgrading the OpenSpec CLI and refreshing a workspace's files, streaming what
 * the commands say.
 *
 * The panel's update button exists because the tool the whole feature drives is
 * installed once per machine and goes stale independently of any workspace. The
 * CLI ships no self-update command — `openspec update` refreshes a workspace's
 * instruction files, not the binary — so a complete upgrade is two commands run
 * in order: `npm install -g @fission-ai/openspec@latest` to bring the installed
 * tool to the newest publish (see `OPENSPEC_UPDATE_ARGS` for why `install`
 * rather than `update`), then `openspec update` to rewrite this workspace's
 * generated files against the new version. The second is what makes the first
 * visible here; a newer CLI that leaves the workspace's skills stale has only
 * half upgraded anything.
 *
 * Both runs are reported as they happen rather than at the end. A global install
 * reaches the registry and can spend tens of seconds there, and a button that
 * shows nothing while it works reads to a user as a hung plugin. So each spawn's
 * stdout and stderr are split into lines and forwarded to `emit` as they arrive,
 * and a single closing `done` frame carries the verdict; the route turns each
 * frame into one SSE write.
 *
 * Two decisions are worth naming:
 *
 * - **The project root, not the workspace.** A global install ignores its working
 *   directory, but `openspec update` writes at the repository root, so both run
 *   there — the same root the inspection resolved — and the refresh lands where
 *   the store is.
 *
 * - **The refresh is skipped, not failed, where there is no store.** Upgrading
 *   the tool is meaningful on any machine; rewriting a workspace's files is not
 *   when that workspace never initialised OpenSpec. So the second command runs
 *   only when `<root>/openspec` exists, and the stream says so plainly instead of
 *   surfacing a CLI error for a state that is simply not applicable.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LOG_PREFIX } from '../../platform/constants.js'
import { initEnv } from './init.js'
import {
  OPENSPEC_REFRESH_ARGS,
  OPENSPEC_REFRESH_COMMAND,
  OPENSPEC_REFRESH_COMMAND_LINE,
  OPENSPEC_UPDATE_ARGS,
  OPENSPEC_UPDATE_COMMAND,
  OPENSPEC_UPDATE_COMMAND_LINE,
  OPENSPEC_UPDATE_TIMEOUT_MS,
  OPENSPEC_INIT_TIMEOUT_MS,
  STORE_DIR,
} from './constants.js'
import { projectRootOf } from './inspect.js'
import type {
  OpenSpecLineEmitter,
  OpenSpecRunResult,
  OpenSpecUpdateEmitter,
  OpenSpecUpdateRunner,
} from './types.js'
import type { LoggerLike } from '../../platform/types.js'

/** What `updateOpenSpec` needs: the logger, and how to stream each command. */
export interface OpenSpecUpdateDeps {
  logger: LoggerLike
  run: OpenSpecUpdateRunner
}

/**
 * The environment npm is spawned with.
 *
 * `NO_COLOR` keeps escape codes out of the streamed lines, and
 * `npm_config_progress=false` turns off the animated bar: over a pipe npm would
 * otherwise redraw one progress line, which arrives as control characters rather
 * than readable output. `update-notifier` is silenced so the upgrade is the only
 * registry query the run makes.
 */
export function updateEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    NO_COLOR: '1',
    npm_config_progress: 'false',
    npm_config_update_notifier: 'false',
  }
}

/**
 * Split a byte stream into whole lines, emitting each as it completes.
 *
 * npm writes its output in chunks that rarely end on a line boundary, so the
 * partial tail of one chunk is carried into the next; only the newline-terminated
 * part is emitted. {@link LineSplitter.tail} hands back whatever is left over, so
 * the caller can flush a final line npm never terminated with `\n` — it is still
 * a line the user should see.
 */
interface LineSplitter {
  push(chunk: string): void
  tail(): string
}

function makeLineSplitter(stream: 'out' | 'err', onLine: OpenSpecLineEmitter): LineSplitter {
  let pending = ''
  return {
    push(chunk: string): void {
      pending += chunk
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) onLine({ type: 'line', stream, text: line })
    },
    tail(): string {
      const rest = pending
      pending = ''
      return rest
    },
  }
}

/**
 * The real streamer: `spawn`, with its output piped line by line to `onLine`.
 *
 * `shell` is on for Windows only, for the same reason `init`'s runner sets it:
 * an npm-installed command is a `.cmd` shim there and Node refuses to execute one
 * without a shell. The command line is a constant, so the shell has nothing of a
 * caller's to interpret. The promise resolves with how the run ended; it never
 * rejects, because a failed command is an ordinary verdict the orchestrator
 * turns into a frame, not an exception to unwind.
 */
export const streamOpenSpecUpdate: OpenSpecUpdateRunner = (command, args, options, onLine) =>
  new Promise<OpenSpecRunResult>((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: process.platform === 'win32',
    })

    let killed = false
    let settled = false
    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGTERM')
    }, options.timeoutMs)

    const out = makeLineSplitter('out', onLine)
    const err = makeLineSplitter('err', onLine)
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk.toString()))

    // Flush whatever the last chunk left unterminated, in stream order, once the
    // pipes are dry.
    const settle = (result: OpenSpecRunResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const outRest = out.tail()
      const errRest = err.tail()
      if (outRest !== '') onLine({ type: 'line', stream: 'out', text: outRest })
      if (errRest !== '') onLine({ type: 'line', stream: 'err', text: errRest })
      resolve(result)
    }

    // A spawn that cannot start (the executable is not on PATH) surfaces as an
    // `error` event, not a non-zero exit.
    child.on('error', (error: NodeJS.ErrnoException) => {
      settle({ notFound: error.code === 'ENOENT', timedOut: false, exitCode: null })
    })

    child.on('close', (code) => {
      settle({ notFound: false, timedOut: killed, exitCode: code })
    })
  })

/**
 * Start one upgrade: the global install of the newest tool, then the
 * workspace's file refresh.
 *
 * @param cwd - the workspace directory the panel was showing.
 * @param deps - the logger, and the streamer to spawn each command through.
 * @param emit - where the whole event stream goes; the route writes it as SSE.
 */
export async function updateOpenSpec(
  cwd: string,
  deps: OpenSpecUpdateDeps,
  emit: OpenSpecUpdateEmitter,
): Promise<void> {
  const root = projectRootOf(cwd)

  // Step 1 — upgrade the installed CLI. The echoed command line is the panel's
  // running commentary: it names which of the two commands a line belongs to.
  emit({ type: 'line', stream: 'out', text: `$ ${OPENSPEC_UPDATE_COMMAND_LINE}` })
  const upgrade = await deps.run(OPENSPEC_UPDATE_COMMAND, OPENSPEC_UPDATE_ARGS, {
    cwd: root,
    env: updateEnv(),
    timeoutMs: OPENSPEC_UPDATE_TIMEOUT_MS,
  }, (line) => emit(line))

  if (upgrade.notFound) {
    emit({ type: 'line', stream: 'err', text: 'npm: command not found on PATH' })
    emit({ type: 'done', status: 'npm-missing', exitCode: null })
    return
  }
  if (upgrade.timedOut) {
    emit({ type: 'done', status: 'timeout', exitCode: null })
    return
  }
  if (upgrade.exitCode !== 0) {
    emit({ type: 'done', status: 'failed', exitCode: upgrade.exitCode })
    return
  }

  // Step 2 — rewrite this workspace's instruction files against the new CLI.
  // Skipped, not failed, where there is no store: upgrading the tool was still
  // the whole point there.
  if (!existsSync(join(root, STORE_DIR))) {
    emit({ type: 'line', stream: 'out', text: `no ${STORE_DIR}/ directory here; instruction-file refresh skipped` })
    emit({ type: 'done', status: 'ok', exitCode: 0 })
    return
  }

  deps.logger.info(`${LOG_PREFIX}: running ${OPENSPEC_REFRESH_COMMAND_LINE} in ${root}`)
  emit({ type: 'line', stream: 'out', text: `$ ${OPENSPEC_REFRESH_COMMAND_LINE}` })
  const refresh = await deps.run(OPENSPEC_REFRESH_COMMAND, OPENSPEC_REFRESH_ARGS, {
    cwd: root,
    env: initEnv(),
    timeoutMs: OPENSPEC_INIT_TIMEOUT_MS,
  }, (line) => emit(line))

  if (refresh.timedOut) emit({ type: 'done', status: 'timeout', exitCode: null })
  else if (refresh.exitCode !== 0 || refresh.notFound) emit({ type: 'done', status: 'failed', exitCode: refresh.exitCode })
  else emit({ type: 'done', status: 'ok', exitCode: 0 })
}
