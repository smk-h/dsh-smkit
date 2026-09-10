#!/usr/bin/env node
/**
 * dsh-smkit — 把本插件装入 / 卸出 dsh profile 的辅助脚本。
 *
 *   pnpm smkit:install   [--profile web]
 *   pnpm smkit:uninstall [--profile web]
 *   pnpm smkit:debug     [--profile web] [--port 3080] [--open]
 *
 * install 走 tarball 方式：pnpm pack（prepack 会先跑 tsc + tsdown + verify）
 * 打包后用绝对路径 add 进 profile。不使用 link:/相对路径——profile 与项目
 * 跨盘符时 pnpm 会把 link: 目标当相对路径解析，生成坏 junction。
 *
 * debug 是完整调试循环：装入新代码 → 杀掉端口上的 dsh → 新终端窗口重启
 * dsh web。新窗口承载服务进程，日志直接可见、可 Ctrl+C，窗口在 dsh 退出
 * 后保留；不带 --no-open，每次重启由 dsh 自动打开浏览器。
 */

import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = 'dsh-smkit'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** shell step() 风格的阶段提示：亮青色 ➤ 前缀。 */
function step(message) {
  console.log(`\x1B[96m➤  ${message}\x1B[0m`)
}

function parseArgs(argv) {
  const args = { _: [], profile: 'web', port: '3080' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profile' || argv[i] === '-p') {
      args.profile = argv[++i] || args.profile
    } else if (argv[i] === '--port') {
      args.port = argv[++i] || args.port
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

/** 重启 dsh：Windows 在新终端窗口里前台运行（日志可见）；POSIX 放后台。
 * 不带 --no-open，由 dsh 每次重启后自动打开浏览器。 */
function startDsh(profile, port) {
  // `dsh web` 是 `--profile web` 的别名；其他 profile 走通用 boot 入口，
  // 且 web 应用专属的 --port 只对 web 有意义。
  const flags = `--port ${port}`
  const boot = profile === 'web' ? `dsh web ${flags}` : `dsh --profile ${profile}`
  if (process.platform === 'win32') {
    // stdio 必须置 ignore：新窗口若继承本脚本的管道句柄，调用方会一直等
    // 到管道关闭（即窗口关闭）才返回。start 会给窗口分配自己的控制台。
    spawnSync(`start "dsh web (${profile})" cmd /k "${boot}"`, {
      shell: true,
      cwd: ROOT,
      stdio: 'ignore',
    })
    console.log(`debug: 已在新窗口启动：${boot}`)
  } else {
    const child = spawn(boot, { shell: true, detached: true, stdio: 'ignore' })
    child.unref()
    console.log(`debug: 已在后台启动：${boot}（日志不落盘，需要看日志请手动前台运行）`)
  }
}

/** pnpm smkit:install — 打包并装入 profile，重启 dsh 后生效。 */
function cmdInstall(profile) {
  step(`打包并装入 profile "${profile}"`)
  installPlugin(profile)
  console.log(`\ninstall: ${PLUGIN} 已装入 profile "${profile}"`)
  console.log('如 dsh web 正在运行，重启后生效：pnpm smkit:debug')
}

/** pnpm smkit:uninstall — 从 profile 移除插件。 */
function cmdUninstall(profile) {
  step(`从 profile "${profile}" 移除插件`)
  run(`dsh plugin --profile ${profile} remove ${PLUGIN}`)
  console.log(`\nuninstall: ${PLUGIN} 已从 profile "${profile}" 移除`)
  console.log('如 dsh web 正在运行，重启后生效：dsh web')
}

/** pnpm smkit:debug — 完整调试循环：装入新代码 → 杀 dsh → 重启。 */
async function cmdDebug(profile, port) {
  step(`打包并装入 profile "${profile}"`)
  installPlugin(profile)
  console.log(`debug: ${PLUGIN} 已装入 profile "${profile}"`)
  step(`终止端口 ${port} 上的 dsh`)
  killDsh(port)
  // 端口释放与子进程树退出之间有短暂竞争，稍等再启动避免 EADDRINUSE。
  await new Promise((resolve) => setTimeout(resolve, 800))
  step(`重启 dsh web（端口 ${port}）`)
  startDsh(profile, port)
  console.log('debug: 浏览器请硬刷新（Ctrl+F5）以绕过旧客户端脚本缓存')
}

function printUsage() {
  console.log('用法：pnpm smkit:install|uninstall|debug [--profile <name>] [--port <port>]')
  console.log('      smkit:debug = 打包安装 → 杀掉端口上的 dsh → 重启 dsh web（默认端口 3080）')
}

const { _: args, profile, port } = parseArgs(process.argv.slice(2))

switch (args[0]) {
  case 'install':
    cmdInstall(profile)
    break
  case 'uninstall':
    cmdUninstall(profile)
    break
  case 'debug':
    await cmdDebug(profile, port)
    break
  default:
    printUsage()
}
