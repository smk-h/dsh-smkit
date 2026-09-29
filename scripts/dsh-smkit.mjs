#!/usr/bin/env node
/**
 * @smai-kit/dsh-smkit — 把本插件装入 / 卸出 dsh profile 的辅助脚本，兼管
 * profile 存量（扫描与清理）。
 *
 *   pnpm smkit:web:install|uninstall|debug   [--port 3080]
 *   pnpm smkit:desktop:install|uninstall|debug|kill
 *   pnpm smkit:scan
 *   pnpm smkit:prune     [名字...] [--confirm]
 *
 *   两条别名各自把 --profile 固定住（web / desktop）。自定义 profile 没有别名，
 *   直接用脚本本身，命令与别名等价：
 *   node scripts/dsh-smkit.mjs install --profile <name>
 *
 *   kill 命令本身也在脚本里（按端口杀，与 dsh:kill-port 同源）：
 *   node scripts/dsh-smkit.mjs kill [--profile <name>] [--port <port>] [--yes]
 *
 * 脚本按三层排下来：通用管道 → desktop 独占的那条通道 → 命令层。
 *
 * 除 desktop 外没有"某个 profile 专用"的函数：装上 profile 名就能用（走 PATH 上
 * 的 `dsh --profile <name>`），所以 ensureProfile / killDsh / startDsh 这些是通用
 * 的，名字里不带 profile。真正需要区别对待的只有 desktop 一层（见下）。
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
 * debug 是完整调试循环：装入新代码 → 杀掉运行中的实例 → 重启。普通 profile 是前台
 * 起 dsh，服务进程随本脚本一起跑在前台，启动日志（含访问链接）直接可见，按 Ctrl+C
 * 即可结束，且不带 --no-open（每次重启由 dsh 自己打开浏览器）；desktop 则是把应用
 * 重新拉起来。
 *
 * desktop 是另一条通道：desktop profile 由 Electron 应用独占管理，dsh 的 CLI 对
 * `dsh --profile desktop` 一律拒绝，连桌面端自带的那份包装器也只放行 plugin 子命令
 * （manageDesktopProfile），profile 本身由应用初始化。所以这一层先用
 * findDesktopRoot() 定位安装目录，再用它自带的 CLI 转 pnpm（见 desktopCli），找不到
 * 就明确报错，而不是让调用方对着 "managed exclusively by the Electron application"
 * 发愣。桌面端也没有"前台重启"一说：kill 杀的是应用进程（按安装目录过滤可执行文件
 * 路径，同名程序不误伤），debug 杀完再用安装目录里的 exe 拉起它 —— profile 的加载权
 * 在应用手里。进程管理目前只实现了 Windows。
 */

import { spawn, spawnSync } from 'node:child_process'
import readline from 'node:readline/promises'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 包名不写死，随 package.json 走：改名时这里自动跟上。
const PLUGIN = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name

/** 不带 --profile 时的默认 profile：本插件的主要目标是 Web UI。 */
const DEFAULT_PROFILE = 'web'
/** 普通通道用的 CLI：PATH 上的 dsh，web 与自定义 profile 都走它。 */
const DSH_CLI = 'dsh'
/** dsh 内置的 profile 名：不进 prune 候选，也不接受显式删除。 */
const PROTECTED_PROFILES = new Set(['web', 'tui', 'headless', 'desktop', 'rescue'])

/* ─────────────────────────────── 通用：与 profile 种类无关的管道与动作 ── */

/** shell step() 风格的阶段提示：亮青色 ➤ 前缀。 */
function step(message) {
  console.log(`\x1B[96m➤  ${message}\x1B[0m`)
}

