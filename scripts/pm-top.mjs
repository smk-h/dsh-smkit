#!/usr/bin/env node
/**
 * @smai-kit/dsh-smkit —— dsh 宿主进程子树的跨平台观测器。
 *
 *   node scripts/pm-top.mjs                    自动找 :3080 的监听进程，持续刷新
 *   node scripts/pm-top.mjs --port 3081        换端口
 *   node scripts/pm-top.mjs --pid 27828        指定宿主 pid（桌面版没有端口）
 *   node scripts/pm-top.mjs --once             打一帧就退出
 *   node scripts/pm-top.mjs --ticks 5          打 5 帧后退出
 *   node scripts/pm-top.mjs --json             每帧一行 JSON，替代 pm-watch.ps1
 *   node scripts/pm-top.mjs --interval 500     采样间隔（毫秒，默认 1000）
 *   node scripts/pm-top.mjs --no-samplers      隐藏采样器自身（与页面对齐，见下）
 *
 * 与 `pm-watch.ps1` 的关系（原 `pm-top.ps1` 已由本脚本取代并删除）：那是
 * Windows 专用、自己重写了一遍口径（WMI 查询、帧间差分、整机归一），跨平台
 * 就得按 OS 再写几份，而且口径一改就要同步多处、漏一处就出现两种读数。这里
 * **不重写**，直接 import 插件构建产物里的采样器与报告器，所以：
 *
 * - CPU% 就是页面那个数（`ΔcpuMs / (Δwall × cores) × 100`，250 ms~5 s 窗口，
 *   负增量判无窗口），跨平台由 `sampler.ts` 决定（Windows = 常驻 PowerShell
 *   流，POSIX = 每帧一次 `ps`）；
 * - 子树收集、采样器自排除、排序全是 `report.ts` 的同一份代码。
 *
 * 代价与限制（写在这里而不是让人踩）：
 *
 * - 必须有 `lib/index.js`（`pnpm build` 的产物，gitignore 里）。缺了会直接
 *   提示，不会退化成"猜一份口径"。
 * - **MCP 来源标签是空的**：`process-registry` 是模块级状态，MCP 服务器是在
 *   dsh 宿主进程里注册的，本脚本是另一个进程，看不到那些条目。所以这里只会
 *   有 `host` / `other`，不会假装自己有 `mcp:<id>`。要看标签请开页面，或用
 *   `smoke-process-monitor.mjs` 走 HTTP。
 * - 自动找 pid 只能找**正在监听某个端口**的进程；桌面版 dsh 没有监听口，必须
 *   `--pid`。页面上有宿主 pid，也可以 `netstat -ano | findstr :3080`。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cpus } from 'node:os'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs, promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// `node scripts/pm-top.mjs | head -5` 是正常用法：管道那头先关掉时不要
// 让 EPIPE 变成一个带栈的崩溃。
process.stdout.on('error', () => {})

/** 构建产物：本脚本的全部口径都来自这里，不是它的副本。 */
const LIB_URL = new URL('../lib/index.js', import.meta.url)

/**
 * 一帧都拿不到时的放弃时限。Windows 的采样器冷启动（PowerShell 上场）约
 * 0.7 s，给到 15 s 是为了让被防火墙拦住、或 PowerShell 起不来的机器给出结论
 * 而不是挂在那里。
 */
const FIRST_FRAME_TIMEOUT_MS = 15_000

/**
 * 列宽（沿用被本脚本取代的 ps1 版表头，方便新旧输出并排贴）。
 * `COMMAND` 不参与对齐（它总是最后一项）。
 */
const COLUMNS = { name: 24, pid: 8, cpu: 7, mem: 10, total: 8, cmd: 64 }

/* ------------------------------------------------------------------ args */

function usage() {
  return [
    'usage: node scripts/pm-top.mjs [--pid <pid>] [--port <port>] [--once] [--ticks <n>]',
    '                               [--json] [--interval <ms>] [--help]',
    '',
    '  --pid <pid>      subtree root; defaults to the process LISTENING on --port',
    '  --port <port>    port used to find that process (default 3080)',
    '  --once           print one frame and exit (CPU column is "-" on purpose:',
    '                   the first frame has nothing to difference against; use',
    '                   --ticks 2 for one frame with numbers)',
    '  --ticks <n>      print n frames and exit (0 = until Ctrl+C, the default)',
    '  --json           one JSON object per frame instead of a table',
    '  --interval <ms>  sampling interval in milliseconds (default 1000)',
    '  --no-samplers    drop the plugin\'s own sampling PowerShell (and its children)',
    '                   so rows/totals line up with the page, which excludes it',
  ].join('\n')
}

