#!/usr/bin/env node
/**
 * sm_demo — 按启动参数注册工具的 stdio MCP 服务器（零依赖，可直接 node 跑）。
 *
 *   node sm_demo.mjs 1   → 注册 `who_am_i`（我叫什么？）   固定返回「苏木」
 *   node sm_demo.mjs 2   → 注册 `what_i_like`（我喜欢什么？）固定返回「摄影」
 *   node sm_demo.mjs 1 2 → 两个都注册（参数可任意组合）
 *
 * 没有参数或参数不在 {1,2} 里就打印用法并以非 0 退出，避免注册出一个空工具的服务器。
 *
 * dsh 侧的 MCP 配置（stdio）：
 *
 *   { "name": "sm-demo", "type": "stdio", "command": "node",
 *     "args": ["/绝对路径/sm_demo.mjs", "1"] }
 */

const PROTOCOL_VERSION = '2025-03-26'

/** 两份工具定义，索引与命令行数字参数一一对应。 */
const CATALOG = [
  {
    tool: {
      name: 'who_am_i',
      description: '我叫什么？',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    answer: '苏木',
  },
  {
    tool: {
      name: 'what_i_like',
      description: '我喜欢什么？',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    answer: '摄影',
  },
]

/** 取命令行里的位置参数（数字多选），返回去重后的工具列表。 */
function selectTools(argv) {
  const picked = new Set()
  for (const arg of argv) {
    const index = Number(arg)
    if (!Number.isInteger(index) || index < 1 || index > CATALOG.length) return null
    picked.add(index - 1)
  }
  return picked.size === 0 ? null : [...picked].map((i) => CATALOG[i])
}

const TOOLS = selectTools(process.argv.slice(2))

if (!TOOLS) {
  process.stdout.write(
    [
      'sm_demo — 按参数注册工具的 MCP 服务器',
      '',
      '用法：node sm_demo.mjs <序号...>',
      '',
      '  1  who_am_i     我叫什么？    → 苏木',
      '  2  what_i_like  我喜欢什么？  → 摄影',
      '',
      '示例：node sm_demo.mjs 1',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

const TOOL_BY_NAME = new Map(TOOLS.map(({ tool, answer }) => [tool.name, answer]))

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function error(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}

function handle(message) {
  // 通知（无 id，如 notifications/initialized）不回包。
  if (message.id === undefined) return

  switch (message.method) {
    case 'initialize':
      reply(message.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'sm-demo', version: '1' },
      })
      return
    case 'tools/list':
      reply(message.id, { tools: TOOLS.map(({ tool }) => tool) })
      return
    case 'tools/call': {
      const name = message.params?.name
      const answer = TOOL_BY_NAME.get(name)
      // 固定答案，只回文本内容，不标记 isError。
      if (answer !== undefined) {
        reply(message.id, { content: [{ type: 'text', text: answer }] })
        return
      }
      error(message.id, -32602, `未知工具：${name}（本次启动只注册了 ${[...TOOL_BY_NAME.keys()].join(', ')}）`)
      return
    }
    default:
      // ping 等可选请求：空结果即可跑通协议。
      reply(message.id, {})
  }
}

let buffer = ''

process.stdin.setEncoding('utf8')

process.stdin.on('data', (chunk) => {
  buffer += chunk
  // MCP 走换行分隔的 JSON：攒到整行再解析，避免 chunk 边界切断消息。
  let lf = buffer.indexOf('\n')
  while (lf !== -1) {
    const line = buffer.slice(0, lf).trim()
    buffer = buffer.slice(lf + 1)
    lf = buffer.indexOf('\n')
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    handle(message)
  }
})

// stdin 被关掉 = 客户端已断开。这里不调用 process.exit：管道写是异步的，
// 直接退出会把还没发出去的响应截断；交给事件循环自然结束即可。
process.stdin.on('close', () => {
  process.stdin.destroy()
})
