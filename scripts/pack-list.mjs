#!/usr/bin/env node
/**
 * pack:list — 不解压列出当前版本 tarball 的内容。
 *
 * 文件名按 package.json 的 name + version 自动拼接（pnpm pack 的产物命名
 * 规则），版本号变更后无需改这里。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { name, version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
// 相对路径：GNU tar 会把绝对路径里的盘符冒号（E:\…）解析成远程主机名。
// scoped 包名（@smai-kit/dsh-smkit）按 pack 规则映射为 smai-kit-dsh-smkit。
const tgz = `${name.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`

try {
  execFileSync('tar', ['-tzf', tgz], { stdio: 'inherit', cwd: ROOT })
} catch {
  console.error(`pack:list: 找不到 ${tgz} —— 请先运行 pnpm pack:tgz`)
  process.exit(1)
}
