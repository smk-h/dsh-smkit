/**
 * Constants of the OpenSpec feature: where `openspec init` writes, and the
 * bounds the inspection walks stay inside.
 *
 * Two things are mirrored here rather than imported:
 *
 * 1. **The store's layout.** OpenSpec owns `openspec/specs`, `openspec/changes`
 *    and `openspec/config.yaml`; the older `project.md`/`AGENTS.md` spellings
 *    are still listed, because a store written by an earlier CLI is still a
 *    store this panel should describe rather than mislabel as empty.
 * 2. **The tool table.** `openspec init` writes a `skills/openspec-…` directory
 *    and a tool-specific `opsx*` command file for each selected tool; the table
 *    below is that mapping, taken from the CLI's own "supported tools" page. It
 *    is data, not code: a tool the table does not name is simply not reported,
 *    and nothing else in the feature changes shape.
 *
 * The host publishes no helper for either, and this plugin's single peer
 * dependency is `@deepseek-ai/cordis` — so the mapping is mirrored the same way
 * the skills feature mirrors the four skill roots.
 */

/** The store directory, relative to the project root. */
export const STORE_DIR = 'openspec'

/**
 * The CLI the panel's initialise button drives, and the arguments it is given.
 *
 * `--tools agents` is the target this plugin wants and the reason `--tools` is
 * passed at all: the flag is what makes `openspec init` non-interactive, and
 * `agents` is the vendor-neutral target that writes `.agents/skills` — one of
 * the two project-side roots DSH itself loads skills from, so what init creates
 * is immediately visible to the harness and to this plugin's own panel.
 * (`agent`, without the s, is not an id the CLI accepts: `.agent/` belongs to
 * Antigravity, whose id is `antigravity`.)
 *
 * `--force` is here for the same reason: init prompts before cleaning files an
 * older release left behind, and this spawn has no terminal to answer with, so
 * the automatic branch is the only branch it can take.
 */
export const OPENSPEC_INIT_COMMAND = 'openspec'
export const OPENSPEC_INIT_ARGS: readonly string[] = ['init', '--tools', 'agents', '--force']

/** The command as the panel shows it, so what is offered is what is run. */
export const OPENSPEC_INIT_COMMAND_LINE = `${OPENSPEC_INIT_COMMAND} ${OPENSPEC_INIT_ARGS.join(' ')}`

/**
 * The npm package the CLI is installed from, and the two commands the panel's
 * update button runs, in order.
 *
 * The CLI ships no self-update command — `openspec update` refreshes a
 * workspace's instruction files, not the installed binary — so upgrading the
 * tool is npm's job, and a newer tool then leaves the workspace's own generated
 * files behind until `openspec update` rewrites them. The button does both: the
 * global upgrade, then the local refresh.
 *
 * The upgrade is `install`, not `update`, and it pins `@latest`. `npm update -g`
 * moves an installed package only within the range it was installed under — a
 * global install has no `package.json` to widen, so npm reads it as a caret
 * range and a major bump is never offered. `install` is what the range cannot
 * veto: it resolves the `latest` dist-tag outright, which is the one thing the
 * button is for, and it is also the command that installs the tool where none
 * was yet. It cannot downgrade a deliberate pre-release, because `latest` is
 * only ever the newest stable publish.
 *
 * Each command line is fixed and carries no caller input, which is what lets
 * them run through a shell on Windows (where npm and the CLI are `.cmd` shims)
 * with nothing of a request's to interpret.
 */
export const OPENSPEC_PACKAGE = '@fission-ai/openspec'
export const OPENSPEC_PACKAGE_LATEST = `${OPENSPEC_PACKAGE}@latest`
export const OPENSPEC_UPDATE_COMMAND = 'npm'
export const OPENSPEC_UPDATE_ARGS: readonly string[] = ['install', '-g', OPENSPEC_PACKAGE_LATEST]

/** The refresh that follows the upgrade: rewrite this workspace's files. */
export const OPENSPEC_REFRESH_COMMAND = 'openspec'
export const OPENSPEC_REFRESH_ARGS: readonly string[] = ['update']

/** Each command as the panel shows it, so what is offered is what runs. */
export const OPENSPEC_UPDATE_COMMAND_LINE = `${OPENSPEC_UPDATE_COMMAND} ${OPENSPEC_UPDATE_ARGS.join(' ')}`
export const OPENSPEC_REFRESH_COMMAND_LINE = `${OPENSPEC_REFRESH_COMMAND} ${OPENSPEC_REFRESH_ARGS.join(' ')}`

/**
 * How long the npm upgrade may take before it is killed.
 *
 * Unlike `init`, this one reaches the registry over the network — resolving the
 * `latest` dist-tag, then fetching and linking — so its budget is a real one
 * rather than a runaway guard: a slow connection can legitimately spend a minute
 * there. Past this the run is assumed stuck and reported as a timeout. The
 * refresh that follows is local file work, so it shares `init`'s shorter bound.
 */
export const OPENSPEC_UPDATE_TIMEOUT_MS = 180_000

