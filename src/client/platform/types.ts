/**
 * Shared client-side types and the dependency bundle every factory receives.
 *
 * The browser half is bundled into one script by tsdown; `react` arrives
 * through `require("react")` in `entry.ts` and is threaded down as an explicit
 * dependency, so no module needs a global.
 */

/** Element returned by the injected `createElement`.
 *
 * Opaque by design: the client half builds a tree and hands it back to React,
 * never inspecting it (the reference implementation did the same). Declaring it
 * structurally would mean claiming a shape React does not have — the hook test
 * harness returns `{ type, props, children }`, real React returns an element
 * whose children live in `props`. Both are transparent to this code. */
export interface Element {
  readonly type: unknown
  readonly props: unknown
}

export type CreateElement = (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
) => Element

export interface ReactLike {
  createElement: CreateElement
  /** The setter takes the updater form too — a slider drag fires changes
   * faster than renders flush, so edits must build on the previous state. */
  useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void]
  useEffect(effect: () => void | (() => void), deps?: unknown[]): void
  useCallback<T>(callback: T, deps?: unknown[]): T
}

/** Dictionary with `{placeholder}` interpolation. */
export type Translator = (key: string, values?: Record<string, unknown>) => string

export type LocaleDict = Record<string, string>

/**
 * The slice of DSH's client sessions service (`ctx.sessions`) this plugin
 * uses. Every member exists on `ISessions`; the plugin never touches the rest,
 * so it declares only what it calls.
 */
export interface ClientSessionsLike {
  /**
   * Create or adopt a session on the Host. `workspaceId` lands it in that
   * workspace's accounting (the same call the workspace picker makes), `cwd`
   * only names a directory.
   */
  create(opts?: { workspaceId?: string; cwd?: string }): Promise<string>
  /** Select a created session as current.
   *
   * Optional on purpose: DSH 0.1.7 moved session navigation out of the
   * sessions contract ("navigation belongs to view owners") into the
   * `uiWorkspace` service, so a host on that build answers `undefined` here and
   * the navigation caller reaches the same flow through `ctx.reflect`. */
  open?(id: string): void
  /** Clear the current selection: the layout falls to the no-session state.
   * Optional for the same reason as `open`. */
  clear?(): void
  /** Re-pull the Host-authoritative session list. */
  refresh(): Promise<void>
  /**
   * The host-authoritative session list (`ISessions.list`), read only to
   * predict whether a removal turns the main view absent or blank — the
   * condition the settings shell answers by closing itself (see
   * `platform/ui/settings-shell`). Optional on purpose: without it the restore
   * simply runs after every batch, which is a no-op while the dialog is open.
   */
  list?: {
    getSnapshot(): {
      readonly byId?: Readonly<Record<string, {
        readonly blank?: boolean
        readonly retainedBy?: Readonly<Record<string, number | undefined>>
      }>>
    }
  }
}

/**
 * The slice of DSH's cross-Controller navigation service (`ctx.uiWorkspace`)
 * the delete control uses to put a replacement session on screen. Reached
 * through `ctx.reflect` at click time rather than declared in `inject`: a host
 * without the service must not unload the whole entry, and a read that answers
 * `undefined` there costs one gesture, not the bundle.
 */
export interface UiWorkspaceLike {
  /**
   * Start the New Session flow in one workspace and navigate to its session —
   * the same control DSH's own sidebar runs, refusal notice included. Present
   * from DSH 0.1.7, which is where the sessions contract stopped carrying
   * navigation; a host without it falls back to the legacy `sessions` pair.
   */
  startSession?(workspaceId?: string): void
  /** Select a session and show its conversation as one navigation action. */
  openSession?(sessionId: string): void
}

/** `useSessions`' callee shape: a selector over the client's session-list state. */
export type SessionListSelector = <Selected>(
  selector: (state: SessionListStateLike) => Selected,
) => Selected

/** `useWorkspaces`' callee shape: a selector over the client's workspace state. */
export type WorkspaceSelector = <Selected>(
  selector: (state: WorkspaceStateLike) => Selected,
) => Selected

/** The part of one session-list row this plugin reads: what the session is. */
export interface SessionListRowLike {
  /** Durable, host-projected title; absent until the session earns one. */
  title?: string
  cwd?: string
  blank?: boolean
}

/** The part of `SessionListState` this plugin reads. */
export interface SessionListStateLike {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionListRowLike | undefined>>
  readonly current?: string
}

