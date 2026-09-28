#!/usr/bin/env node
/**
 * @smai-kit/dsh-smkit — 把本插件装入 / 卸出 dsh profile 的辅助脚本，兼管
 * profile 存量（扫描与清理）。
 *
 *   pnpm smkit:install   [--profile web]
 *   pnpm smkit:uninstall [--profile web]
 *   pnpm smkit:debug     [--profile web] [--port 3080]
 *   pnpm smkit:scan
 *   pnpm smkit:prune     [名字...] [--confirm]
 *
 * profile 不存在时 install/debug 会先从内置的 web 模板创建它（见 ensureProfile），
 * 所以换一台机器或换了 profile 名时不必手工建。非 web 的 profile 只有显式给出
 * --port 才会把它传给应用。
 *
 * scan / prune 管的是 $DSH_HOME/profiles 下的存量：scan 只读，prune 默认只列候选，
 * 只有 --confirm（--yes/-y）才真删。两者的判据都以 dsh 自己的为准 —— profile 的
 * 标志是有 package.json，正在运行的实例从进程命令行里认。
 *
 * install 走 tarball 方式：pnpm pack（prepack 会先跑 tsc + tsdown + verify）
 * 打包后用绝对路径 add 进 profile。不使用 link:/相对路径——profile 与项目
 * 跨盘符时 pnpm 会把 link: 目标当相对路径解析，生成坏 junction。
 *
 * debug 是完整调试循环：装入新代码 → 杀掉端口上的 dsh → 前台重启 dsh web。
 * 服务进程随本脚本一起跑在前台，启动日志（含访问链接）直接可见，按 Ctrl+C
 * 即可结束；不带 --no-open，每次重启由 dsh 自动打开浏览器。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 包名不写死，随 package.json 走：改名时这里自动跟上。
const PLUGIN = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name

/** shell step() 风格的阶段提示：亮青色 ➤ 前缀。 */
function step(message) {
  console.log(`\x1B[96m➤  ${message}\x1B[0m`)
}

function parseArgs(argv) {
  // `portGiven` 记的是"调用方点过 --port"，不是端口值本身：非 web profile 据此
  // 决定要不要把 --port 交给应用（见 startDsh）。
  const args = { _: [], profile: 'web', port: '3080', portGiven: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profile' || argv[i] === '-p') {
      args.profile = argv[++i] || args.profile
    } else if (argv[i] === '--port') {
      args.port = argv[++i] || args.port
      args.portGiven = true
    } else {
      args._.push(argv[i])
    }
  }
  return args
}