/** 把 "3080" 这种字符串参数折成正整数，非法值当场退出而不是猜。 */
function positiveInt(raw, name, { allowZero = false } = {}) {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    console.error(`--${name} 需要一个${allowZero ? '非负' : '正'}整数，收到 ${JSON.stringify(raw)}`)
    process.exit(2)
  }
  return value
}

function parseOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      pid: { type: 'string' },
      port: { type: 'string', default: '3080' },
      once: { type: 'boolean', default: false },
      ticks: { type: 'string', default: '0' },
      json: { type: 'boolean', default: false },
      interval: { type: 'string', default: '1000' },
      // parseArgs 不做 camelCase→kebab-case 转换：键名就是旗标名，所以直接用 kebab。
      'no-samplers': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  })
  return {
    pid: values.pid === undefined ? 0 : positiveInt(values.pid, 'pid'),
    port: positiveInt(values.port, 'port'),
    once: values.once,
    ticks: positiveInt(values.ticks, 'ticks', { allowZero: true }),
    json: values.json,
    interval: positiveInt(values.interval, 'interval'),
    noSamplers: values['no-samplers'],
    help: values.help,
  }
}

/* --------------------------------------------------- host pid discovery */

/**
 * 在 `ss -ltnp` 的一行里找 pid。Linux 的输出形如
 *   LISTEN 0 511 *:3080 *:* users:(("node",pid=123,fd=20))
 * 正则只认 `pid=`，因为列位置随 ss 版本漂移过。
 */
function pidFromSsLine(line) {
  const match = /pid=(\d+)/.exec(line)
  return match === null ? 0 : Number(match[1])
}

/**
 * 按端口反查监听进程的 pid。三支各自用系统自带工具，全部失败返回 0——
 * 调用方会带着 `--pid` 的提示退出。
 */
async function pidOnPort(port) {
  // 端口必须落在地址的**结尾**：netstat 的本地地址列是完整地址
  // （`0.0.0.0:135`、`[::]:135`），而且 `:135` 不能误吃 `:1135`。
  const tail = new RegExp(`:${port}$`)
  if (process.platform === 'win32') {
    // Windows 的 netstat 一定在，输出末列就是 pid。
    const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp'])
    for (const line of stdout.split('\n')) {
      if (!/LISTENING/i.test(line)) continue
      const columns = line.trim().split(/\s+/)
      if (!columns.some((column) => tail.test(column))) continue
      return Number(columns[columns.length - 1])
    }
    return 0
  }
  if (process.platform === 'linux') {
    try {
      const { stdout } = await execFileAsync('ss', ['-ltnp'])
      // ss 的本地地址是 `*:3080` 或 `[::]:3080`，后面跟包数，所以只要求
      // 端口后面不是数字。
      const local = new RegExp(`:${port}(?!\\d)`)
      for (const line of stdout.split('\n')) {
        if (!local.test(line)) continue
        const pid = pidFromSsLine(line)
        if (pid > 0) return pid
      }
    } catch {
      // 没有 ss（少见，但 alpine 之类）；落到 lsof。
    }
  }
  try {
    // macOS 与多数 Linux 上的兜底：`-t` 只要 pid。
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
    const first = Number(stdout.trim().split('\n')[0])
    return Number.isInteger(first) && first > 0 ? first : 0
  } catch {
    return 0
  }
}

/* -------------------------------------------------------------- rendering */

/** `0.5` → `0.5%`；无窗口（null）→ `-`，与页面的 `—` 同一含义。 */
function formatPct(value) {
  return value === null || !Number.isFinite(value) ? '-' : `${value.toFixed(1)}%`
}

/** 累计 CPU 时间，与页面 `formatCpuMs` 同一套切分（`74s` → `1m14s`）。 */
function formatCpuTime(ms) {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1)
}

/**
 * 与页面逐行对齐用：隐藏"采样器自身"。页面按设计排除自己的常驻 PowerShell
 * （采样器不测量自己），本脚本从外面看得到它——于是同一台机器上 pm-top 会比
 * 页面多出 powershell + conhost 两行、内存多 ~100 MB、CPU 多 ~0.5%。
 * `--no-samplers` 按签名（命令行开头的 `[Console]::OutputEncoding=` 是采样
 * 脚本独有的引导串）摘掉这些行及其子进程并重算 totals；对照时两边就完全一致。
 */
