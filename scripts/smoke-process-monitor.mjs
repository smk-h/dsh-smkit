#!/usr/bin/env node
/**
 * @smai-kit/dsh-smkit —— 「进程资源」页的宿主侧冒烟。
 *
 *   pnpm smoke:process-monitor --url "http://127.0.0.1:3080/?token=<token>"
 *   DSH_URL="http://127.0.0.1:3080/?token=<token>" node scripts/smoke-process-monitor.mjs
 *
 * 打的是**正在运行**的 dsh web，不是测试替身：真插件、真路由、真 OS 进程表。
 * 每条检查一行 PASS/FAIL，末尾给汇总，非全绿时退出码 1，可以挂进发布前的手工
 * 核对清单。
 *
 * 这个路由的行为是「按请求采样 + 两次差分」，所以冒烟的核心是**隔 1.1 秒读两
 * 次**：第一次只有终身 CPU 总量（百分比必然缺席），第二次必须已经有宿主进程的
 * 百分比——差分窗口就是这两次读之间的墙钟。这也是页面每秒轮询一次的原因。
 *
 * 不做的检查：pid 是否真的存在于 OS。冒烟可能跑在远端 host 上，冒烟脚本的
 * 进程空间和宿主不一致；「pid 是真的」由本机的手工核对覆盖（见
 * docs/LV514-进程监控.md 的实测小节）。
 */

import process from 'node:process'

/**
 * 一次请求。`redirect: 'manual'` 是必须的：`Set-Cookie` 只在原始响应头上看得见。
 *
 * @param {string} base - 启动 URL（含 token），用作相对路径的基址。
 * @param {string} path - 请求路径。
 * @param {object} [init] - fetch 初始化。
 * @param {{ cookie?: string }} [jar] - 会话 cookie，按引用更新。
 * @returns {Promise<{status: number, body: unknown}>}
 */
async function call(base, path, init = {}, jar = {}) {
  const headers = { ...(init.headers ?? {}) }
  if (jar.cookie !== undefined) headers.cookie = jar.cookie
  const response = await fetch(new URL(path, base), { ...init, headers, redirect: 'manual' })
  const cookies = response.headers.getSetCookie?.() ?? []
  if (cookies.length > 0) jar.cookie = cookies.map((entry) => entry.split(';')[0]).join('; ')
  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  return { status: response.status, body }
}

/**
 * 用启动 URL 换一份会话 cookie。token 会过期，所以认证失败要说清楚是哪一种失败。
 *
 * @param {string} url - 启动 URL（含 token）。
 * @returns {Promise<string>} 可复用的 cookie 串；profile 不需要认证时为空串。
 */
async function signIn(url) {
  const response = await fetch(url, { redirect: 'manual' })
  const cookies = response.headers.getSetCookie?.() ?? []
  if (cookies.length > 0) return cookies.map((entry) => entry.split(';')[0]).join('; ')
  if (response.status === 401) {
    console.error(
      '认证失败：URL 里的 token 无效或已过期。\n' +
        'dsh web 每次启动都会换一个 token，重启后请从它的启动日志里重新取地址：\n' +
        '  grep -o "http://127.0.0.1:3080/?token=[A-Za-z0-9_-]*" <dsh web 的日志>',
    )
    process.exit(2)
  }
  await response.text()
  return ''
}

/** 已跑过的检查，用于末尾汇总。 */
const results = []

/**
 * 记一条检查结果。
 *
 * @param {string} name - 检查名。
 * @param {boolean} ok - 结果。
 * @param {string} [detail] - 打印在行尾的实测值。
 */
function report(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  — ${detail}`}`)
}

