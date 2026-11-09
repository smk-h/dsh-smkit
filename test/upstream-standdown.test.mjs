/**
 * The upstream MCP manager (`dsh-mcp-manager`) takes precedence.
 *
 * Both plugins register the `mcp` locale namespace, and dsh 0.2.2 throws on a
 * duplicate namespace + language — which used to cost the whole client entry
 * and blank the shell. The host half therefore stands its MCP feature down when
 * the profile loads the upstream plugin; this file pins the detection rule it
 * decides with:
 *
 * - the profile's `dsh.profile.bundles` is the authority: a listed upstream
 *   plugin stands this half down;
 * - merely installed in `node_modules` is not enough — a package that the
 *   loader does not mount must not disarm this plugin;
 * - a hand-assembled profile without a manifest falls back to "installed here";
 * - an empty directory, or a source checkout with no profile at all, never
 *   stands down.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

const { upstreamMcpManagerInstalled } = await import('../lib/index.js')

const scratch = mkdtempSync(join(tmpdir(), 'smkit-upstream-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

/** A profile directory with the given bundle list and optional upstream package. */
function profile(name, { bundles, installed }) {
  const root = join(scratch, name)
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  if (bundles !== undefined) {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: `profile-${name}`, dsh: { profile: { bundles } } }),
    )
  }
  if (installed === true) {
    const pkg = join(root, 'node_modules', 'dsh-mcp-manager')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'dsh-mcp-manager', version: '0.17.0' }))
  }
  return root
}

it('stands down when the profile bundles the upstream manager', () => {
  const root = profile('bundled', { bundles: ['@deepseek-ai/dsh-web-app', 'dsh-mcp-manager'], installed: true })
  assert.equal(upstreamMcpManagerInstalled(root), true)
})

it('keeps its MCP half when a profile merely has the package installed', () => {
  const root = profile('installed-only', { bundles: ['@deepseek-ai/dsh-web-app'], installed: true })
  assert.equal(
    upstreamMcpManagerInstalled(root),
    false,
    'installed but not mounted must not disarm this plugin',
  )
})

it('falls back to the package check when a profile has no manifest', () => {
  const withPackage = profile('hand-assembled', { installed: true })
  assert.equal(upstreamMcpManagerInstalled(withPackage), true)
  const withoutPackage = profile('empty', {})
  assert.equal(upstreamMcpManagerInstalled(withoutPackage), false)
})

it('never stands down outside a profile, where there is nothing to detect', () => {
  assert.equal(upstreamMcpManagerInstalled(join(scratch, 'missing')), false)
})
