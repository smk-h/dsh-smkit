#!/usr/bin/env node
/**
 * dsh-smkit — 把本插件装入 / 卸出 dsh profile 的辅助脚本。
 *
 *   pnpm smkit:install   [--profile web]
 *   pnpm smkit:uninstall [--profile web]
 *
 * install 走 tarball 方式：pnpm pack（prepack 会先跑 tsc + verify）打包后
 * 用绝对路径 add 进 profile。不使用 link:/相对路径——profile 与项目跨盘符时
 * pnpm 会把 link: 目标当相对路径解析，生成坏 junction。
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = 'dsh-smkit'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const args = { _: [], profile: 'web' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profile' || argv[i] === '-p') {
      args.profile = argv[++i] || args.profile
    } else {
      args._.push(argv[i])
    }
  }
  return args
}

function run(command, { capture = false } = {}) {
  const r = spawnSync(command, {
    shell: true,
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (r.status !== 0) {
    if (r.stderr) process.stderr.write(r.stderr)
    process.exit(r.status ?? 1)
  }
  return r.stdout || ''
}

const { _: args, profile } = parseArgs(process.argv.slice(2))

if (args[0] === 'install') {
  const out = run('pnpm pack', { capture: true })
  const lines = out.split(/\r?\n/).filter(Boolean)
  const tgz = lines[lines.length - 1]
  if (!/\.tgz$/.test(tgz)) {
    console.error(`install: 无法从 pnpm pack 输出解析 tarball 文件名：\n${out}`)
    process.exit(1)
  }
  run(`dsh plugin --profile ${profile} add "${path.join(ROOT, tgz)}"`)
  console.log(`\ninstall: ${PLUGIN} 已装入 profile "${profile}"`)
  console.log('如 dsh web 正在运行，重启后生效：dsh web')
} else if (args[0] === 'uninstall') {
  run(`dsh plugin --profile ${profile} remove ${PLUGIN}`)
  console.log(`\nuninstall: ${PLUGIN} 已从 profile "${profile}" 移除`)
  console.log('如 dsh web 正在运行，重启后生效：dsh web')
} else {
  console.log('用法：pnpm smkit:install|uninstall [--profile <name>]（默认 profile 为 web）')
}
