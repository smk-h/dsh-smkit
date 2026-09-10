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
 */

import { readFileSync } from 'node:fs'
import type { UserConfig } from 'tsdown'

/**
 * Module specifiers the web shell resolves at runtime through the factory's
 * `require` (the platform module table). Everything else inlines — this plugin
 * has no other imports, and it must not: the client half is deliberately
 * dependency-free apart from `react`.
 */
const CLIENT_EXTERNALS = ['react']

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
