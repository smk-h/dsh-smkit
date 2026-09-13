/**
 * tsdown build for dsh-smkit — the browser half only.
 *
 * The host half stays on `tsc -p tsconfig.json` (multi-file ESM + declarations);
 * only the client needs a bundler, because DSH requires it as **one** script:
 * `exports["./client"]` must be a plain file that calls
 * `window.__ModuleLoader__.load({ id, factory })` and whose factory returns
 * `module.exports` with `apply` + `inject`. The browser has no module resolver,
 * so the N source modules have to be collapsed — that is the whole job here.
 *
 * The wrapper is the official DSH client-bundle recipe (mirrored from
 * `packages/client/tsdown.client.ts`, as reproduced by dsh-better-sidebar):
 *
 *   banner  opens `__ModuleLoader__.load({...})` and the CJS closure
 *   intro   declares the `module` / `exports` the CJS output writes into
 *   footer  returns them
 *
 * `codeSplitting: false` keeps the artifact a single script: the closure's
 * `require` can only resolve platform module-table entries (`react`), never a
 * relative chunk URL.
 *
 * JSX stays **classic** (`tsconfig: 'src/client/tsconfig.json'` carries
 * `jsx: "react"` + `jsxFactory: "h"`), so the factory is the `h` threaded in
 * through `ClientDeps` — no module-level global and no `react/jsx-runtime`
 * dependency, which keeps the plugin working on the older DSH releases in our
 * compatibility range.
 *
 * One small plugin rides along: `cssTextPlugin` turns the section's stylesheet
 * into a string module, for the same reason everything else is inlined — the
 * browser fetches one script and nothing beside it.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { TsdownPlugin, UserConfig } from 'tsdown'

/**
 * Module specifiers the web shell resolves at runtime through the factory's
 * `require` (the platform module table). Everything else inlines — this plugin
 * has no other imports, and it must not: the client half is deliberately
 * dependency-free apart from `react`. `react-dom` rides the same table (the
 * shell's own plugins resolve it) and only feeds `createPortal`, the mount for
 * the settings-header breadcrumb. `@deepseek-ai/dsh-client-ui-primitives` is a
 * platform module too (the web shell seeds it, `packages/client/web/src/seed.ts`)
 * and only feeds the header control's hover bubble, whose absence merely costs
 * the styled bubble.
 */
const CLIENT_EXTERNALS = ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives']

/**
 * The package identity, read once: the ModuleLoader id and the `__PLUGIN_NAME__`
 * / `__PLUGIN_VERSION__` defines the client badge renders all derive from
 * package.json, so a rename or version bump is a one-line change with nothing
 * to drift.
 */
const { name, version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { name: string; version: string }

const PLUGIN_ID = name

/**
 * Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline.
 *
 * The `.mjs` suffix is load-bearing twice: the id must not end in `.css`
 * (tsdown's `css-guard` throws on such an id while `@tsdown/css` is absent) and
 * it must look like an ES module, so the escaped rules pass through verbatim.
 * The `\0` prefix marks it virtual, so no other plugin tries to open it as a
 * file.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-smkit-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * Compile every relative `.css` import into a string module:
 * `export default "<rules>"`.
 *
 * The client half is one script and the browser resolves neither modules nor
 * stylesheets, so the rules have to travel as data and be injected at runtime —
 * `platform/styles.ts` for the shared rules, each feature's own `styles.ts` for
 * its own. The two hooks below are the whole mechanism:
 *
 *   resolveId  `./section.css` becomes the virtual id `\0dsh-smkit-css:<abs>.mjs`
 *   load       that id is read back and returned as a JSON-escaped string
 *
 * This mirrors `dsh-css-inline` from DSH-better-sidebar, minus its CSS-Modules
 * branch: this section's classes (`mm_*`) are global on purpose — the shell is a
 * single document and the rules are namespaced by prefix — so nothing needs
 * hashing and no `lightningcss` dependency is pulled in. Where the reference
 * emits the `<style>` tag from inside the generated module, this one only hands
 * back the text, which keeps injection and its de-dupe key in one place
 * (`installStylesheet`).
 *
 * tsdown's own CSS support cannot be used here: `@tsdown/css` extracts a sibling
 * `client.css` asset, and nothing would ever request it — DSH loads
 * `lib/client.js` and nothing else. `?raw` imports are not part of the resolver
 * either, which is why the wrapper id above is needed to bypass the guard.
 */
function cssTextPlugin(): TsdownPlugin {
  return {
    name: 'dsh-smkit:css-text',
    resolveId(source: string, importer: string | undefined) {
      // Relative only, and by design: the build has exactly one stylesheet. A
      // bare specifier (`@scope/pkg/style.css`) would need `createRequire`
      // resolution — see the reference plugin — so it is left unresolved here.
      if (!source.startsWith('.') || !source.endsWith('.css') || importer === undefined) {
        return null
      }
      return CSS_VIRTUAL_PREFIX + resolve(dirname(importer), source) + CSS_VIRTUAL_SUFFIX
    },
    load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const file = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(file)
      return `export default ${JSON.stringify(readFileSync(file, 'utf8'))}`
    },
  }
}

export default {
  define: {
    __PLUGIN_NAME__: JSON.stringify(name),
    __PLUGIN_VERSION__: JSON.stringify(version),
  },
  entry: { client: 'src/client/entry.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  // `lib/` is shared with the host `tsc` emit above; a clean here would wipe it.
  clean: false,
  // Source of the classic-JSX settings (`jsx` + `jsxFactory`) for the bundler.
  tsconfig: 'src/client/tsconfig.json',
  deps: { neverBundle: CLIENT_EXTERNALS },
  plugins: [cssTextPlugin()],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    // Only the `module`/`exports` bindings the CJS output writes into; the
    // `__esModule` marker is emitted by the bundler's own interop prologue, so
    // declaring it here too would duplicate it.
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
    codeSplitting: false,
  },
} satisfies UserConfig