function hideSamplers(report) {
  const dropped = new Set(
    report.entries.filter((entry) => entry.cmdline.includes('[Console]::OutputEncoding=')).map((entry) => entry.pid),
  )
  if (dropped.size === 0) return report
  // 子进程跟着走：conhost 挂在 powershell 下面（entries 带 ppid，传导到不动点）。
  for (let grew = true; grew; ) {
    grew = false
    for (const entry of report.entries) {
      if (dropped.has(entry.pid) || !dropped.has(entry.ppid)) continue
      dropped.add(entry.pid)
      grew = true
    }
  }
  const entries = report.entries.filter((entry) => !dropped.has(entry.pid))
  const cpu = entries.reduce((sum, entry) => sum + (entry.cpuPct ?? 0), 0)
  const mem = entries.reduce((sum, entry) => sum + entry.memBytes, 0)
  return {
    ...report,
    entries,
    totals: { cpuPct: Math.round(cpu * 10) / 10, memBytes: mem, count: entries.length },
  }
}

/** 命令行一行化并截断；表格里的宽度预算由 `COLUMNS.cmd` 决定。 */
function shorten(text, max) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 3)}...`
}

/**
 * 一帧表格。列宽固定，`COMMAND` 放最后（不 pad，否则整行会被空格撑到屏幕外）。
 *
 * TOTAL 的 CPU 与页面卡片有一处**故意不同**：页面把"全部行都没有窗口"渲染成
 * `0.0%`，这里渲染成 `-`——一行百分比都没有时，`0.0%` 是在断言一个没人测过的
 * 值。ws 汇总照旧（工作集求和，含共享页，与页面一致）。
 */
function printTable(report, round, intervalMs) {
  if (process.stdout.isTTY === true) process.stdout.write('\u001b[2J\u001b[H')
  const stamp = new Date().toTimeString().slice(0, 8)
  const head = `dsh subtree pid=${report.hostPid}  cores=${report.cores}  ${stamp}  #${round}  ${intervalMs}ms  (Ctrl+C quits)`
  const header =
    'NAME'.padEnd(COLUMNS.name) +
    'PID'.padStart(COLUMNS.pid) +
    'CPU%'.padStart(COLUMNS.cpu) +
    'WS(MB)'.padStart(COLUMNS.mem) +
    'TOTAL'.padStart(COLUMNS.total) +
    '  COMMAND'

  let cpuSum = 0
  let measured = 0
  let memSum = 0
  const lines = [head, header]
  for (const entry of report.entries) {
    if (entry.cpuPct !== null) {
      cpuSum += entry.cpuPct
      measured += 1
    }
    memSum += entry.memBytes
    const tag = entry.mcpServerId === undefined ? '' : ` [mcp:${entry.mcpServerId}]`
    lines.push(
      shorten(entry.name, COLUMNS.name).padEnd(COLUMNS.name) +
        String(entry.pid).padStart(COLUMNS.pid) +
        formatPct(entry.cpuPct).padStart(COLUMNS.cpu) +
        formatMb(entry.memBytes).padStart(COLUMNS.mem) +
        formatCpuTime(entry.cpuMs).padStart(COLUMNS.total) +
        `  ${shorten(entry.cmdline, COLUMNS.cmd)}${tag}`,
    )
  }
  const cpuTotal = measured === 0 ? '-' : `${(Math.round(cpuSum * 10) / 10).toFixed(1)}%`
  lines.push(
    `TOTAL (${report.entries.length})`.padEnd(COLUMNS.name) +
      ''.padStart(COLUMNS.pid) +
      cpuTotal.padStart(COLUMNS.cpu) +
      formatMb(memSum).padStart(COLUMNS.mem),
  )
  process.stdout.write(`${lines.join('\n')}\n`)
}

/**
 * 一帧 JSON（NDJSON 的一行）。字段与页面路由的 wire 形状同名，方便同一份
 * 解析代码喂两边；`cpuPct` 仍是 `null`/数字，不在这里换单位。
 */