/** The part of one Workspace row this plugin reads: its identity and accounting. */
export interface WorkspaceRowLike {
  readonly workspaceId: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

/** The part of the Workspace snapshot this plugin reads. */
export interface WorkspaceStateLike {
  readonly items: readonly WorkspaceRowLike[]
  readonly archivedSessionIds: readonly string[]
}

/**
 * One theme definition as the shell's registry holds it.
 *
 * Deliberately narrow: the registry's real definition also carries whatever
 * the shell adds later, and this plugin only ever reads the three fields it
 * declares here. `colorScheme` is the load-bearing one — the shell flips
 * `body[data-ds-dark-theme]` from it, so a theme that declares one half can
 * never disagree with the shell about which half is in force. It is also what
 * the center writes into the preference, to pin the half its own colors assume.
 */
export interface HostThemeDefinitionLike {
  /** Registry id; unique across every registered theme, the built-ins included. */
  id: string
  /** Which base palette this theme builds on. */
  colorScheme: 'light' | 'dark'
  /** Alias-layer overrides, applied as the shell's own inline custom properties. */
  tokens: Readonly<Record<string, string>>
}

/** The part of one theme snapshot this plugin reads. */
export interface HostThemeSnapshotLike {
  /** The preference in force: `light`/`dark`/`system`, or — when another
   * plugin is driving one — that plugin's registered id. */
  readonly preference: string
  /** The active definition, with its palette half resolved. */
  readonly active: HostThemeDefinitionLike
  /** Every registered theme, in registration order. */
  readonly themes: readonly HostThemeDefinitionLike[]
  /** Monotonic change counter. */
  readonly revision: number
}

/**
 * The slice of the shell's theme service (`ctx.theme`, ui-theme) this plugin
 * uses: stack override layers, drive the preference, and read the snapshot.
 * Every member exists on the real `ThemeRuntime`; the plugin never touches the
 * rest, so it declares only what it calls.
 *
 * `register` is deliberately **not** among them. The shell keeps a registered
 * id in memory alone — `setTheme` persists `light`/`dark`/`system` and nothing
 * else — while its durable settings scope rewrites the preference from storage
 * on every load. A registered theme is therefore the active one only until the
 * next such load; a theme of this center is a layer plus a half instead (see
 * `theme-center/apply.ts`).
 */
export interface HostThemeRuntimeLike {
  /**
   * Stack a token override layer on top of the active theme, `{ light, dark }`
   * per token. Returns the layer's disposer.
   */
  overrideTokens(
    source: string,
    tokens: Readonly<Record<string, { light: string; dark: string }>>,
  ): () => void
  /** Switch the shell's theme preference — the only preference write entry. */
  setTheme(id: string): void
}

/** The slot/runtime context DSH hands to a client plugin's `apply`. */
export interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  /**
   * The shell's theme registry.
   *
   * Declared as a service dependency in the bundle's `inject` list (see
   * `entry.ts` and `dsh.client.inject` in the manifest), which is what makes it
   * a property on the context by the time `apply` runs. Optional in the type
   * anyway, because a harness that mounts the client half in Node provides no
   * registry — and because a feature that cannot find one has to stand down
   * rather than throw: a throw inside a mount effect costs the whole entry.
   */
  theme?: HostThemeRuntimeLike
  /**
   * Cordis event subscription. The theme center follows `theme/change` so its
   * row and the structural sheet follow whatever moved the preference last —
   * the row itself, the shell's own appearance setting, or the OS scheme.
   */
  on?: (event: string, handler: (payload: any) => void) => () => void
  locale: {
    register(namespace: string, dictionaries: { zh: LocaleDict; en: LocaleDict }): () => void
    bind(namespace: string): Translator
  }
  slots: {
    inject(name: string, setup: () => void): void
    register(options: SlotOptions, component: unknown): unknown
    /**
     * Snapshot the entries registered under one slot key — the ledger's public
     * read (`SlotRegistry.entries`). Optional on purpose: the settings-shell
     * restore (`platform/ui/settings-shell`) reads the shell's own store handle
     * off the ledger, and a harness or host without the read simply degrades to
     * the dialog staying closed.
     */
    entries?(key: string): readonly unknown[]
  }
  /**
   * Client Session state and selection. Declared optional on purpose: the
   * header control degrades to the host's own `api-session/removed` frame
   * (which the sidebar and the selection both follow) when a composition has
   * no sessions service, and the Settings → MCP page must never depend on one.
   */
  sessions?: ClientSessionsLike
  /**
   * Cordis's reflection layer: a service read without declaring the name in
   * the bundle's `inject` list.
   *
   * The OpenSpec feature reaches the shell's right-sidebar navigation face
   * (`sidebarRight`) through it, at click time rather than at load: declaring
   * the service would make the whole plugin unloadable on a host whose shell
   * predates the column, while a read that answers `undefined` there costs one
   * gesture, not the bundle.
   */
  reflect?: { get(name: string): unknown }
  /**
   * Cordis's service publication: the mirror image of `inject`, handing a
   * named service to whoever declares it. The theme center publishes its
   * programmatic API through it (`smkitTheme`) so a sibling plugin can drive
   * themes without reaching into `window`. Optional because the harnesses
   * that mount the client half in Node provide reflection reads, not
   * publication.
   *
   * The name is the plugin's own: Cordis throws on a second registration of one
   * service name, and `dsh-theme` already publishes `dshTheme`.
   */
  provide?: (name: string, value: unknown) => void
}