async function main() {
  const index = process.argv.indexOf('--url')
  const url = index >= 0 ? process.argv[index + 1] : process.env.DSH_URL
  if (url === undefined || url === '') {
    console.error('缺少目标地址：--url "http://127.0.0.1:3080/?token=..." 或环境变量 DSH_URL')
    process.exit(2)
  }

  const jar = { cookie: await signIn(url) }
  if (jar.cookie === '') console.log('（目标 profile 不需要认证，直接访问）')
  const get = (path) => call(url, path, {}, jar)

  // 1. 路由是活的，schema 是完整的
  const first = await get('/smkit/api/process-monitor/sample')
  const sample = first.body ?? {}
  report(
    'GET /process-monitor/sample answers the schema',
    first.status === 200 &&
      typeof sample.sampledAt === 'number' &&
      sample.intervalMs === 1_000 &&
      typeof sample.hostPid === 'number' &&
      sample.hostPid > 0 &&
      typeof sample.cores === 'number' &&
      sample.cores > 0 &&
      typeof sample.platform === 'string' &&
      Array.isArray(sample.entries) &&
      typeof sample.totals?.count === 'number',
    `status ${first.status} · ${sample.hostPid}@${sample.platform} · ${sample.totals?.count} 进程`,
  )

  // 2. 宿主进程必须在场，且是树根
  const hostEntry = (sample.entries ?? []).find((entry) => entry.kind === 'host')
  report(
    'the host process is present and rooted',
    hostEntry !== undefined && hostEntry.pid === sample.hostPid && hostEntry.cpuPct === null,
    hostEntry === undefined ? '宿主行缺失' : `pid ${hostEntry.pid} · cpuPct ${hostEntry.cpuPct}（首读应为 null）`,
  )

  // 3. 每行字段类型齐全（树本身的裁剪规则由单测钉死，冒烟只看 wire 形状）
  const wellFormed = (sample.entries ?? []).every(
    (entry) =>
      Number.isInteger(entry.pid) &&
      Number.isInteger(entry.ppid) &&
      typeof entry.name === 'string' &&
      typeof entry.cmdline === 'string' &&
      typeof entry.memBytes === 'number' &&
      typeof entry.cpuMs === 'number' &&
      ['host', 'mcp', 'other'].includes(entry.kind),
  )
  report('every entry is well-formed', wellFormed, `${(sample.entries ?? []).length} 行`)

  // 4. 差分：等到下一帧（帧率由采样器决定——Windows 常驻流约 1.2 s 一帧，
  //    POSIX 每读一帧），宿主进程必须有百分比
  let second = null
  let again = null
  for (let waited = 0; waited < 8_000; waited += 600) {
    await new Promise((resolve) => setTimeout(resolve, 600))
    second = await get('/smkit/api/process-monitor/sample')
    again = second.body ?? {}
    if (typeof again.sampledAt === 'number' && again.sampledAt > (sample.sampledAt ?? 0)) break
  }
  const hostAgain = (again.entries ?? []).find((entry) => entry.kind === 'host')
  report(
    'the second read differences a real CPU percentage',
    second.status === 200 &&
      hostAgain !== undefined &&
      typeof hostAgain.cpuPct === 'number' &&
      Number.isFinite(hostAgain.cpuPct) &&
      hostAgain.cpuPct >= 0,
    hostAgain === undefined ? '宿主行缺失' : `cpuPct ${hostAgain.cpuPct}%`,
  )

  // 5. 时间在走：第二帧的 sampledAt 必须更新过（不是同一帧的缓存）
  report(
    'the sampler produced a fresh frame',
    typeof again.sampledAt === 'number' && again.sampledAt > (sample.sampledAt ?? 0),
    `${sample.sampledAt} → ${again.sampledAt}`,
  )

  // 6. MCP 标注（有 stdio 服务器在场时才有意义；没有就是 SKIP）
  const mcpRows = (again.entries ?? []).filter((entry) => entry.kind === 'mcp')
  if (mcpRows.length === 0) {
    console.log('SKIP  MCP rows are tagged              — 这个 host 当前没有已注册的 stdio 服务器')
  } else {
    const tagged = mcpRows.every((entry) => typeof entry.mcpServerId === 'string' && entry.mcpServerId !== '')
    report(
      'MCP rows carry their server id',
      tagged,
      mcpRows
        .slice(0, 3)
        .map((entry) => entry.mcpServerId)
        .join(', '),
    )
  }

  const failed = results.filter((entry) => !entry.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

await main()
