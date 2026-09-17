/**
 * The wire contract of the skills feature.
 *
 * The host reads one skill root at a time and serves these shapes over
 * `/mcp-manager/api/skills*`; the browser half renders exactly these shapes.
 * They live outside both `src/host` and `src/client` for the same reason the
 * MCP contract does: each half used to declare its own copy of such a shape,
 * and nothing caught the two drifting apart.
 *
 * Type-only by design: the browser bundle is a single CommonJS script with no
 * module resolver, and `import type` is erased before bundling, so nothing here
 * reaches any emitted code.
 *
 * A page view is *one root*, named by `source` in the registry's own vocabulary
 * (`user-dsh`, `project-agents`, …): the two user roots are separate views
 * rather than one merged "global" list, so a row can never be mistaken for a
 * skill of the other home, and what a removal addresses is exactly what the
 * page showed. The client still carries the raw source, and the host still
 * composes the labels, so a root a future harness adds renders without a code
 * change.
 */

/** Which side a root belongs to: the user's homes, or the selected project's. */
export type SkillScope = 'global' | 'project'

/**
 * One root as the scope picker offers it.
 *
 * The label and the path both come from the host: the label is short and
 * display-ready (`~/.dsh/skills`, `.agents/skills`), the path is what the hover
 * bubble shows, and composing either in the browser would mean duplicating the
 * host's idea of where a home is.
 */
export interface SkillRootView {
  /** Root key: `user-dsh`, `user-agents`, `project-dsh`, `project-agents`. */
  source: string
  scope: SkillScope
  /** Absolute directory. */
  path: string
  /** Short display label derived from the path. */
  label: string
}

/**
 * One project the picker offers.
 *
 * A project is *one* entry, not one per root: the roots below it are the
 * provider's own layout detail, and a user thinks in projects — "this project's
 * skills". The two roots a project may have are therefore read together, in rank
 * order, and each row still says which of them it came from.
 */
export interface SkillWorkspaceView {
  path: string
  /** The registry's display name: the workspace's stored title, else the folder name. */
  title: string
}

/** `GET /skills/workspaces`: the user roots plus every registered workspace. */
export interface SkillWorkspacesView {
  userRoots: SkillRootView[]
  workspaces: SkillWorkspaceView[]
}

/** One skill as the settings page lists it. */
export interface SkillView {
  name: string
  description: string
  /** The skill's own `whenToUse` hint, when it declares one. */
  whenToUse?: string
  /** The root it was found under. */
  source: string
  scope: SkillScope
  /**
   * The group directory between the root and the skill, `''` for a top-level
   * one. A skill may be nested (`<root>/<group>/<name>/SKILL.md`), which is how
   * a collection keeps related skills together; the page shows the group so two
   * nested skills of the same name stay apart.
   */
  rel: string
  /**
   * Whether the harness would load this skill. Disabling is this plugin's own
   * convention — the header is renamed to `SKILL.md.disabled`, which the
   * provider ignores — so a disabled skill still lists here, still shows its
   * details, and can be switched back on.
   */
  enabled: boolean
  /** Whether the model may load it (`disable-model-invocation` unset/off). */
  modelInvocable: boolean
  /** Whether a human may invoke it (`user-invocable` unset/on). */
  userInvocable: boolean
  /** The header file: `…/SKILL.md`, `…/SKILL.md.disabled`, or a flat `…md[.disabled]`. */
  path: string
  /**
   * Where that file really lives — the same path with every link resolved.
   * Equal to `path` unless the skill was installed through a link, which is the
   * normal way a machine keeps its skills in one place and refers to them from
   * several roots.
   */
  realPath: string
  /** Whether the skill's file or its directory is a link (symlink, or a Windows junction). */
  linked: boolean
}

/** One view's catalog, as `GET /skills` reports it. */
export interface SkillsView {
  /** The root key that was read, or `project` for a project's merged view. */
  source: string
  /**
   * What the picker selected and this answer is about: a skill directory for a
   * user root, the workspace directory for a project.
   */
  root: string
  /**
   * The directories actually read, in rank order — one for a user root, and a
   * project's as many as exist there. Echoed back rather than composed in the
   * browser, because only the host resolves where a project's roots are (the
   * project root is the nearest ancestor carrying `.git`, which a workspace
   * directory may not be itself).
   */
  roots: string[]
  skills: SkillView[]
  /** Entries whose header was unusable: not listed, only counted. */
  skipped: number
  /** False when the root could not be read in full. */
  complete: boolean
}

/**
 * What addresses one skill on disk, wherever it is being read or written.
 *
 * The root is named twice on purpose: `source` picks which of the four roots,
 * and `cwd` picks which project that source means. `rel` names the group
 * directory a nested skill sits in — it is checked against a fresh scan, never
 * joined onto a path on its own, so it can only ever select an entry this host
 * found itself.
 */
export interface SkillAddress {
  name: string
  source: string
  /** The selected project, or `''` for a user root. */
  cwd: string
  /** The group path under the root (`''` for a top-level skill). */
  rel: string
}

/** `DELETE /skills/<name>` answering with the skill it removed. */
export interface SkillRemoveResponse {
  name: string
}

/** `POST /skills/enabled` body. */
export interface SkillToggleRequest extends SkillAddress {
  /** The state to move to: `true` enables, `false` disables. */
  enabled: boolean
}

/** `POST /skills/enabled` answering with the state that now holds. */
export interface SkillToggleResponse {
  name: string
  enabled: boolean
}
