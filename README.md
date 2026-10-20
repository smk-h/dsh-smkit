## 一、 项目简介

### 1. 背景

我有一个 MCP 项目 [smk-h/embedded-mcp-toolkit](https://github.com/smk-h/embedded-mcp-toolkit)，它每次启动都会写入一个日志文件。[dsh-v0.1.5-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) 原本就支持直接配置 MCP，但这种配置是全局生效的：只要 dsh 启动，就必定拉起该 MCP，并且在任何工作区都能操作它。可我大多数时候只是启动 dsh ，并不一定需要连接这个 MCP，于是每次启动都会白白多出一个日志文件。

我的需求很明确：**只在打开某个工作区时，才启用该工作区的 MCP**。顺着这个需求，找到了下面两个插件：

- [hyqhyq3/dsh-mcp-manager](https://github.com/hyqhyq3/dsh-mcp-manager)：按工作区启用 MCP，避免全局常驻
- [yangfch3/dsh-mcp-mgr](https://github.com/yangfch3/dsh-mcp-mgr)：提供重启按钮，点击即可重启 MCP

[hyqhyq3/dsh-mcp-manager](https://github.com/hyqhyq3/dsh-mcp-manager) 确实好用，满足了我的核心需求，但很快又出现了新问题：我大部分使用场景是在 Linux 服务器上通过 SSH 启动 Windows 中的 MCP，长时间不用后连接会断开，MCP 失去响应（这个我没有具体深究，右面有必要再说），这时只能重启 dsh（现在本插件已支持掉线自动重连，见 [LV500-MCP管理](docs/LV500-MCP管理.md) 的「掉线自动重连」，不必再手动重启）；而「重启 MCP」的能力又只存在于 [yangfch3/dsh-mcp-mgr](https://github.com/yangfch3/dsh-mcp-mgr) 中。两者分属不同插件，总不能一次装两个，那也太麻烦了。

所以我决定参考以上两位作者的项目，用 AI 搓一个同时满足这两点的插件，以后也方便加入自己的一些需求。如有需求，请使用作者原版插件，本插件仅供自己学习使用，也许后续作者直接支持了，这里可能就会放弃这个插件了。

> [!NOTE]
> 本项目功能对齐上游 [hyqhyq3/dsh-mcp-manager](https://github.com/hyqhyq3/dsh-mcp-manager) 的 `b029407c`（v0.12.0，2026-09-11）。两个仓库没有共同提交历史，同步指功能语义对齐而非 git 合并；两者各自独立发布，版本号不互相对应。

### 2. 项目介绍

dsh-smkit 是运行在 [DeepSeek Harness（dsh）](https://deepseek-harness.github.io/deepseek-harness/) 上的 Cordis 插件，基于 MIT 协议开源，目前提供九个功能。各功能的完整说明放在 `docs/` 下，按编号一篇一个功能：

| 功能 | 说明 | 文档 |
| --- | --- | --- |
| MCP 管理 | 按工作区登记、启停 MCP 服务器，支持按需工具代理、调用超时与掉线自动重连 | [LV500-MCP管理](docs/LV500-MCP管理.md) |
| 技能管理 | 用户与项目两档列出 Agent Skills，可原地启停与移除 | [LV501-技能管理](docs/LV501-技能管理.md) |
| 删除会话 | 真正删掉当前会话的本地数据，而非像归档那样只隐藏 | [LV502-删除会话](docs/LV502-删除会话.md) |
| 自定义配置 | 收拢模型重试等不常改、又值得单独调的配置，写回 dsh 自己的 `settings.yaml` | [LV503-自定义配置](docs/LV503-自定义配置.md) |
| OpenSpec 管理 | 查看、初始化，或连同技能与命令一起清掉工作区的 OpenSpec store | [LV504-OpenSpec管理](docs/LV504-OpenSpec管理.md) |
| 主题中心 | One Dark Pro 配色，以及 VS Code 式的分区卡片工作台 | [LV505-主题中心](docs/LV505-主题中心.md) |
| 完成通知 | 任务完成、出错或需要人操作时提醒，投递在浏览器 Web 通知与原生 toast 之间分路 | [LV506-完成通知](docs/LV506-完成通知.md) |
| 跳转到行 | 只读文件预览里按 `Ctrl+G` 跳到指定行，并把目标行留下作落点 | [LV507-跳转到行](docs/LV507-跳转到行.md) |
| 添加到对话 | 在预览或终端里选中文本右键，写进当前会话的输入框草稿 | [LV508-添加到对话](docs/LV508-添加到对话.md) |

插件是什么形态、如何被 dsh 加载、一个插件包由哪三部分组成，见 [LV010-插件工作原理](docs/LV010-插件工作原理.md)。

### 3. 图标来源

插件的图标不从图标库引入运行时依赖，而是把上游的 SVG 数据内联进 [`src/client/platform/icons/`](src/client/platform/icons/)（多个页面共用的字形）与各特性的 `icons/` 目录（只有一个页面画的字形）：每个图标一个文件、以图标名命名，文件头部注明上游库、版本与许可。来源主要两处：

- [lucide](https://lucide.dev)（中文镜像站为 [lucide.nodejs.cn](https://lucide.nodejs.cn)，新增图标一律从这个站点取）：导航图标、搜索与清空、刷新、连接中的弧线，以及「添加到对话」右键菜单首行的对话气泡加号（`message-square-plus`）。采用 ISC 许可，版权归 Lucide Contributors（2022）所有，其中部分版权归 Cole Bemis（2013 至 2022 年，源自 Feather 项目，MIT 许可）所有。
- 宿主自带的 `@deepseek-ai/dsh-client-ui-primitives`（MIT，© 2026 DeepSeek）：删除、作用域选择器（全局 / 项目 / 展开箭头 / 选中打勾），以及复制——文件树的复制路径行与该菜单的复制行共用同一枚，复制这个动作用的就是宿主自己那枚字形。

后续要升级或新增图标时，回到上游图标页复制 SVG，替换对应文件里 `nodes` 的路径数据，并同步更新文件头部；图标的渲染与 CSS mask 序列化统一由 [`Icon.tsx`](src/client/platform/icons/Icon.tsx) 的 `createIcon()` 与 `iconMaskDataUri()` 负责，菜单行这类要「元素而非组件」的调用点用同文件的 `iconElement()`，不需要为此引入任何依赖。

## 二、 快速开始

### 1. 本地开发

```sh
pnpm install        # 装 devDeps（peer 会自动拉下来供类型检查）
pnpm build          # tsc 编译 src → lib
pnpm verify         # 离线自检：模块形态 / apply 输出 / 配置层与 manifest 一致性
pnpm dev            # watch 模式
```

### 2. 安装进 profile

```sh
# 方式 A：本地 checkout（跨盘符时不可用，见下方说明）
dsh plugin --profile demo add E:/AI/dsh-smkit

# 方式 B：tarball（预构建，免 allowBuilds 授权；跨盘符开发用这个）
pnpm pack
dsh plugin --profile demo add E:\AI\dsh-smkit\smai-kit-dsh-smkit-<version>.tgz

# 方式 C：git（安装时执行 prepare 脚本构建 lib/）
dsh plugin --profile demo add github:smk-h/dsh-smkit
```

方式 A 实测注意：当 profile（通常在 `C:` 盘的 `$DSH_HOME`）与项目不在同一盘符时，pnpm 会把 `link:` 目标当相对路径解析，在 profile 的 `node_modules` 下生成坏 junction，dsh 启动时警告 `dsh-smkit declares no dsh.bundle`，插件不会进层。此时改用方式 B。

方式 C 安装时 pnpm 会执行 `prepare` 脚本构建 `lib/`，需要先在 profile 的 `pnpm-workspace.yaml` 里授权构建脚本：

```yaml
# $DSH_HOME/profiles/demo/pnpm-workspace.yaml
allowBuilds:
  dsh-smkit: true
```

可用 `github:smk-h/dsh-smkit#<sha>` 锁定 commit。

### 3. 验证

```sh
dsh --profile demo --dump-config | Select-String "dsh-smkit" -Context 1
#   # == dsh-smkit
#   - id: hello
#     name: dsh-smkit
```

启动该 profile 时，加载器挂载插件并以 `ctx` 调用 `apply`，控制台输出教程预期的 `hello from my first plugin`。

### 4. 卸载与更新

```sh
dsh plugin --profile demo remove @smai-kit/dsh-smkit   # 同时移除依赖和层
dsh plugin --profile demo update @smai-kit/dsh-smkit   # pnpm update + reconcile
```

## 三、 调试

调试分两条路径：项目内调试不启动 dsh，改码后快速验证插件本体；宿主内调试把插件装进 profile，在真实 dsh 环境里验证挂载、启动与运行。两种路径都可以挂 VSCode 断点（见本章第 4 节）。

### 1. 项目内调试（不启动 dsh）

最快的回归循环是离线自检。`test/verify.mjs` 模拟加载器行为：以 ESM 方式 import `lib/index.js`、检查具名导出、调用 `apply` 并断言输出：

```sh
pnpm build && pnpm verify
```

要跳过编译直接跑 TypeScript 源码，建一个临时入口 `.scratch-run.ts`（用完删除）：

```ts
// .scratch-run.ts
import { apply } from './src/index.ts'

apply({})
```

```sh
pnpm dlx tsx .scratch-run.ts
# hello from my first plugin
```

### 2. 宿主内调试

前提：插件已按「三、 快速开始」装入 profile（下文以 `demo` 为例）。

#### 2.1 验证挂载与加载

先确认配置层已合成：

```sh
dsh --profile demo --dump-config | grep -A 2 dsh-smkit
# # == dsh-smkit
# - id: hello
#   name: dsh-smkit
```

再以与宿主加载器相同的解析方式，验证模块能从 profile 里加载运行：

```sh
cd ~/.dsh/profiles/demo && node -e "import('dsh-smkit').then(m => m.apply({}))"
# hello from my first plugin
```

#### 2.2 改码后的更新循环

仓库根目录的辅助脚本可一步完成打包与装入：

```sh
node scripts/dsh-smkit.mjs install --profile demo
```

等价的手动流程：

```sh
pnpm build                                  # 编译 src → lib
pnpm pack                                   # 重新打包（内含 lib/）
dsh plugin --profile demo install --force   # 在 profile 里重新拉取 tarball
```

顺手递增 `package.json` 的版本号再重新 `add`，可避免同名 tarball 被视为未变化。

#### 2.3 启动与日志

```sh
dsh --profile demo
```

插件在启动早期被加载，`apply` 里的 `console.log` 直接写入终端。注意：TUI 类 profile 需要真实终端，管道重定向下不回显；profile 首次启动会补装基础 bundle 的依赖链，耗时较长。确认插件行为后 Ctrl+C 退出。若启动报 `EADDRINUSE`（端口被残留进程占用），用 `pnpm port:kill <port>` 查出占用进程并确认终止。

#### 2.4 临时配置实验

要临时试配置而不改动 profile 文件，用一次性 overlay：

```sh
dsh --profile demo --patch ./extra.yml
```

profile 目录位于 `$DSH_HOME/profiles/<name>`，可用 `pnpm dsh:config` 在文件管理器中打开配置根目录。

### 3. Web UI 调试

Web UI 由 web profile 独有的 `@deepseek-ai/dsh-web-app` bundle 提供（`dsh web` 等价于 `dsh --profile web`）。profile 之间互相隔离：插件装在其他 profile 时，`dsh web` 不会加载它。要把插件带进 Web UI，运行辅助脚本（默认装入 web profile，`--profile` 可指定其他）：

```sh
pnpm smkit:web:install     # 打包（pnpm pack）并用 tarball 装入
pnpm smkit:web:uninstall   # 移除
```

然后重启 `dsh web`，启动日志里即可看到插件的 `console.log` 输出。改码后重新运行 `pnpm smkit:web:install` 即可更新；等价的手动操作与说明见「2.2 改码后的更新循环」。

桌面端同理，但 desktop profile 由 Electron 应用独占管理（`dsh --profile desktop` 一律被拒，只有桌面端自带包装器的 `plugin` 子命令例外），所以脚本会先定位桌面端安装目录、再用它自带的 CLI 转 pnpm，并给了一份省掉 `--profile desktop` 的别名：

```sh
pnpm smkit:desktop:install     # 装入（要求应用完全退出）
pnpm smkit:desktop:uninstall   # 移除
pnpm smkit:desktop:kill        # 终止桌面端进程，--yes 跳过确认
pnpm smkit:desktop:debug       # 杀应用 → 装入 → 重新拉起应用
```

找不到安装目录时用 `DSH_DESKTOP_ROOT` 指给它；装完重启桌面端，在插件页确认该 bundle 已启用。

两点提示：

- 当前插件只输出一行日志，Web UI 里没有可交互的内容；后期在 `apply` 里注册工具后，就可以在 Web UI 对话中调用工具并观察入参与返回，那才是 Web UI 调试的主战场。
- `dsh --profile demo` 这类自定义 profile 不含 `@deepseek-ai/dsh-web-app`，只加载插件、不监听端口、也不会打开浏览器，不能用它调 Web UI。

### 4. 断点调试

本插件编译时开启了 sourceMap，断点可以直接打在 `src/index.ts` 上，两种场景分别配置。

项目内断点用 launch 方式——直接以调试器运行自检脚本，`.vscode/launch.json` 加入：

```jsonc
// .vscode/launch.json
{
  "type": "node",
  "request": "launch",
  "name": "verify 自检",
  "program": "${workspaceFolder}/test/verify.mjs",
  "outFiles": ["${workspaceFolder}/lib/**/*.js"]
}
```

宿主内断点用 attach 方式——dsh 本体是 Node 脚本（`node_global\node_modules\@deepseek-ai\dsh\lib\bin.js`），插件在宿主进程内加载，先以 inspector 启动 profile，再在 VSCode 里 attach：

```sh
NODE_OPTIONS=--inspect-brk dsh --profile demo
```

```jsonc
// .vscode/launch.json 追加 attach 配置
{
  "type": "node",
  "request": "attach",
  "name": "attach dsh",
  "port": 9229,
  "outFiles": ["${workspaceFolder}/lib/**/*.js"]
}
```

断点打在 `lib/index.js`，sourceMap 会映射回 `src/index.ts`。

---
*本文档由 markdowncli 技能辅助生成*
