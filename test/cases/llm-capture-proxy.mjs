#!/usr/bin/env node
/**
 * 旁路抓包代理 —— LV007 用来观察「模型实际收到的工具定义」。
 *
 * 只做两件事：把请求原样转给 `LV007_UPSTREAM`，以及把请求体里的 MCP 工具条目
 * （名字、描述、参数表）追加到 `LV007_LOG`。请求头不落盘，密钥不会进日志。
 *
 *   LV007_PORT=8898 LV007_UPSTREAM=https://example.com/radeon/api/v1 \
 *   LV007_LOG=/tmp/requests.jsonl node test/cases/llm-capture-proxy.mjs
 *
 * 上游中断（dsh 在 turn 结束时会主动断开）不能把代理带走，所以 req/res 与
 * 上游管道都挂了错误处理。
 */

import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'

const upstream = process.env.LV007_UPSTREAM
const port = Number(process.env.LV007_PORT ?? 0)
const log = process.env.LV007_LOG

if (!upstream || !port || !log) {
  console.error('缺少 LV007_UPSTREAM / LV007_PORT / LV007_LOG')
  process.exit(2)
}

const origin = new URL(upstream).origin

const server = createServer(async (req, res) => {
  req.on('error', () => {})
  res.on('error', () => {})
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks)

  if (body.length > 0) {
    try {
      const parsed = JSON.parse(body.toString('utf8'))
      const tools = Array.isArray(parsed.tools) ? parsed.tools : []
      const mcp = tools.filter((tool) => String(tool.function?.name ?? tool.name).startsWith('mcp'))
      appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), mcp })}\n`)
    } catch {
      appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), parse: 'failed' })}\n`)
    }
  }

  try {
    const response = await fetch(`${origin}${req.url}`, {
      method: req.method,
      headers: { ...req.headers, host: new URL(upstream).host },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    })
    const headers = {}
    for (const [key, value] of response.headers) {
      if (['content-encoding', 'transfer-encoding', 'connection'].includes(key)) continue
      headers[key] = value
    }
    res.writeHead(response.status, headers)
    if (response.body) {
      const stream = Readable.fromWeb(response.body)
      stream.on('error', () => res.destroy())
      stream.pipe(res)
    } else res.end()
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `capture proxy failed: ${error.message}` } }))
  }
})

server.listen(port, '127.0.0.1', () => console.log(`capture proxy on 127.0.0.1:${port} → ${origin}`))