/**
 * Registration options of one slot entry. `label` is optional because DSH only
 * reads it for entries an owner projects as a named row (the settings nav); a
 * plain header control declares none.
 */
export interface SlotOptions {
  name: string
  id: string
  order: number
  label?: () => string
  locale: string
}

/** One stylesheet a feature ships, keyed by its `data-smkit-css` name. */
export interface FeatureStylesheet {
  /** Suffix after `smkit/` — `mcp`, `mcp/nav-icon`, `custom-settings`. */
  name: string
  css: string
}

/**
 * One client-side feature: its dictionary, its stylesheets, and the seats it
 * takes. `entry.ts` walks the list and knows nothing else about any of them —
 * adding a feature is a directory plus one entry in that list.
 */
export interface ClientFeature {
  /** Stable id; also the dictionary namespace and the stylesheet prefix. */
  id: string
  locale: { namespace: string; zh: LocaleDict; en: LocaleDict }
  /**
   * Extra dictionaries this feature registers, in the same order the entry
   * walks them. A feature that composes other features' components needs their
   * namespaces registered too — the merged settings section seats three pages
   * whose copy stays in their own namespaces — and only the layer above the
   * features may know about them, so it declares them here.
   */
  extraLocales?: Array<{ namespace: string; zh: LocaleDict; en: LocaleDict }>
  styles: FeatureStylesheet[]
  /**
   * Register this feature's slot contributions, and any one-off side effect of
   * mounting it, against the plugin context. `t` is already bound to the
   * feature's own namespace; `deps` carries the shared host capabilities.
   */
  register(ctx: ClientContext, deps: ClientDeps, t: Translator): void
}

/** Result of one `/smkit/api/*` call. */
export interface ApiResult {
  ok: boolean
  status: number
  body: Record<string, any>
}

export type ApiFn = (path: string, options?: RequestInit) => Promise<ApiResult>

/**
 * One call to a route that answers with an event stream rather than a JSON body.
 *
 * `onEvent` fires once per frame as it arrives, so a caller can render progress
 * live; the promise settles only when the stream closes. It is the browser-read
 * half of the SSE the OpenSpec upgrade route writes.
 */
export type StreamFn = (
  path: string,
  options: RequestInit,
  onEvent: (event: Record<string, any>) => void,
) => Promise<void>

/**
 * The shell's hover bubble, as this plugin uses it: a structural slice of
 * `Tooltip` from the platform's ui-primitives module. Every member below exists
 * on the real component (`label`, `side`, `delayMs`, `disabled`, `maxWidth`,
 * `children`) and nothing else is touched, so the control keeps wearing the
 * shell's own bubble — its theme variables, its animation, and its viewport fit
 * pass — instead of a second implementation that would have to re-derive all
 * three. The bubble is rendered as a fixed-position sibling of the anchor.
 */
export interface HostTooltipProps {
  /** Bubble text. */
  label: string
  /** Placement relative to the anchor; `bottom` is the header control's. */
  side?: 'right' | 'bottom' | 'top'
  /** Hover delay in milliseconds; keyboard focus stays immediate. */
  delayMs?: number
  /** Suppress the bubble while true. */
  disabled?: boolean
  /** Width cap in pixels, for labels a half-viewport would render too wide. */
  maxWidth?: number
  /** The single anchor element the bubble describes. */
  children?: unknown
}

/** Everything the components need, threaded explicitly (no module globals). */
export interface ClientDeps {
  react: ReactLike
  h: CreateElement
  api: ApiFn
  /**
   * The event-stream sibling of `api`, for the OpenSpec upgrade call whose
   * output is painted line by line while the command runs.
   */
  stream: StreamFn
  /**
   * Translator bound to the `platform` namespace. The platform layer's own
   * components read their copy from here — today the confirmation dialog's two
   * buttons — so a label every feature shows is declared once instead of once
   * per dictionary. A feature keeps using the `t` its registration receives.
   */
  platformT: Translator
  /**
   * The shell's own hover bubble, resolved in `entry.ts` from the platform
   * module table. Optional on purpose: a host whose table has no such module
   * only loses the styled bubble — the header control falls back to the
   * browser's `title` bubble, which still names it on hover.
   */
  Tooltip?: (props: HostTooltipProps) => Element
  /**
   * react-dom's `createPortal`, resolved alongside `react` in `entry.ts`: the
   * settings-header breadcrumb portals through it into the shell's title strip.
   * Optional on purpose — an older host whose module table lacks `react-dom`
   * only loses the bar, and the section still renders whole. The container is
   * a live DOM element; `any` keeps the DOM lib's `Element` from colliding
   * with this file's opaque element alias at the boundary.
   */
  createPortal?: (children: unknown, container: any) => unknown
}

/* --------------------------------------------------------------- DOM events */

/*
 * Handlers are typed through `JSX.EventLike` in `ambient.d.ts`: JSX infers the
 * parameter from the element's `onChange`/`onClick`, so no per-component event
 * aliases are needed here.
 */
