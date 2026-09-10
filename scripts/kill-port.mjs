#!/usr/bin/env node
/**
 * kill-port — 查出监听指定端口的进程，经确认后终止，用于解除端口占用。
 *
 *   pnpm port:kill <port> [--yes]
 *
 * Windows 走 netstat / tasklist / taskkill；POSIX 走 lsof / ps / kill。
 * --yes 跳过确认。
 */

import { spawnSync } from 'node:child_process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const args = process.argv.slice(2)
const yes = args.includes('--yes') || args.includes('-y')
const port = args.find((a) => /^\d+$/.test(a)) || '3080'

if (+port < 1 || +port > 65535) {
  console.log('usage: pnpm port:kill <port> [--yes]')
  process.exit(1)
}

const isWindows = process.platform === 'win32'

function runCapture(command) {
  const r = spawnSync(command, { shell: true, encoding: 'utf8' })
  return (r.stdout || '').trim()
}

function listeners() {
  if (isWindows) {
    const out = runCapture(`netstat -ano | findstr /C:":${port} "`)
    const pids = new Set()
    for (const line of out.split(/\r?\n/)) {
      if (/LISTENING/i.test(line)) {
        const pid = line.trim().split(/\s+/).pop()
        if (pid && pid !== '0') pids.add(pid)
      }
    }
    return [...pids]
  }
  return [...new Set(runCapture(`lsof -ti tcp:${port} -sTCP:LISTEN`).split(/\r?\n/).filter(Boolean))]
}

function describe(pid) {
  if (isWindows) {
    const name = runCapture(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`)
      .split(/\r?\n/)
      .filter(Boolean)[0]
      ?.match(/^"([^"]+)"/)?.[1] ?? '(unknown)'
    const cl = spawnSync(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
      { shell: true, encoding: 'utf8' },
    )
    return { pid, name, cmdline: (cl.stdout || '').trim() || '(无法获取命令行)' }
  }
  const cmdline = runCapture(`ps -p ${pid} -o command=`) || '(无法获取命令行)'
  return { pid, name: cmdline.split(' ')[0], cmdline }
}

const pids = listeners()
if (pids.length === 0) {
  console.log(`port:kill: 端口 ${port} 没有监听进程`)
  process.exit(0)
}

console.log(`端口 ${port} 被以下进程监听：\n`)
for (const pid of pids) {
  const { name, cmdline } = describe(pid)
  console.log(`  PID ${pid}  ${name}`)
  console.log(`    ${cmdline}\n`)
}

let confirmed = yes
if (!confirmed) {
  const rl = readline.createInterface({ input, output })
  const answer = (await rl.question('终止以上进程？(y/N) ')).trim().toLowerCase()
  rl.close()
  confirmed = answer === 'y' || answer === 'yes'
}

if (!confirmed) {
  console.log('port:kill: 已取消')
  process.exit(0)
}

for (const pid of pids) {
  const kill = isWindows
    ? spawnSync(`taskkill /PID ${pid} /T /F`, { shell: true, encoding: 'utf8' })
    : spawnSync(`kill -9 ${pid}`, { shell: true, encoding: 'utf8' })
  if (kill.status !== 0) {
    process.stderr.write(kill.stderr || `port:kill: 终止 PID ${pid} 失败\n`)
    process.exit(kill.status ?? 1)
  }
  console.log(`port:kill: 已终止 PID ${pid}`)
}