function run(command, { capture = false, ignoreFailure = false } = {}) {
  const r = spawnSync(command, {
    shell: true,
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (r.status !== 0 && !ignoreFailure) {
    if (r.stderr) process.stderr.write(r.stderr)
    process.exit(r.status ?? 1)
  }
  return r.stdout || ''
}

/** dsh 的 profile 根目录：$DSH_HOME/profiles，未设置时是 ~/.dsh（dsh 自己的解析）。 */
function profilesRoot() {
  return path.join(process.env.DSH_HOME || path.join(homedir(), '.dsh'), 'profiles')
}

/** 目标 profile 建好了没有 —— 用 dsh 自己的判据：目录里有 package.json。 */
function profileExists(profile) {
  return existsSync(path.join(profilesRoot(), profile, 'package.json'))
}

/**
 * 目标 profile 不存在时先建它：从内置的 web 模板派生（与本脚本的默认 profile
 * 同源），并用 `--dump-config` 让它把合成结果打印完就退出 —— 这一步在 dsh 里
 * 先于应用启动，所以创建不会留下一个跑着的服务。派生出来的 profile 只有模板
 * 自带的 bundles，本插件仍由随后的 install 装入。
 */
function ensureProfile(profile) {
  if (profileExists(profile)) return
  step(`profile "${profile}" 不存在，从内置 web 模板创建`)
  run(`dsh ${profile} --from-default-profile web --dump-config`, { capture: true })
  if (!profileExists(profile)) {
    console.error(`ensure: 创建 profile "${profile}" 失败`)
    process.exit(1)
  }
}

/** 读一份 profile 的 package.json；读不动时给 null（例如目录里根本没有）。 */
function readManifest(profile) {
  try {
    return JSON.parse(readFileSync(path.join(profilesRoot(), profile, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/** profile 声明的依赖 —— 就是它装了哪些插件：名字 → 版本或 `file:` 路径。 */
function dependenciesOf(manifest) {
  const deps = manifest?.dependencies
  if (deps === null || typeof deps !== 'object') return []
  return Object.entries(deps).filter(([, spec]) => typeof spec === 'string')
}

/** `file:` 依赖还原成本地路径；从 registry 装的写法（版本号、`^` 等）给 null。 */
function specPath(spec) {
  return typeof spec === 'string' && spec.startsWith('file:') ? spec.slice(5) : null
}

/** 指向本地 tarball 但文件已经不在了的依赖 —— 这种 profile 已经装不上那个插件。 */
function deadDependencies(manifest) {
  return dependenciesOf(manifest).filter(([, spec]) => {
    const local = specPath(spec)
    return local !== null && !existsSync(local)
  })
}

/**
 * 目录体积。不跟随 junction / 符号链接：pnpm 的 node_modules 里那些是指向全局
 * store 的链接，跟进去既会重复计数也可能绕圈。体积只是给人看的参考，读不到就跳过。
 */
function dirSize(dir) {
  let total = 0
  const walk = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) walk(target)
      else if (entry.isFile()) {
        try {
          total += statSync(target).size
        } catch {
          /* 读不到大小就跳过 */
        }
      }
    }
  }
  walk(dir)
  return total
}

/** 体积的可读写法。 */
function formatSize(bytes) {
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`
}

/** dsh 内置的 profile 名：不进候选，也不接受显式删除。 */
const PROTECTED_PROFILES = new Set(['web', 'tui', 'headless', 'desktop', 'rescue'])

/**
 * 正在跑的 dsh 进程，按 profile 名索引。dsh 会把 profile 名写在 bin.js 之后
 * （`bin.js web --port 3080`）或 --profile 之后，据此辨认。和插件的 notify 一样
 * 这是 Windows-only 能力，探不到就给空表 —— 它只是删除前的安全提示。
 */
function runningProfiles() {
  const map = new Map()
  if (process.platform !== 'win32') return map
  const out = run(
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe'} | ForEach-Object {$_.CommandLine}"`,
    { capture: true, ignoreFailure: true },
  )
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes('bin.js')) continue
    const matched = /--profile\s+([A-Za-z0-9._-]+)/.exec(line) ?? /bin\.js"?\s+"?([A-Za-z0-9._-]+)/.exec(line)
    if (matched !== null) map.set(matched[1], line.trim())
  }
  return map
}

/** 打包（prepack 先构建 + verify）并强制装入 profile：先卸载再装入。 */
function installPlugin(profile) {
  const out = run('pnpm pack', { capture: true })
  const lines = out.split(/\r?\n/).filter(Boolean)
  const tgz = lines[lines.length - 1]
  if (!/\.tgz$/.test(tgz)) {
    console.error(`install: 无法从 pnpm pack 输出解析 tarball 文件名：\n${out}`)
    process.exit(1)
  }
  // 版本号不变时，pnpm 视同名依赖为已满足、不替换文件内容，装入会变成
  // no-op。先卸载（未安装时允许失败）再装入，保证每次都落到新代码。
  run(`dsh plugin --profile ${profile} remove ${PLUGIN}`, { capture: true, ignoreFailure: true })
  run(`dsh plugin --profile ${profile} add "${path.join(ROOT, tgz)}"`)
}

/** 终止监听在 dsh web 端口上的进程（复用 kill-port.mjs，--yes 跳过确认）。 */
function killDsh(port) {
  run(`node "${path.join(ROOT, 'scripts', 'kill-port.mjs')}" ${port} --yes`)
}

/** 前台重启 dsh：日志（含访问链接）直接输出到当前终端，Ctrl+C 结束。
 * 不带 --no-open，由 dsh 每次重启后自动打开浏览器。 */
function startDsh(profile, port, portGiven) {
  // `dsh web` 是 `--profile web` 的别名；其他 profile（例如从 web 模板派生的
  // webs）走通用 boot 入口。--port 是 web 应用自己的开关，所以只在调用方点过
  // 它时才往下传：拿给不带这个开关的应用（tui 之类）会被拒。
  const flags = `--port ${port}`
  const boot =
    profile === 'web' ? `dsh web ${flags}` : portGiven ? `dsh --profile ${profile} ${flags}` : `dsh --profile ${profile}`
  // stdio 置 inherit：把当前终端交给 dsh，启动链接随日志一起打印；
  // 本进程阻塞等待，Ctrl+C 同时终止 dsh 与脚本（Windows 上 Ctrl+C 会
  // 广播给共享同一控制台的整条进程链，npm/pnpm 一并退出）。
  spawnSync(boot, { shell: true, cwd: ROOT, stdio: 'inherit' })
}

/** pnpm smkit:install — 打包并装入 profile，重启 dsh 后生效。 */
function cmdInstall(profile) {
  ensureProfile(profile)
  step(`打包并装入 profile "${profile}"`)
  installPlugin(profile)
  console.log(`\ninstall: ${PLUGIN} 已装入 profile "${profile}"`)
  console.log(
    profile === 'web'
      ? '如 dsh web 正在运行，重启后生效：pnpm smkit:debug'
      : `如 dsh 正在使用 profile "${profile}"，重启后生效：pnpm smkit:debug --profile ${profile} --port <port>`,
  )
}

/** pnpm smkit:uninstall — 从 profile 移除插件。 */
function cmdUninstall(profile) {
  step(`从 profile "${profile}" 移除插件`)
  run(`dsh plugin --profile ${profile} remove ${PLUGIN}`)
  console.log(`\nuninstall: ${PLUGIN} 已从 profile "${profile}" 移除`)
  console.log('如 dsh web 正在运行，重启后生效：dsh web')
}

/** pnpm smkit:debug — 完整调试循环：装入新代码 → 杀 dsh → 重启。 */
async function cmdDebug(profile, port, portGiven) {
  ensureProfile(profile)
  step(`打包并装入 profile "${profile}"`)
  installPlugin(profile)
  console.log(`debug: ${PLUGIN} 已装入 profile "${profile}"`)
  step(`终止端口 ${port} 上的 dsh`)
  killDsh(port)
  // 端口释放与子进程树退出之间有短暂竞争，稍等再启动避免 EADDRINUSE。
  await new Promise((resolve) => setTimeout(resolve, 800))
  step(`前台启动 dsh web（端口 ${port}）；Ctrl+C 结束`)
  console.log('debug: 浏览器请硬刷新（Ctrl+F5）以绕过旧客户端脚本缓存')
  startDsh(profile, port, portGiven)
}

/**
 * pnpm smkit:scan — 只读扫描：每个 profile 的 bundles、依赖（装了哪些插件、来自
 * 哪里）、体积、是否在跑。顺带标出 prune 会看上眼的那两类（临时命名、本地依赖
 * 失效），以及 dsh 自用的目录。
 */
function cmdScan() {
  const root = profilesRoot()
  if (!existsSync(root)) {
    console.log(`scan: ${root} 不存在，还没有任何 profile`)
    return
  }
  const live = runningProfiles()
  const entries = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  step(`扫描 ${root}（${entries.length} 项）`)
  for (const entry of entries) {
    const manifest = readManifest(entry.name)
    if (manifest === null) {
      console.log(`\n${entry.name}\n  非 profile（没有 package.json，dsh 自用），跳过`)
      continue
    }
    const bundles = manifest?.dsh?.profile?.bundles
    const deps = dependenciesOf(manifest)
    const dead = deadDependencies(manifest)
    console.log(`\n${entry.name}`)
    console.log(`  bundles     : ${Array.isArray(bundles) ? bundles.join(', ') : '(无)'}`)
    console.log('  依赖        :')
    if (deps.length === 0) console.log('    (无：只跑 dsh 自带的 bundles)')
    for (const [name, spec] of deps) {
      const gone = specPath(spec) !== null && !existsSync(specPath(spec))
      console.log(`    ${name} → ${spec}${gone ? '  ← 文件不存在' : ''}`)
    }
    console.log(`  node_modules: ${existsSync(path.join(root, entry.name, 'node_modules')) ? '有' : '无'}`)
    console.log(`  体积        : ${formatSize(dirSize(path.join(root, entry.name)))}`)
    const running = live.get(entry.name)
    if (running !== undefined) console.log(`  正在运行    : ${running}`)
    if (entry.name.startsWith('smkit-')) console.log('  提示        : 临时命名（smkit-*），prune 的候选')
    if (dead.length > 0) console.log('  提示        : 依赖里有失效的本地 tarball，prune 的候选')
  }
}

/**
 * pnpm smkit:prune — 删除不需要的 profile。默认只列候选（dry-run），--confirm
 * （或 --yes/-y）才真删。候选只来自两条客观线索：临时命名（smkit-*）和依赖
 * 里的本地 tarball 已失效；不带名字时只按这两条找，带名字时只删那几个。dsh 内置名字永远
 * 不进候选、也不接受显式删除，正在运行的 profile 一律跳过。
 *
 *   node scripts/dsh-smkit.mjs prune                  # 列候选
 *   node scripts/dsh-smkit.mjs prune --confirm        # 删除候选
 *   node scripts/dsh-smkit.mjs prune webs --confirm   # 删除指定名字
 */
function cmdPrune(names, confirm) {
  const root = profilesRoot()
  const live = runningProfiles()
  const candidates = []
  const refused = []
  if (names.length === 0) {
    const entries = existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []
    for (const entry of entries) {
      if (!entry.isDirectory() || PROTECTED_PROFILES.has(entry.name)) continue
      const manifest = readManifest(entry.name)
      if (manifest === null) continue
      const reasons = []
      if (entry.name.startsWith('smkit-')) reasons.push('临时命名（smkit-*）')
      const dead = deadDependencies(manifest)
      if (dead.length > 0) reasons.push(`本地依赖失效（${dead.map(([, spec]) => specPath(spec)).join('、')}）`)
      if (reasons.length > 0) candidates.push({ name: entry.name, why: reasons.join('；') })
    }
  } else {
    for (const name of names) {
      if (PROTECTED_PROFILES.has(name)) {
        refused.push({ name, why: 'dsh 内置的 profile 名' })
        continue
      }
      if (readManifest(name) === null) {
        refused.push({ name, why: '不是一个 profile（没有 package.json）' })
        continue
      }
      candidates.push({ name, why: '指定' })
    }
  }
  for (const entry of refused) console.log(`  ! 拒绝 ${entry.name}：${entry.why}`)
  if (candidates.length === 0) {
    console.log('prune: 没有候选（要指定名字就 `prune <名字>`）')
    return
  }
  step(confirm ? `删除 ${candidates.length} 个 profile` : `候选 ${candidates.length} 个（dry-run，加 --confirm 才真删）`)
  for (const entry of candidates) {
    const dir = path.join(root, entry.name)
    const size = formatSize(dirSize(dir))
    const running = live.get(entry.name)
    if (running !== undefined) {
      console.log(`  - ${entry.name}（${size}）跳过：正在运行 ${running}`)
      continue
    }
    if (!confirm) {
      console.log(`  - ${entry.name}（${size}） ← ${entry.why}`)
      continue
    }
    try {
      rmSync(dir, { recursive: true, force: true })
      console.log(`  ✓ 已删除 ${entry.name}（${size}） ← ${entry.why}`)
    } catch (error) {
      console.error(`  ✗ ${entry.name} 删除失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function printUsage() {
  console.log('用法：pnpm smkit:install|uninstall|debug|scan|prune [--profile <name>] [--port <port>] [--confirm]')
  console.log('      smkit:debug = 打包安装 → 杀掉端口上的 dsh → 重启 dsh web（默认端口 3080）')
  console.log('      smkit:scan  = 只读扫描：各 profile 的 bundles、依赖、体积、是否在跑')
  console.log('      smkit:prune = 列出/删除不需要的 profile（默认 dry-run，--confirm 才真删）')
}

const { _: args, profile, port, portGiven } = parseArgs(process.argv.slice(2))
const [command, ...rest] = args

switch (command) {
  case 'install':
    cmdInstall(profile)
    break
  case 'uninstall':
    cmdUninstall(profile)
    break
  case 'debug':
    await cmdDebug(profile, port, portGiven)
    break
  case 'scan':
    cmdScan()
    break
  case 'prune':
    cmdPrune(
      rest.filter((arg) => !arg.startsWith('-')),
      rest.some((arg) => arg === '--yes' || arg === '-y' || arg === '--confirm'),
    )
    break
  default:
    printUsage()
}
