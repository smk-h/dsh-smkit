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

/**
 * How one command is run.
 *
 * The plugin's only subprocess is `openspec init`, and it exists as a type so
 * the suites can assert the command line, the working directory and the
 * environment without spawning anything — nothing in a test should depend on
 * the CLI being installed, or write an `openspec/` directory into a fixture.
 */
export type OpenSpecRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>

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
}

/** This feature's handler shape: the platform's, plus this feature's deps. */
export type OpenSpecHandler = (
  req: RequestLike,
  res: ResponseLike,
  facts: RequestFacts,
  deps: OpenSpecApiDeps,
) => Promise<boolean> | boolean
