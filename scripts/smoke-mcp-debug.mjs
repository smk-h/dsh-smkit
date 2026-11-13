#!/usr/bin/env node
/**
 * @smai-kit/dsh-smkit —— 「MCP 调试页」的宿主侧冒烟。
 *
 *   pnpm smoke:mcp-debug --url "http://127.0.0.1:3080/?token=<token>"
 *   DSH_URL="http://127.0.0.1:3080/?token=<token>" node scripts/smoke-mcp-debug.mjs
 *
 * 打的是**正在运行**的 dsh web，不是测试替身：真插件、真路由、真 MCP 服务器。
 * 每条检查一行 PASS/FAIL/SKIP，末尾给汇总，非全绿时退出码 1，可以挂进发布前的手工
 * 核对清单。
 *
 * 为什么零依赖、只测宿主半区：
 *
 * - 仓库的依赖是收紧的（客户端半区除了 react 什么都不引），为一个手工冒烟拉
 *   Playwright 进来不划算，而 `fetch` 在 Node 22+ 是内置的；
 * - 宿主半区恰好是「配置写错就静默失效」的那一半——路由拼错、id 不稳、开关不回
 *   滚，在浏览器里都只表现为「页面行为怪」，这里能直接指名道姓；
 * - 客户端半区（三栏、标红、分段控件、滚动封顶）需要真实 DOM，由 `test/` 里的
 *   VM 用例 + 一次手工浏览器核对覆盖，本脚本不假装能做那件事。
 *
 * token 不从代码里读：dsh web 每次启动都会换一个，写死只会过期（也可能已经被别的
 * 浏览器换过一次）。URL 只取一次，之后靠它换来的 cookie 访问 `/smkit/api/*`。
 *
 * 工作区里的服务器要等某个 agent 打开过那个项目才真正连接；没打开过时，与调用相关
 * 的几项会 SKIP——先在那个项目里开一次会话，再跑一遍。
 */

import process from 'node:process'

/**
 * 一次请求。
 *
 * `redirect: 'manual'` 是必须的：`Set-Cookie` 只在原始响应头上看得见，跟随 302
 * 之后就只剩最终页面了。
 *
 * @param {string} base - 启动 URL（含 token），用作相对路径的基址。
 * @param {string} path - 请求路径。
 * @param {object} [init] - fetch 初始化。
 * @param {{ cookie?: string }} [jar] - 会话 cookie，按引用更新。
 * @returns {Promise<{status: number, body: unknown, text: string, location: string | null}>}
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
  return { status: response.status, body, text, location: response.headers.get('location') }
}

/**
 * 用启动 URL 换一份会话 cookie。
 *
 * 这个 token 会过期（也可能已经被别的浏览器换过一次），所以认证失败要说清楚是
 * 哪一种失败：静默地当作「不需要认证」继续跑，只会得到一串莫名其妙的 401。
 *
 * @param {string} url - 启动 URL（含 token）。
 * @returns {Promise<string>} 可复用的 cookie 串；profile 不需要认证时为空串。
 */
async function signIn(url) {
  // 直接把 token URL 打出去：`new URL('/', url)` 会把查询串丢掉，而那正是凭证。
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
  const text = await response.text()
  return text.includes('authentication required') ? '' : ''
}

/** 已跑过的检查，用于末尾汇总。 */
const results = []

/**
 * 记一条检查结果。
 *
 * @param {string} name - 检查名。
 * @param {boolean | null} ok - `null` 表示这次跳过了（环境里没有可用对象）。
 * @param {string} [detail] - 打印在行尾的实测值。
 */
function report(name, ok, detail = '') {
  results.push({ name, ok })
  const label = ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'
  console.log(`${label}  ${name}${detail === '' ? '' : `  — ${detail}`}`)
}

/**
 * 找一台已连接、且有「无需参数」工具的服务器：冒烟只对它下手，绝不需要构造参数。
 *
 * @param {object[]} workspaces - `/workspaces` 的答案。
 * @param {object[]} servers - `/servers` 的答案。
 * @returns {{server: object, tool: object} | null}
 */