/**
 * How long the CLI may take before it is killed. Generating instruction files
 * is local work — no registry query is made (see `initEnv`) — so this is a
 * runaway guard, not a budget.
 */
export const OPENSPEC_INIT_TIMEOUT_MS = 60_000

/** How much of the CLI's own output travels back to the panel. */
export const OPENSPEC_INIT_OUTPUT_LIMIT = 1_200

/**
 * The prefix every generated skill directory carries (`openspec-propose`,
 * `openspec-apply-change`, …). Matching the prefix rather than a list of the
 * twelve names keeps a profile with a subset of the workflows — or a future
 * release that adds one — reporting the same way.
 */
export const SKILL_PREFIX = 'openspec-'

/**
 * The prefix every generated command entry carries: `opsx-propose.md` for the
 * flat layouts, `opsx/` for the tools that namespace their commands (Claude
 * Code, CodeBuddy, Qoder, …). Both are found by this one prefix.
 */
export const COMMAND_PREFIX = 'opsx'

/**
 * The ownership marker the CLI leaves in a directory it manages.
 *
 * It is neither a skill nor a command — it is how `openspec update` knows which
 * directories are its business — and that is exactly why a removal has to take
 * it: left behind, it is what brings the entries back on the next
 * `openspec init`/`update`, which reads as a delete that did not stick.
 */
export const MARKER_FILE_NAME = '.openspec-target'

/** The name of the ignore file one directory keeps for the entries it holds. */
export const IGNORE_FILE_NAME = '.gitignore'

/**
 * The comment heading the lines this feature writes into a directory's own
 * `.gitignore`.
 *
 * It is a signature as much as a comment: it is how the file says which block
 * came from `dsh-smkit`, and how a later removal knows the block is its business
 * — and when every line under it is gone, the heading goes with them.
 */
export const OPENSPEC_IGNORE_HEADER = '# Added by dsh-smkit: OpenSpec'

/** One entry of the store's known layout. */
export interface OpenSpecStorePart {
  /** The name inside `openspec/`. */
  name: string
  kind: 'dir' | 'file'
  /**
   * Whether the layout is incomplete without it.
   *
   * The distinction is the whole reason the layout is mirrored here rather than
   * read off the tree: a store is *described* by what is on disk, but it is
   * only *judged* by what the CLI is supposed to have written. `specs`,
   * `changes` and `config.yaml` are what a current `openspec init` creates, so
   * one of them missing means a store that is half gone or half made; the two
   * markdown names below are what earlier releases left at the store's root, so
   * their absence is simply a store written by a later CLI and no cause to say
   * anything.
   */
  required: boolean
}

/**
 * The parts of the store's layout, in the order the CLI writes them.
 *
 * `specs` and `changes` are the two halves that matter; `config.yaml` is the
 * current CLI's own configuration, and the two markdown names are the earlier
 * releases' spellings of it (`project.md`, `AGENTS.md`).
 */
export const STORE_PARTS: readonly OpenSpecStorePart[] = [
  { name: 'specs', kind: 'dir', required: true },
  { name: 'changes', kind: 'dir', required: true },
  { name: 'config.yaml', kind: 'file', required: true },
  { name: 'project.md', kind: 'file', required: false },
  { name: 'AGENTS.md', kind: 'file', required: false },
]

/**
 * How deep below `openspec/` the tree is drawn.
 *
 * Deep enough for the store's own deepest shape — a change's delta spec sits at
 * `changes/<id>/specs/<capability>/spec.md`, five levels down — so a normal
 * store is drawn whole and the limit is only ever a runaway guard.
 */
export const MAX_TREE_DEPTH = 6

/**
 * How many nodes the tree may carry before the answer is reported as truncated.
 * A store of a few hundred files is ordinary; this is the point past which the
 * panel says it stopped measuring rather than presenting a floor as a total.
 */
export const MAX_TREE_NODES = 800

/** How far below an artifact entry (a skill directory) its size is measured. */
export const MAX_MEASURE_DEPTH = 3

/** How many entries of one artifact directory are listed. */
export const MAX_ARTIFACT_ENTRIES = 60

/**
 * One `openspec init --tools <id>` target.
 *
 * `skills` and `commands` are project-relative directories; what the tool wrote
 * there is found by prefix (`openspec-` and `opsx`), so the table never has to
 * track the twelve workflow names. `extra` names a file the tool adds that
 * carries neither prefix's shape — it is listed by exact path, and it is the
 * only way a file the table does not name is ever proposed for deletion.
 */
export interface OpenSpecTool {
  /** The id `--tools` accepts. */
  id: string
  /** Directories holding the tool's `openspec-*` skill directories. */
  skills: readonly string[]
  /** Directories holding the tool's `opsx*` command entries. */
  commands: readonly string[]
  /** Exact project-relative files the tool adds beside those. */
  extra: readonly string[]
}

/** Shorthand for one table row: most tools have one directory of each kind. */
function tool(
  id: string,
  skills: readonly string[],
  commands: readonly string[] = [],
  extra: readonly string[] = [],
): OpenSpecTool {
  return { id, skills, commands, extra }
}

