/**
 * Running `openspec init` for one workspace.
 *
 * The panel's initialise button exists because an uninitialised workspace has
 * nothing to show and nothing to delete, and the one thing a user wants there
 * is to create it. This is the host half of that: spawn the CLI at the project
 * root and report what it said.
 *
 * Three decisions are worth naming:
 *
 * - **The project root, not the workspace.** `openspec init` writes at the
 *   repository root, which a workspace directory may sit below, so the spawn's
 *   working directory is derived the same way the inspection derives the store
 *   it is looking for. A spawn that ran in a nested workspace would create a
 *   second store the panel then reports as the only one.
 *
 * - **Nothing is left to a prompt.** Standard input is a closed pipe, the
 *   `--force` argument answers the legacy-file question, and the environment
 *   turns off the animation, the colour and the update check. A command with no
 *   terminal must never be able to block on one: a hung spawn would hold the
 *   button in its pending state until the timeout, which reads as a broken
 *   plugin rather than as a slow CLI.
 *
 * - **Failure is classified, not stringified.** "The CLI is not installed" and
 *   "the CLI ran and refused" need different words in the panel — one is an
 *   instruction, the other is the CLI's own diagnostic — so the outcome carries
 *   a stable code beside the message (the same shape the session delete uses
 *   for its refusals).
 */

import { execFile } from 'node:child_process'
import { LOG_PREFIX } from '../../platform/constants.js'
import { toErrorMessage } from '../../platform/util/text.js'
import {
  OPENSPEC_INIT_ARGS,
  OPENSPEC_INIT_COMMAND,
  OPENSPEC_INIT_COMMAND_LINE,
  OPENSPEC_INIT_FAILED_CODE,
  OPENSPEC_INIT_MISSING_CODE,
  OPENSPEC_INIT_MISSING_ERROR,
  OPENSPEC_INIT_OUTPUT_LIMIT,
  OPENSPEC_INIT_TIMEOUT_CODE,
  OPENSPEC_INIT_TIMEOUT_ERROR,
  OPENSPEC_INIT_TIMEOUT_MS,
} from './constants.js'
import { projectRootOf } from './inspect.js'
import type { OpenSpecRunner } from './types.js'
import type { LoggerLike } from '../../platform/types.js'

/** One run's outcome, ready to be answered with as-is. */
export interface OpenSpecInitOutcome {
  status: number
  body: Record<string, unknown>
}

/** What `initOpenSpec` needs: the logger, and how to run the command. */
export interface OpenSpecInitDeps {
  logger: LoggerLike
  run: OpenSpecRunner
}

/**
 * The environment the CLI is spawned with.
 *
 * All four variables are the CLI's own documented switches, and each removes a
 * way for a headless run to misbehave: the animation is a TTY decoration, the
 * colour codes are noise in a response body, and the update check is an
 * outbound registry query that would make an offline machine's `init` slower
 * for no benefit (`OPENSPEC_TELEMETRY=0` disables the check as well as the
 * telemetry).
 */
export function initEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    OPENSPEC_NO_ANIMATION: '1',
    OPENSPEC_NO_UPDATE_CHECK: '1',
    OPENSPEC_TELEMETRY: '0',
    NO_COLOR: '1',
  }
}

/**
 * The real runner: `execFile`, with the timeout and the output cap the panel's
 * answer is sized for.
 *
 * `shell` is on for Windows only. An npm-installed CLI is a `.cmd` shim there,
 * and Node refuses to execute one without a shell; on POSIX the shim is a
 * script with a shebang, which `execFile` runs directly. The command line is a
 * constant, so the shell has nothing of a caller's to interpret.
 */
export const runOpenSpec: OpenSpecRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        timeout: OPENSPEC_INIT_TIMEOUT_MS,
        maxBuffer: 1 << 20,
        windowsHide: true,
        shell: process.platform === 'win32',
      },
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stdout, stderr }))
        else resolve({ stdout, stderr })
      },
    )
  })

/**
 * The CLI's own words, as one block: each stream trimmed, the empty ones
 * dropped, the rest joined in order, and the whole thing capped. Enough to act
 * on, never a wall — and never a blank line per stream the command left empty,
 * which is what a naive join produces on the happy path.
 */
function combine(stdout: string, stderr: string): string {
  const text = [stdout, stderr]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join('\n')
  if (text.length <= OPENSPEC_INIT_OUTPUT_LIMIT) return text
  return `${text.slice(0, OPENSPEC_INIT_OUTPUT_LIMIT)}…`
}

/** One failed run as the answer to send: a status, a code, and the CLI's words. */
function failure(error: unknown): OpenSpecInitOutcome {
  const record: Record<string, unknown> =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
  const output = combine(String(record.stdout ?? ''), String(record.stderr ?? ''))
  if (record.code === 'ENOENT') {
    return { status: 503, body: { error: OPENSPEC_INIT_MISSING_ERROR, code: OPENSPEC_INIT_MISSING_CODE, output } }
  }
  if (record.killed === true || record.signal === 'SIGTERM') {
    return { status: 504, body: { error: OPENSPEC_INIT_TIMEOUT_ERROR, code: OPENSPEC_INIT_TIMEOUT_CODE, output } }
  }
  // The CLI ran and refused: its own diagnostic is the actionable text, so it
  // travels as the error and the panel shows it verbatim.
  return {
    status: 502,
    body: {
      error: output === '' ? toErrorMessage(error) : output,
      code: OPENSPEC_INIT_FAILED_CODE,
      output,
    },
  }
}

/**
 * Initialise one workspace.
 *
 * @param cwd - the workspace directory the panel was showing.
 * @param deps - the logger, and the runner to spawn through.
 */
export async function initOpenSpec(cwd: string, deps: OpenSpecInitDeps): Promise<OpenSpecInitOutcome> {
  const root = projectRootOf(cwd)
  try {
    const { stdout, stderr } = await deps.run(OPENSPEC_INIT_COMMAND, OPENSPEC_INIT_ARGS, {
      cwd: root,
      env: initEnv(),
    })
    deps.logger.info(`${LOG_PREFIX}: ran ${OPENSPEC_INIT_COMMAND_LINE} in ${root}`)
    return {
      status: 200,
      body: { ok: true, root, command: OPENSPEC_INIT_COMMAND_LINE, output: combine(stdout, stderr) },
    }
  } catch (error) {
    deps.logger.warn(`${LOG_PREFIX}: ${OPENSPEC_INIT_COMMAND_LINE} failed in ${root}`)
    return failure(error)
  }
}
