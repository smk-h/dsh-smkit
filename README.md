## 一、 项目简介

### 1. 背景

我有一个 MCP 项目 [smk-h/embedded-mcp-toolkit](https://github.com/smk-h/embedded-mcp-toolkit)，它每次启动都会写入一个日志文件。[dsh-v0.1.5-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) 原本就支持直接配置 MCP，但这种配置是全局生效的：只要 dsh 启动，就必定拉起该 MCP，并且在任何工作区都能操作它。可我大多数时候只是启动 dsh ，并不一定需要连接这个 MCP，于是每次启动都会白白多出一个日志文件。

我的需求很明确：**只在打开某个工作区时，才启用该工作区的 MCP**。顺着这个需求，找到了下面两个插件：

- [hyqhyq3/dsh-mcp-manager](https://github.com/hyqhyq3/dsh-mcp-manager)：按工作区启用 MCP，避免全局常驻
- [yangfch3/dsh-mcp-mgr](https://github.com/yangfch3/dsh-mcp-mgr)：提供重启按钮，点击即可重启 MCP

[hyqhyq3/dsh-mcp-manager](https://github.com/hyqhyq3/dsh-mcp-manager) 确实好用，满足了我的核心需求，但很快又出现了新问题：我大部分使用场景是在 Linux 服务器上通过 SSH 启动 Windows 中的 MCP，长时间不用后连接会断开，MCP 失去响应（这个我没有具体深究，右面有必要再说），这时只能重启 dsh；而「重启 MCP」的能力又只存在于 [yangfch3/dsh-mcp-mgr](https://github.com/yangfch3/dsh-mcp-mgr) 中。两者分属不同插件，总不能一次装两个，那也太麻烦了。

所以我决定参考以上两位作者的项目，用 AI 搓一个同时满足这两点的插件，以后也方便加入自己的一些需求。如有需求，请使用作者原版插件，本插件仅供自己学习使用，也许后续作者直接支持了，这里可能就会放弃这个插件了。

> [!NOTE]
> 本项目功能对齐上游 [hyqhyq3/dsh-mcp-manager](https://github.com/hyqhyq3/dsh-mcp-manager) 的 `b029407c`（v0.12.0，2026-09-11）。两个仓库没有共同提交历史，同步指功能语义对齐而非 git 合并；两者各自独立发布，版本号不互相对应。

### 2. 项目介绍

dsh-smkit 是运行在 [DeepSeek Harness（dsh）](https://deepseek-harness.github.io/deepseek-harness/) 上的 Cordis 插件，把 MCP 服务器的配置与生命周期管理收进「设置 → MCP」页面，基于 MIT 协议开源。主要能力如下：

- 在设置页统一登记、启停、编辑、删除 MCP 服务器；停用的服务器不会在启动时被拉起。
- 支持两种传输：远程 HTTP（OAuth PKCE + 动态客户端注册、静态 Bearer Token，或无鉴权），以及本地 stdio 进程。无鉴权模式不发送 `Authorization` 头，适合本机这类不做认证的端点（如 `http://127.0.0.1:9316/mcp`）。
- 按工作区隔离：工作区独享的服务器写在 `<workspace>/.dsh/dshmm/mcp.json`，全局服务器也可按工作区屏蔽。工具栏作用域选择旁可一键直接打开配置文件（全局为 `~/.dsh/mcp-manager.json` 状态文件，工作区为该工作区的 `mcp.json`）。
- 运行时可重启、关闭单个服务器的连接，长连接断开后不必重启 dsh。
- 可选的按需工具代理（broker）：开启后 MCP 仅暴露 search、describe、execute 三个工具，避免大量工具污染上下文。

插件分为宿主端与浏览器端两半，均以 TypeScript 编写：宿主端挂载 `/mcp-manager/api` 路由、管理 MCP 连接与工作区作用域，浏览器端只负责渲染设置页，两者通过同一组 API 通信。

### 3. 图标来源

设置页的图标不从图标库引入运行时依赖，而是把上游的 SVG 数据逐字移植进 [`src/client/components/icons/`](src/client/components/icons/)：每个图标一个文件、以图标名命名，文件头部注明上游库、版本与许可。当前用到的图标如下：

- `cable`：来自 [lucide](https://lucide.dev) 的同名图标，版本 v0.261.0（中文镜像站为 [lucide.nodejs.cn](https://lucide.nodejs.cn)）；用于设置导航栏「MCP」一行的字形，见 [`CableIcon.tsx`](src/client/components/icons/CableIcon.tsx)、[`nav-icon.ts`](src/client/runtime/nav-icon.ts) 与 [`nav-icon.css`](src/client/style/nav-icon.css) 的 `MCP_NAV_ICON_CSS`。
- `loader-2`：同样来自 lucide v0.261.0（后续版本更名为 `loader-circle`）；是连接中/授权中的旋转弧线，由状态点在过渡态渲染，见 [`LoaderIcon.tsx`](src/client/components/icons/LoaderIcon.tsx) 与 [`pill.css`](src/client/style/pill.css) 的 `mm_statusSpin`。

lucide 图标采用 ISC 许可：版权归 Lucide Contributors（2022）所有，其中部分版权归 Cole Bemis（2013 至 2022 年，源自 Feather 项目，MIT 许可）所有。

后续要升级或新增图标时，回到上游图标页复制 SVG，替换对应文件里 `nodes` 的路径数据，并同步更新文件头部与本节的版本记录；图标的渲染与 CSS mask 序列化统一由 [`Icon.tsx`](src/client/components/icons/Icon.tsx) 的 `createIcon()` 与 `iconMaskDataUri()` 负责，不需要为此引入任何依赖。

## 二、 插件工作原理

### 1. 加载流程

教程中的最小运行方式是：启动器创建根 Context 并挂载 Loader，Loader 读取 `cordis.yml`，把每一行 `name` 指向的模块作为子插件挂载，随后以 `ctx` 上下文调用其 `apply`；没有内容继续运行时进程自行退出。

- `name` 导出是可选的显示元数据，用于在诊断信息中标识插件。
- `apply` 抛出异常时进程会终止并明确报错，不会静默跳过。
- 模块无法解析（路径或包名拼错）时，Cordis 通过 logger 服务报告而不使进程崩溃，因此新配置项无效果时应先检查拼写。

### 2. 插件包的三个组成部分

```text
dsh-smkit/
├── package.json       # ① 声明 dsh.bundle + peerDependencies
├── cordis.patch.yml   # ② bundle 贡献的配置层：insert 一行插件挂载项
├── src/index.ts       # ③ 插件本体（教程中的函数形态插件）
│     └→ lib/index.js  #    tsc 编译产物（运行时真正加载的文件）
├── test/verify.mjs    # 离线自检（prepack 时强制跑；不随包发布）
└── tsconfig.json / pnpm-workspace.yaml
```

#### 2.1 package.json 的 manifest

[`package.json`](package.json) 中的 `dsh.bundle` 字段指向配置层文件：

```jsonc
// package.json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

插件只依赖宿主提供的 `@deepseek-ai/cordis`（`Context` 类型），以 `peerDependencies` 声明即可，由宿主环境在运行时解析，不需要打进插件包。

#### 2.2 cordis.patch.yml 配置层

教程用 `cordis.yml` 里的 `- name: './hello.ts'` 挂载本地模块。`name` 是模块指定符，可以是相对路径，也可以是 npm 包名；dsh 插件包走的正是第二种——bundle 配置层用包名挂载已安装的插件代码。

[`cordis.patch.yml`](cordis.patch.yml) 用一个 `insert` 行完成这件事：

```yaml
# cordis.patch.yml
- insert:
    - id: hello          # 行 id：用户按它覆盖/禁用
      name: 'dsh-smkit'  # 按包名引用，Node 模块解析找到已安装代码
```

`dsh plugin --profile <name> add <包>` 安装时会扫描依赖里声明了 `dsh.bundle` 的包，把它的配置层追加进 `dsh.profile.bundles`；profile 启动时按「dsh-base 基础层 → 各 bundle 层 → profile 自身配置层 → 全局覆盖层」的顺序合并。

#### 2.3 插件本体

[`src/index.ts`](src/index.ts) 与教程示例一致：

```ts
// src/index.ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'

export function apply(ctx: Context) {
  console.log('hello from my first plugin')
}
```

### 3. 三种插件形态

教程给出了三种等价的插件形态，并建议在需要公开服务之前一直使用函数形态（本仓库即函数形态）：

（1）函数插件，本仓库当前使用的形态：

```ts
export function apply(ctx: Context) {}
```

（2）对象插件，即带 `name` 与 `apply` 的对象：

```ts
export const objectPlugin = {
  name: 'object-plugin',
  apply(ctx: Context) {},
}
```

（3）类插件，即 Service 子类（教程第 3 章详解）：

```ts
export class MyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myTutorialService')
  }
}
```

## 三、 快速开始

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
dsh plugin --profile demo add E:\AI\dsh-smkit\dsh-smkit-0.1.0.tgz

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
dsh plugin --profile demo remove dsh-smkit   # 同时移除依赖和层
dsh plugin --profile demo update dsh-smkit   # pnpm update + reconcile
```

## 四、 调试

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
pnpm smkit:install --profile demo
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
pnpm smkit:install     # 打包（pnpm pack）并用 tarball 装入
pnpm smkit:uninstall   # 移除
```

然后重启 `dsh web`，启动日志里即可看到插件的 `console.log` 输出。改码后重新运行 `pnpm smkit:install` 即可更新；等价的手动操作与说明见「2.2 改码后的更新循环」。

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