/**
 * Every tool `openspec init` can configure.
 *
 * The two entries that matter to DSH come first — `.agents/skills` is one of
 * the four roots DSH itself loads skills from, and `.dsh/skills` is the other
 * project-side root this plugin manages, where a hand-copied skill would land —
 * so the panel reads them at the top of the list rather than under a dozen
 * directories the user's editor is not even installed.
 *
 * Deliberate omissions, both because a delete here would reach past OpenSpec's
 * own output:
 *
 * - `.github/workflows/copilot-setup-steps.yml`, which the Copilot cloud agent
 *   option writes into a repository's CI. The file is a workflow first and an
 *   OpenSpec artifact second, and a project may well have edited it;
 * - `~/.minimax/skills`, the one global target in the table: it is outside the
 *   workspace, and this panel is about the workspace it is opened in.
 */
export const OPENSPEC_TOOLS: readonly OpenSpecTool[] = [
  tool('agents', ['.agents/skills']),
  tool('dsh', ['.dsh/skills']),
  tool('codex', ['.agents/skills']),
  tool('zed', ['.agents/skills']),
  tool('claude', ['.claude/skills'], ['.claude/commands']),
  tool('codebuddy', ['.codebuddy/skills'], ['.codebuddy/commands']),
  tool('cursor', ['.cursor/skills'], ['.cursor/commands']),
  tool('github-copilot', ['.github/skills'], ['.github/prompts'], ['.github/agents/openspec.agent.md']),
  tool('qwen', ['.qwen/skills'], ['.qwen/commands']),
  tool('gemini', ['.gemini/skills'], ['.gemini/commands']),
  tool('amazon-q', ['.amazonq/skills'], ['.amazonq/prompts']),
  tool('antigravity', ['.agent/skills'], ['.agent/workflows']),
  tool('auggie', ['.augment/skills'], ['.augment/commands']),
  tool('bob', ['.bob/skills'], ['.bob/commands']),
  tool('cline', ['.cline/skills'], ['.clinerules/workflows']),
  tool('command-code', ['.commandcode/skills'], ['.commandcode/commands']),
  tool('codeartsagent', ['.codeartsdoer/skills']),
  tool('continue', ['.continue/skills'], ['.continue/prompts']),
  tool('costrict', ['.cospec/skills'], ['.cospec/openspec/commands']),
  tool('crush', ['.crush/skills'], ['.crush/commands']),
  tool('devin', ['.devin/skills'], ['.devin/workflows']),
  tool('factory', ['.factory/skills'], ['.factory/commands']),
  tool('forgecode', ['.forge/skills']),
  tool('hermes', ['.hermes/skills']),
  tool('iflow', ['.iflow/skills'], ['.iflow/commands']),
  tool('junie', ['.junie/skills'], ['.junie/commands']),
  tool('kilocode', ['.kilocode/skills'], ['.kilocode/workflows']),
  tool('kimi', ['.kimi-code/skills']),
  tool('kiro', ['.kiro/skills'], ['.kiro/prompts']),
  tool('lingma', ['.lingma/skills'], ['.lingma/commands']),
  tool('oh-my-pi', ['.omp/skills'], ['.omp/commands']),
  tool('opencode', ['.opencode/skills'], ['.opencode/commands']),
  tool('pi', ['.pi/skills'], ['.pi/prompts']),
  tool('qoder', ['.qoder/skills'], ['.qoder/commands']),
  tool('roocode', ['.roo/skills'], ['.roo/commands']),
  tool('rovodev', ['.rovodev/skills']),
  tool('trae', ['.trae/skills'], ['.trae/commands']),
  tool('codeassistant', ['.codeassistant/skills'], ['.codeassistant/commands']),
  tool('vibe', ['.vibe/skills']),
  tool('zcode', ['.zcode/skills'], ['.zcode/commands']),
]

export const OPENSPEC_CWD_ERROR = 'cwd must be an absolute workspace path'
export const OPENSPEC_OUTSIDE_ERROR =
  'this target does not sit inside the project root it was derived from; refusing to remove it'
export const OPENSPEC_MISSING_ERROR = 'this target was already gone; reopen the panel to see what is left'
export const OPENSPEC_NOT_OPENSPEC_ERROR =
  'this entry does not carry the prefix OpenSpec generates; refusing to remove it'

/** Stable codes for the ways `openspec init` can fail, so the panel can localise them. */
export const OPENSPEC_INIT_MISSING_CODE = 'openspec/not-installed'
export const OPENSPEC_INIT_TIMEOUT_CODE = 'openspec/timeout'
export const OPENSPEC_INIT_FAILED_CODE = 'openspec/failed'
export const OPENSPEC_INIT_MISSING_ERROR =
  `the openspec command was not found on PATH; install it with \`npm install -g ${OPENSPEC_PACKAGE_LATEST}\``
export const OPENSPEC_INIT_TIMEOUT_ERROR = `openspec init did not finish within ${OPENSPEC_INIT_TIMEOUT_MS} ms`