function printJson(report, round) {
  const payload = {
    round,
    sampledAt: report.sampledAt,
    hostPid: report.hostPid,
    cores: report.cores,
    platform: report.platform,
    entries: report.entries,
    totals: report.totals,
    // 采样器自身的足迹（被排除的那部分）：外部视角下通常为 null——pm-top 自己的
    // 采样器不在宿主子树里；插件页面的回答里非空。
    meter: report.meter ?? null,
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

/* ------------------------------------------------------------------- main */

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  if (!existsSync(LIB_URL)) {
    console.error(
      '缺少构建产物 lib/index.js。\n' +
        '本脚本复用插件的采样器与报告器（这样口径与页面必然一致），所以先构建：\n' +
        '  pnpm build        # 或 npm run build:host，只用宿主侧的话',
    )
    process.exit(2)
  }

  // 采样器与报告器来自构建产物，不是本文件的副本。
  const { createProcessSampler, buildProcessReport } = await import(LIB_URL.href)

  let hostPid = options.pid
  if (hostPid === 0) {
    hostPid = await pidOnPort(options.port).catch(() => 0)
  }
  if (hostPid === 0) {
    console.error(
      `端口 ${options.port} 上没有找到监听进程。\n` +
        '桌面版 dsh 没有监听端口，用 --pid <pid> 指定宿主进程（pid 在插件页面上，或 netstat -ano | findstr :3080）。',
    )
    process.exit(2)
  }

  // 采样的 stall/降级警告走 stderr：stdout 只有表格或 NDJSON，管道那头的
  // 解析器不该被日志打断。
  const logger = {
    info() {},
    warn(message) {
      process.stderr.write(`${message}\n`)
    },
    error(message) {
      process.stderr.write(`${message}\n`)
    },
  }

  const sampler = createProcessSampler({ logger })
  const cores = (() => {
    const count = cpus().length
    return Number.isInteger(count) && count > 0 ? count : 1
  })()

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    sampler.dispose()
  }
  process.on('SIGINT', () => {
    stop()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    stop()
    process.exit(0)
  })

  const startedAt = Date.now()
  let frames = 0
  let announced = false
  /**
   * 已经展示过的那一帧的时间戳。Windows 的 helper 约 1.2 s 一帧，而本脚本
   * 默认每 1 s 读一次，所以总有一部分读落在同一帧上——那是"没有新窗口"，不是
   * 新数据。重复打印同一组数字会让 `--ticks 2` 看起来像是差分坏了，所以同一
   * 帧不计数、稍后重读（帧率仍由采样器决定，本脚本不制造帧）。
   */
  let shownAt = 0
  let wait = options.interval
  try {
    while (!stopping) {
      const reading = await sampler.read()
      if ('error' in reading) {
        process.stderr.write(`采样失败：${reading.error}\n`)
        if (Date.now() - startedAt > FIRST_FRAME_TIMEOUT_MS) {
          process.exitCode = 1
          break
        }
      } else if (!('entries' in reading)) {
        // 首帧未到（Windows 的 helper 正在启动）：不占一行表格，等下一轮。
        if (!announced) {
          announced = true
          process.stderr.write('采样器启动中，等待第一帧…\n')
        }
        if (Date.now() - startedAt > FIRST_FRAME_TIMEOUT_MS) {
          process.stderr.write(`等了 ${FIRST_FRAME_TIMEOUT_MS} ms 仍没有帧，放弃。\n`)
          process.exitCode = 1
          break
        }
      } else if (reading.sampledAt === shownAt) {
        // 同一帧再被服务：窗口没有前进，这一读不是新数据。别打印、别计数，
        // 稍后再问一次（200 ms 只是重试节奏，帧率仍由采样器掌握）。
        wait = 200
      } else {
        shownAt = reading.sampledAt
        wait = options.interval
        const report = buildProcessReport(reading.entries, reading.baseline, {
          hostPid,
          cores,
          platform: process.platform,
          sampledAt: reading.sampledAt,
          // 注册表在宿主进程里，这里是空的——见文件头"限制"。
          registered: [],
          excludePids: sampler.excludePids(),
        })
        frames += 1
        const shown = options.noSamplers ? hideSamplers(report) : report
        if (options.json) printJson(shown, frames)
        else printTable(shown, frames, options.interval)
        if (options.once || (options.ticks > 0 && frames >= options.ticks)) break
      }
      await sleep(wait)
    }
  } finally {
    stop()
  }
}

await main()