/** 命令行：--profile / --port 是本脚本自己的，其余原样留给命令层（--yes 等）。 */
function parseArgs(argv) {
  // `portGiven` 记的是"调用方点过 --port"，不是端口值本身：非 web profile 据此
  // 决定要不要把 --port 交给应用（见 startDsh）。
  const args = { _: [], profile: DEFAULT_PROFILE, port: '3080', portGiven: false }
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

/** PATH 上某个命令的路径（where / command -v）；找不到给 null。 */
function whichCommand(name) {
  const out = run(process.platform === 'win32' ? `where ${name}` : `command -v ${name}`, {
    capture: true,
    ignoreFailure: true,
  })
  return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? null
}

/** dsh 的 profile 根目录：$DSH_HOME/profiles，未设置时是 ~/.dsh（dsh 自己的解析）。 */
function profilesRoot() {
  return path.join(process.env.DSH_HOME || path.join(homedir(), '.dsh'), 'profiles')
}

/** 目标 profile 建好了没有 —— 用 dsh 自己的判据：目录里有 package.json。 */
function profileExists(profile) {
  return existsSync(path.join(profilesRoot(), profile, 'package.json'))
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

/** 打包：pnpm pack（prepack 会先构建 + verify），返回 tarball 的文件名。 */
function packTarball() {
  const out = run('pnpm pack', { capture: true })
  const lines = out.split(/\r?\n/).filter(Boolean)
  const tgz = lines[lines.length - 1]
  if (!/\.tgz$/.test(tgz)) {
    console.error(`install: 无法从 pnpm pack 输出解析 tarball 文件名：\n${out}`)
    process.exit(1)
  }
  return tgz
}

/**
 * 装入一个 profile：先卸载再装入。版本号不变时，pnpm 视同名依赖为已满足、不替换
 * 文件内容，装入会变成 no-op；先卸载（未安装时允许失败）保证每次都落到新代码。
 * `prefix` 是走哪条通道的 CLI（普通通道是 dsh，desktop 是桌面端包装器的绝对路径）。
 */
function installPlugin(profile, prefix) {
  const tgz = packTarball()
  run(`${prefix} plugin --profile ${profile} remove ${PLUGIN}`, { capture: true, ignoreFailure: true })
  run(`${prefix} plugin --profile ${profile} add "${path.join(ROOT, tgz)}"`)
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

/** 终止监听在 dsh 端口上的进程（复用 kill-port.mjs，--yes 跳过它的确认）。 */
function killDsh(port, yes) {
  run(`node "${path.join(ROOT, 'scripts', 'kill-port.mjs')}" ${port}${yes ? ' --yes' : ''}`)
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

/* ────────────────── desktop：桌面端独占的那条通道（唯一需要区别对待的） ── */

/*
 * 这里不重复 dsh 自己的 profile 归属判断，只做三件事：定位安装目录 →
 * 用它的包装器转 pnpm → 杀/拉起应用进程。electron 应用才是 desktop profile
 * 的 owner，所以本脚本对它只做"代理"。
 */

const DESKTOP_PROFILE = 'desktop'
/** Get-Process 用的进程名（Windows 下不带扩展名）与应用可执行文件名。 */
const DESKTOP_PROCESS = 'DeepSeek Harness'
const DESKTOP_EXE = 'DeepSeek Harness.exe'
/** 包装器在安装目录里的相对位置：<安装根>/resources/runtime/cli/bin/dsh.cmd。 */
const DESKTOP_CLI = ['resources', 'runtime', 'cli', 'bin']

/** 桌面端 CLI 包装器的路径（非 Windows 上没有 .cmd 后缀）。 */
function desktopCli(root) {
  return path.join(root, ...DESKTOP_CLI, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
}

/** 桌面端 CLI 的调用前缀：绝对路径，引号不能省（安装路径里通常带空格）。 */
function desktopCliPrefix(root) {
  return `"${desktopCli(root)}"`
}

/** 目录像不像桌面端的安装根 —— 只看包装器在不在。 */
function isDesktopRoot(dir) {
  return typeof dir === 'string' && dir !== '' && existsSync(desktopCli(dir))
}

/** 这个 profile 是不是桌面端那个（大小写不敏感：dsh 自己也是这么比的）。 */
function isDesktopProfile(profile) {
  return profile.toLowerCase() === DESKTOP_PROFILE
}

/**
 * 桌面端安装根：$DSH_DESKTOP_ROOT → PATH 上的 dsh 反推 → 常见安装位置。
 * 反推按路径形态来：桌面端装的包装器固定落在
 * <安装根>/resources/runtime/cli/bin/dsh.cmd，往上四级就是安装根 —— 这比认
 * 版本号稳，也不碰注册表。
 */
function findDesktopRoot() {
  if (isDesktopRoot(process.env.DSH_DESKTOP_ROOT)) return process.env.DSH_DESKTOP_ROOT
  const shim = whichCommand('dsh')
  if (shim !== null) {
    const root = path.resolve(path.dirname(shim), '..', '..', '..', '..')
    if (isDesktopRoot(root)) return root
  }
  const roots = [
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', DESKTOP_PROCESS),
    path.join(process.env.ProgramFiles ?? '', DESKTOP_PROCESS),
    path.join(process.env['ProgramFiles(x86)'] ?? '', DESKTOP_PROCESS),
  ]
  return roots.find((root) => isDesktopRoot(root)) ?? null
}

/** 找不到安装目录时的统一出口：说清楚要指什么，而不是拼一条注定被拒的命令。 */
function requireDesktopRoot() {
  const root = findDesktopRoot()
  if (root === null) {
    console.error(
      'desktop: 找不到桌面端安装目录（其中应有 resources/runtime/cli/bin/dsh.cmd）。\n' +
        'desktop: 用 DSH_DESKTOP_ROOT 指给它，例如：\n' +
        '  $env:DSH_DESKTOP_ROOT="D:\\devSoftware\\DeepSeek Harness"',
    )
    process.exit(1)
  }
  return root
}

/** 桌面端 profile 由应用初始化：CLI 只会拒绝，不会替你建。 */
function requireDesktopProfile() {
  if (profileExists(DESKTOP_PROFILE)) return
  console.error(
    `desktop: profile "${DESKTOP_PROFILE}" 还没初始化（目录里没有 package.json）。\n` +
      'desktop: 先打开一次桌面端让它建好 profile，再完全退出应用，然后重跑本命令。',
  )
  process.exit(1)
}

/**
 * 正在跑的桌面端进程。只认安装目录里的那份可执行文件：同名程序、或另一个
 * 安装位置的桌面端都不该被我们杀掉。路径读不到（权限不足等）时按"不可判定"
 * 放行 —— 宁可多杀一个自己的进程，也不要因为读不到路径就装作没在跑。
 */
function desktopProcesses(root) {
  if (process.platform !== 'win32') return []
  const out = run(
    `powershell -NoProfile -Command "Get-Process -Name '${DESKTOP_PROCESS}' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id.ToString() + '|' + $_.Path }"`,
    { capture: true, ignoreFailure: true },
  )
  const found = []
  for (const line of out.split(/\r?\n/)) {
    const [pid, exe] = line.trim().split('|')
    if (!/^\d+$/.test(pid ?? '')) continue
    if (typeof exe === 'string' && exe !== '' && !exe.toLowerCase().startsWith(root.toLowerCase())) continue
    found.push({ pid, exe: exe || '(路径未知)' })
  }
  return found
}

/** 等桌面端进程真正消失：应用还开着时 pnpm 会与它读写同一个 profile。 */
async function waitForDesktopExit(root, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (desktopProcesses(root).length === 0) return true
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

/** 终止桌面端；未经 --yes 时先问一遍（与 kill-port 的确认口径一致）。 */
async function killDesktopApp(root, yes) {
  if (process.platform !== 'win32') {
    console.error('desktop: 进程管理目前只实现了 Windows')
    process.exit(1)
  }
  const processes = desktopProcesses(root)
  if (processes.length === 0) {
    console.log('kill: 桌面端没有在运行')
    return
  }
  console.log(`桌面端有 ${processes.length} 个进程：\n`)
  for (const entry of processes) console.log(`  PID ${entry.pid}  ${entry.exe}`)
  let confirmed = yes
  if (!confirmed) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = (await rl.question('\n终止以上进程？(y/N) ')).trim().toLowerCase()
    rl.close()
    confirmed = answer === 'y' || answer === 'yes'
  }
  if (!confirmed) {
    console.log('kill: 已取消')
    return
  }
  // /T 连子进程一起收：Electron 是多进程的，只杀主进程会留下孤儿渲染进程。
  for (const entry of processes) run(`taskkill /PID ${entry.pid} /T /F`, { ignoreFailure: true })
  const exited = await waitForDesktopExit(root)
  console.log(`kill: 桌面端已终止（${processes.length} 个进程）${exited ? '' : '，但仍有进程没退出'}`)
}

/**
 * 拉起桌面端（不等待退出）。profile 的加载权在应用手里，CLI 那条 boot 路径对
 * desktop 是关闭的，所以"重启"只能把应用本身拉起来。
 */
function startDesktopApp(root) {
  const exe = path.join(root, DESKTOP_EXE)
  if (!existsSync(exe)) {
    console.error(`desktop: 找不到 ${exe}，请手工打开桌面端`)
    return
  }
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref()
}

/**
 * 桌面端通道的装入前准备：安装目录必须找得到（否则 CLI 注定被拒），profile 必须
 * 已由应用初始化，且应用默认必须已退出 —— 最后一条可用 allowRunning 放行，因为
 * 它是"有依据的提示"而非硬错误（卸出不必先关应用；debug 会自己先杀）。
 * @returns 桌面端 CLI 的调用前缀（含引号）。
 */
function prepareDesktopProfile({ allowRunning = false } = {}) {
  const root = requireDesktopRoot()
  requireDesktopProfile()
  const processes = desktopProcesses(root)
  if (processes.length > 0 && !allowRunning) {
    console.error(
      `install: 桌面端正在运行（${processes.length} 个进程），装入要求应用完全退出。\n` +
        'install: 先跑 pnpm smkit:desktop:kill；' +
        '或直接用 pnpm smkit:desktop:debug（它会自己杀）。\n' +
        'install: 确认要带着运行中的应用装下去，就加 --yes。',
    )
    process.exit(1)
  }
  return desktopCliPrefix(root)
}

/* ──────────────────────────────────────────────── 命令层：每个命令一层薄壳 ── */

/**
 * 装入 / 卸出前的准备：给出该 profile 该用的 CLI 前缀。普通 profile 走 PATH 上的
 * dsh（顺带把不存在的 profile 从 web 模板建出来），desktop 转到它自己那条通道。
 */
function prepareProfile(profile, { allowRunning = false } = {}) {
  if (isDesktopProfile(profile)) return prepareDesktopProfile({ allowRunning })
  ensureProfile(profile)
  return DSH_CLI
}

/** install — 打包并装入 profile，重启 dsh 后生效。 */
function cmdInstall(profile, yes) {
  const prefix = prepareProfile(profile, { allowRunning: yes })
  step(`打包并装入 profile "${profile}"`)
  installPlugin(profile, prefix)
  console.log(`\ninstall: ${PLUGIN} 已装入 profile "${profile}"`)
  console.log(
    isDesktopProfile(profile)
      ? '重启桌面端后生效：pnpm smkit:desktop:debug（或手工重开应用）'
      : profile === DEFAULT_PROFILE
        ? '如 dsh web 正在运行，重启后生效：pnpm smkit:web:debug'
        : `如 dsh 正在使用 profile "${profile}"，重启后生效：node scripts/dsh-smkit.mjs debug --profile ${profile} --port <port>`,
  )
}

/** uninstall — 从 profile 移除插件。 */
function cmdUninstall(profile) {
  // 卸出不需要应用先退出，所以放行"桌面端在跑"这一条。
  const prefix = prepareProfile(profile, { allowRunning: true })
  step(`从 profile "${profile}" 移除插件`)
  run(`${prefix} plugin --profile ${profile} remove ${PLUGIN}`)
  console.log(`\nuninstall: ${PLUGIN} 已从 profile "${profile}" 移除`)
  console.log(
    isDesktopProfile(profile)
      ? '重启桌面端后生效；桌面端在跑时建议先 pnpm smkit:desktop:kill'
      : '如 dsh web 正在运行，重启后生效：dsh web',
  )
}

/** kill — 终止该 profile 的运行实例：普通 profile 按端口找（同 dsh:kill-port），
 * desktop 找应用进程。桌面端不需要 profile 已初始化，所以只要求找得到安装目录。 */
async function cmdKill(profile, port, yes) {
  if (isDesktopProfile(profile)) {
    await killDesktopApp(requireDesktopRoot(), yes)
    return
  }
  step(`终止端口 ${port} 上的 dsh`)
  killDsh(port, yes)
}

/** debug — 完整调试循环：装入新代码 → 杀掉运行中的实例 → 重启。 */
async function cmdDebug(profile, port, portGiven) {
  if (isDesktopProfile(profile)) {
    const root = requireDesktopRoot()
    requireDesktopProfile()
    step('终止桌面端（装入要求应用退出）')
    await killDesktopApp(root, true)
    step(`打包并装入 profile "${profile}"`)
    installPlugin(profile, desktopCliPrefix(root))
    console.log(`debug: ${PLUGIN} 已装入 profile "${profile}"`)
    step('重新拉起桌面端')
    startDesktopApp(root)
    return
  }
  ensureProfile(profile)
  step(`打包并装入 profile "${profile}"`)
  installPlugin(profile, DSH_CLI)
  console.log(`debug: ${PLUGIN} 已装入 profile "${profile}"`)
  step(`终止端口 ${port} 上的 dsh`)
  killDsh(port, true)
  // 端口释放与子进程树退出之间有短暂竞争，稍等再启动避免 EADDRINUSE。
  await new Promise((resolve) => setTimeout(resolve, 800))
  step(`前台启动 dsh web（端口 ${port}）；Ctrl+C 结束`)
  console.log('debug: 浏览器请硬刷新（Ctrl+F5）以绕过旧客户端脚本缓存')
  startDsh(profile, port, portGiven)
}

/**
 * scan — 只读扫描：每个 profile 的 bundles、依赖（装了哪些插件、来自哪里）、
 * 体积、是否在跑。顺带标出 prune 会看上眼的那两类（临时命名、本地依赖失效），
 * 以及 dsh 自用的目录。
 */
function cmdScan() {
  const root = profilesRoot()
  if (!existsSync(root)) {
    console.log(`scan: ${root} 不存在，还没有任何 profile`)
    return
  }
  const live = runningProfiles()
  // 桌面端的宿主是 Electron 应用而不是 node.exe，runningProfiles() 看不见它。
  const desktopDir = findDesktopRoot()
  const desktopApps = desktopDir === null ? [] : desktopProcesses(desktopDir)
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
    if (entry.name === DESKTOP_PROFILE && desktopApps.length > 0) {
      console.log(`  桌面端      : 运行中（${desktopApps.length} 个进程）`)
    }
    if (entry.name.startsWith('smkit-')) console.log('  提示        : 临时命名（smkit-*），prune 的候选')
    if (dead.length > 0) console.log('  提示        : 依赖里有失效的本地 tarball，prune 的候选')
  }
}

/**
 * prune — 删除不需要的 profile。默认只列候选（dry-run），--confirm
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
  console.log('用法：pnpm smkit:web:install|uninstall|debug [--port <port>] [--yes]')
  console.log('      pnpm smkit:desktop:install|uninstall|debug|kill')
  console.log('      pnpm smkit:scan|prune [名字...] [--confirm]')
  console.log('      别名把 --profile 固定住；自定义 profile 用脚本本身，如')
  console.log('      node scripts/dsh-smkit.mjs install --profile <name> [--port <port>] [--yes]')
  console.log('      smkit:web:debug / smkit:desktop:debug = 打包安装 → 杀掉运行中的实例 → 重启')
  console.log('      kill 命令也在脚本里（按端口，同 dsh:kill-port）：node scripts/dsh-smkit.mjs kill')
  console.log('      desktop 走桌面端自带的 CLI，找不到安装目录时用 DSH_DESKTOP_ROOT 指给它')
}

const { _: args, profile, port, portGiven } = parseArgs(process.argv.slice(2))
const [command, ...rest] = args
// --yes / -y / --confirm 在本脚本里同义：跳过确认，不再追问。
const yes = rest.some((arg) => arg === '--yes' || arg === '-y' || arg === '--confirm')

switch (command) {
  case 'install':
    cmdInstall(profile, yes)
    break
  case 'uninstall':
    cmdUninstall(profile)
    break
  case 'debug':
    await cmdDebug(profile, port, portGiven)
    break
  case 'kill':
    await cmdKill(profile, port, yes)
    break
  case 'scan':
    cmdScan()
    break
  case 'prune':
    cmdPrune(
      rest.filter((arg) => !arg.startsWith('-')),
      yes,
    )
    break
  default:
    printUsage()
}
