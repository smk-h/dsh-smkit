/**
 * Types the OpenSpec feature owns.
 *
 * The feature reads the workspace's filesystem directly (see `inspect.ts` for
 * why) and, for one action, runs the OpenSpec CLI. The two things a handler
 * therefore needs on top of the platform's own request shapes are the logger
 * that action reports through, and the seam it is run through — which is
 * declared here rather than beside the runner so a test can replace it without
 * importing the runner's own module.
 */

import type { RequestFacts } from '../../platform/routes.js'
import type { LoggerLike, RequestLike, ResponseLike } from '../../platform/types.js'
import type { OpenSpecUpdateEvent, OpenSpecUpdateLine } from '../../../shared/openspec/contract.js'

/**
 * How one command is run.
 *
 * The plugin's only buffered subprocess is `openspec init`, and it exists as a
 * type so the suites can assert the command line, the working directory and the
 * environment without spawning anything — nothing in a test should depend on
 * the CLI being installed, or write an `openspec/` directory into a fixture.
 */
export type OpenSpecRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>

/**
 * How the upgrade reports each line as it is produced.
 *
 * The update route answers with an event stream rather than a result, so the
 * runner's contract is "hand me the next line": the orchestrator forwards each
 * to the route (which writes one `data:` frame per line) and decides the closing
 * `done` frame itself once the run's verdict is in.
 */
export type OpenSpecLineEmitter = (line: OpenSpecUpdateLine) => void

/**
 * Where the upgrade's whole event stream goes.
 *
 * The orchestrator hands each frame — every line and the closing verdict — to
 * this, and the route turns each into one SSE write, ending the response on the
 * `done` frame.
 */
export type OpenSpecUpdateEmitter = (event: OpenSpecUpdateEvent) => void

/**
 * How one command in the upgrade sequence ended.
 *
 * The three flags are the ways a spawn can fail that the panel must tell apart —
 * the executable was not on PATH, the run was killed for taking too long, or it
 * ran and exited non-zero — and the exit code for the last. The orchestrator
 * turns them into the stream's closing status; the runner never decides that
 * itself, because it runs one command of a sequence, not the whole thing.
 */
export interface OpenSpecRunResult {
  notFound: boolean
  timedOut: boolean
  exitCode: number | null
}

/**
 * How one command in the upgrade is spawned and streamed.
 *
 * The sibling of {@link OpenSpecRunner} for the actions long enough to need live
 * output: it never returns the output (that arrives through `onLine`, as it is
 * produced), only the verdict. A test replaces it with a function that calls
 * `onLine` a few times and resolves, so the suite asserts the streamed lines and
 * the command lines without running npm or the CLI.
 */
export type OpenSpecUpdateRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
  onLine: OpenSpecLineEmitter,
) => Promise<OpenSpecRunResult>

/** What the OpenSpec route handler is built with. */
export interface OpenSpecApiDeps {
  /** The host logger; a removal or a run is announced here. */
  logger: LoggerLike
  /**
   * The runner `POST /openspec/init` spawns through. Optional, and absent in
   * production: the handler falls back to the real `execFile` runner, so a
   * composition that wires the handler by hand cannot forget it.
   */
  run?: OpenSpecRunner
  /**
   * The runner `POST /openspec/update` spawns through. Optional for the same
   * reason as `run`: production falls back to the real `spawn`-based streamer.
   */
  runUpdate?: OpenSpecUpdateRunner
}

/** This feature's handler shape: the platform's, plus this feature's deps. */
export type OpenSpecHandler = (
  req: RequestLike,
  res: ResponseLike,
  facts: RequestFacts,
  deps: OpenSpecApiDeps,
) => Promise<boolean> | boolean
