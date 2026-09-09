## 一、 项目简介

dsh-smkit 是严格按照 [Cordis 教程《第一个插件》](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/01-first-plugin)章节实现的最小示例插件，宿主为 [DeepSeek Harness（dsh）](https://deepseek-harness.github.io/deepseek-harness/)，基于 MIT 协议开源。

插件本体是教程中的函数形态 Cordis 插件：导出显示元数据 `name` 与 `apply` 函数，被加载器挂载时输出一行 `hello from my first plugin`。仓库同时补齐了教程页面未涉及的 dsh 打包部分（bundle manifest、配置层与安装验证），让它能直接通过 `dsh plugin add` 装进 profile。

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

tarball 安装的更新流程：

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

插件在启动早期被加载，`apply` 里的 `console.log` 直接写入终端。注意：TUI 类 profile 需要真实终端，管道重定向下不回显；profile 首次启动会补装基础 bundle 的依赖链，耗时较长。确认插件行为后 Ctrl+C 退出。

#### 2.4 临时配置实验

要临时试配置而不改动 profile 文件，用一次性 overlay：

```sh
dsh --profile demo --patch ./extra.yml
```

### 3. Web UI 调试

Web UI 由 web profile 独有的 `@deepseek-ai/dsh-web-app` bundle 提供（`dsh web` 等价于 `dsh --profile web`）。profile 之间互相隔离：插件装在其他 profile 时，`dsh web` 不会加载它。要把插件带进 Web UI，用 tarball 装进 web profile：

```sh
pnpm pack
dsh plugin --profile web add E:\AI\dsh-smkit\dsh-smkit-0.1.0.tgz
```

然后重启 `dsh web`，启动日志里即可看到插件的 `console.log` 输出。更新循环与「2.2 改码后的更新循环」相同；卸载用 `dsh plugin --profile web remove dsh-smkit`。

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

## 五、 目录说明与扩展方向

### 1. 目录说明

| 路径 | 说明 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 插件本体：教程《第一个插件》的函数形态（`name` + `apply`） |
| [`cordis.patch.yml`](cordis.patch.yml) | bundle 配置层：`insert` 一行 id=`hello` 的挂载项 |
| [`test/verify.mjs`](test/verify.mjs) | 离线自检（`pnpm verify` / `prepack`），确保发包前构建可用；不随包发布 |
| [`tsconfig.json`](tsconfig.json) | NodeNext、strict，`src` → `lib` |
| [`pnpm-workspace.yaml`](pnpm-workspace.yaml) | 单包工作区 + `autoInstallPeers: true`（本地类型检查用） |

### 2. 扩展方向

- **切换插件形态**：对象形态或 `class MyService extends Service` 类形态（教程第 3 章服务与依赖）。
- **注册模型可调用的工具**：`ctx.tools.register(defineTool(...))`，需补充 `@deepseek-ai/dsh-tools` 与 `@deepseek-ai/schemastery` peer（参考官方《开发一个 Tool》）。
- **事件监听**：`ctx.on('tools/result', ...)` 等，随插件卸载自动清理。
- **手动清理资源**：`ctx.effect(() => { /* 返回清理函数 */ })`。
- **UI 插件**：`package.json` 里声明 `dsh.client`（platform: web + inject 客户端服务），参考 `dsh-better-sidebar` 的双半结构。

---
*本文档由 markdowncli 技能辅助生成*