function pickSafeTool(workspaces, servers) {
  const all = [
    ...servers.map((server) => ({ server, tools: server.tools ?? [] })),
    ...workspaces.flatMap((workspace) =>
      (workspace.servers ?? []).map((server) => ({ server, tools: server.tools ?? [] })),
    ),
  ]
  for (const entry of all) {
    if (entry.server.status !== 'connected') continue
    const tool = entry.tools.find((candidate) => {
      const required = candidate.parameters?.required
      return !Array.isArray(required) || required.length === 0
    })
    if (tool !== undefined) return { server: entry.server, tool }
  }
  return null
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
  const post = (path, body) =>
    call(url, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, jar)

  // 1. 这台 dsh 上，本插件的路由是活的
  const ping = await get('/smkit/api/ping')
  report('GET /ping answers', ping.status === 200 && ping.body?.ok === true, `status ${ping.status}`)

  // 2. 设置里有调试页开关，且是布尔而非字符串
  const settings = await get('/smkit/api/settings')
  report(
    'GET /settings reports the debug-page switch',
    settings.status === 200 && typeof settings.body?.debugPageEnabled === 'boolean',
    String(settings.body?.debugPageEnabled),
  )

  // 3. 两份清单
  const servers = await get('/smkit/api/servers')
  const workspaces = await get('/smkit/api/workspaces')
  const serverList = servers.body?.servers ?? []
  const workspaceList = workspaces.body?.workspaces ?? []
  report(
    'GET /servers and /workspaces answer lists',
    servers.status === 200 && Array.isArray(servers.body?.servers) && workspaces.status === 200 && Array.isArray(workspaces.body?.workspaces),
    `${serverList.length} 全局 / ${workspaceList.length} 工作区`,
  )

  // 4. 未打开工作区的服务器 id 必须跨两次读取一致——页面按 id 记选中项
  const again = await get('/smkit/api/workspaces')
  const idsOf = (answer) =>
    (answer.body?.workspaces ?? []).flatMap((workspace) =>
      (workspace.servers ?? []).map((server) => `${workspace.path}#${server.name}=${server.id}`),
    )
  const before = idsOf(workspaces)
  const after = idsOf(again)
  report(
    'server ids are stable across two reads',
    before.length === after.length && before.every((entry, at) => entry === after[at]),
    `${before.length} 个 id`,
  )

  // 5. 通知环可读（空环也是合法的答案）
  const anyServer = workspaceList.flatMap((workspace) => workspace.servers ?? [])[0]
  if (anyServer === undefined) {
    report('GET /debug/notifications answers a ring', null, '这个 profile 没有工作区服务器')
  } else {
    const ring = await get(`/smkit/api/debug/notifications?id=${encodeURIComponent(anyServer.id)}`)
    report(
      'GET /debug/notifications answers a ring',
      ring.status === 200 && Array.isArray(ring.body?.notifications),
      `${ring.body?.notifications?.length ?? '?'} 条`,
    )
  }

  // 6. 真调一次不需要参数的工具，并核对三种拒绝
  const safe = pickSafeTool(workspaceList, serverList)
  if (safe === null) {
    report(
      'POST /debug/call reaches a live connection',
      null,
      '没有「已连接 + 有无参工具」的服务器：先在某个工作区开一次会话，服务器连上后再跑',
    )
  } else {
    const answer = await post('/smkit/api/debug/call', { id: safe.server.id, tool: safe.tool.name, arguments: {} })
    report(
      'POST /debug/call reaches a live connection',
      answer.status === 200 && typeof answer.body?.ok === 'boolean' && typeof answer.body?.durationMs === 'number',
      `${safe.server.name}/${safe.tool.name} · ${answer.body?.ok === true ? 'ok' : 'failed'} · ${answer.body?.durationMs} ms`,
    )

    const unknownTool = await post('/smkit/api/debug/call', { id: safe.server.id, tool: 'smkit-no-such-tool' })
    report('an unknown tool is a 400', unknownTool.status === 400, `status ${unknownTool.status}`)

    const badArguments = await post('/smkit/api/debug/call', {
      id: safe.server.id,
      tool: safe.tool.name,
      arguments: [],
    })
    report('a non-object argument bag is a 400', badArguments.status === 400, `status ${badArguments.status}`)

    const unknownServer = await post('/smkit/api/debug/call', { id: 'ws-does-not-exist', tool: safe.tool.name })
    report('an unknown server id is a 409', unknownServer.status === 409, `status ${unknownServer.status}`)
  }

  // 7. 开关写得进、读得回、复得原——冒烟不留下副作用
  const original = settings.body?.debugPageEnabled === true
  const written = await post('/smkit/api/settings/debug-page', { enabled: !original })
  const reread = await get('/smkit/api/settings')
  const restored = await post('/smkit/api/settings/debug-page', { enabled: original })
  report(
    'POST /settings/debug-page persists and restores',
    written.status === 200 &&
      written.body?.debugPageEnabled === !original &&
      reread.body?.debugPageEnabled === !original &&
      restored.body?.debugPageEnabled === original,
    `写 ${!original} → 读回 ${reread.body?.debugPageEnabled} → 复原 ${restored.body?.debugPageEnabled}`,
  )

  const failed = results.filter((entry) => entry.ok === false)
  const skipped = results.filter((entry) => entry.ok === null)
  console.log(
    `\n${results.length - failed.length - skipped.length}/${results.length} passed` +
      (skipped.length === 0 ? '' : ` · ${skipped.length} skipped`),
  )
  process.exit(failed.length === 0 ? 0 : 1)
}

await main()
