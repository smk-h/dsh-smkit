<!-- more -->

本文是 LV006 功能用例：同一 profile 同时装入上游 `dsh-mcp-manager` 时的**退避**验收。覆盖两种情况——只有本插件时 MCP 功能应正常工作；上游也在时本插件的 MCP 半应整体退避、由上游接管，其余功能照常。用例由 [`mcp-standdown.mjs`](mcp-standdown.mjs) 自动执行，本文给出前置条件、步骤与判据——脚本只负责跑，判定口径以本文为准。

## 一、 用例定位

（1）用例编号 LV006，被测功能是宿主侧 `upstreamMcpManagerInstalled()`（读 profile 的 `dsh.profile.bundles`）与客户端侧 `upstreamMcpManagerPresent()`（读启动图 `__DSH_BOOT__.entries`）两处判定，以及由此产生的三条行为：不注册 `mcp__*` 工具与 `/mcp` 命令、不注册 `mcp` 语言命名空间、设置区隐藏 MCP 页。

（2）不放进单元测试的原因：[`test/upstream-standdown.test.mjs`](../upstream-standdown.test.mjs) 只验探测函数读哪份清单，[`test/client-language.test.mjs`](../client-language.test.mjs) 用 VM 跑客户端包、断言字典与页签。两者都碰不到真实的 dsh 加载器，也复现不了「同名 locale 命名空间 + 同语言 → 整个 entry 失败」这条只有真加载器才会走的路——上线前那次白屏就是它。

（3）与人工文档的关系：[`docs/LV500-MCP管理.md`](../../docs/LV500-MCP管理.md) 的「一、服务器与作用域」记录了共存规则（装了上游则本插件 MCP 退避），本用例是它的自动化验收。

（4）适用范围：改动了插件装配、客户端 entry、语言命名空间、设置区页签、或对上游插件版本的依赖之后跑一次。

## 二、 前置条件

（1）`dsh` 在 PATH 上，目标 profile（默认 `web`）可写。用例默认先执行一次 `scripts/dsh-smkit.mjs install --profile web`；只想跑现有产物时加 `--skip-install`。

（2）**能访问 npm / GitHub**：场景 B 会用 `dsh plugin --profile web add github:hyqhyq3/dsh-mcp-manager#v0.17.0` 真的把上游装进 profile（缓存命中时几秒完成）。离线机器请在 `--upstream` 里传本地可解析的引用。

（3）playwright 可解析，无头浏览器能启动；未设 `PLAYWRIGHT_BROWSERS_PATH` 且机器上存在 `/opt/ms-playwright` 时脚本自动指向它。

（4）用例默认使用 3099 端口（可用 `--port` 改），启动前先按该端口清理自己的旧实例，不会碰你正在用的 3080。

## 三、 用例步骤

### 1. 环境准备

（1）备份 profile 的 `package.json` 与 `pnpm-lock.yaml`，用于收尾逐字节还原。

（2）按需安装本插件；若清单里已经有上游，先 `dsh plugin remove` 掉，保证场景 A 是干净基线（收尾会按运行前状态还原）。

### 2. 场景 A：只有本插件（基线）

（1）在 3099 端口拉起 `dsh web --port 3099 --no-open`，从日志里取出带 token 的访问链接。

（2）无头浏览器打开该链接，确认页面正常启动（不含 `Failed to load plugins`），并记录 `pageerror`。

（3）在页面内直接 `fetch` 三个接口：`/smkit/api/servers`、`/smkit/api/skills`、`/mcp-manager/api/servers`。

（4）打开「账户菜单 → 设置 → SMKIT」，读取页签列表。

### 3. 场景 B：两个插件同 profile

（1）`dsh plugin --profile web add <上游引用>`，确认上游出现在清单的 `dsh.profile.bundles` 里。

（2）重启 3099 端口上的实例（插件在启动时读清单，热改不生效）。

（3）重复场景 A 的三步：启动状态、三个接口、页签列表。

【**注意**】这一步是本用例的重点：上游与本插件都会 `locale.register('mcp', …)`，dsh 0.2.2 对「同名命名空间 + 同语言」直接抛错，谁后加载谁把整个客户端 entry 拖死，前端只剩 `Failed to load plugins`。退避失效时，最先崩的就是这里。

### 4. 执行方式

```sh
pnpm test:cases:standdown              # 两个场景都跑
pnpm test:cases:standdown --skip-install
node test/cases/mcp-standdown.mjs --profile web --port 3099 --upstream github:hyqhyq3/dsh-mcp-manager#v0.17.0
```

整轮耗时约 1～2 分钟，主要是两次 `dsh web` 启动（各约 12 秒）与一次上游安装。

## 四、 通过判据

两个场景各自全部满足才算通过：

**场景 A（未装上游）**

| 序号 | 判据 | 取值来源 |
| ---- | ---- | -------- |
| 1 | 页面正常启动，不含 `Failed to load plugins` | 页面正文 |
| 2 | 无 `pageerror` | 浏览器事件 |
| 3 | 设置区页签里有 `MCP` | 设置区 `[role="tab"]` 文案 |
| 4 | `/smkit/api/servers` = 200 | 页面内 `fetch` |
| 5 | `/smkit/api/skills` = 200 | 同上 |
| 6 | `/mcp-manager/api/servers` = 404（上游未装，接口不存在） | 同上 |

**场景 B（装有上游）**

| 序号 | 判据 | 取值来源 |
| ---- | ---- | -------- |
| 1 | 页面正常启动（同名 locale 不再拖垮 entry） | 页面正文 |
| 2 | 无 `pageerror` | 浏览器事件 |
| 3 | 设置区页签里**没有** `MCP` | 设置区 `[role="tab"]` 文案 |
| 4 | 设置区仍有其余页签（如 `Skills`） | 同上 |
| 5 | `/smkit/api/servers` = 404（MCP 功能未挂载） | 页面内 `fetch` |
| 6 | `/smkit/api/skills` = 200（其余功能照常） | 同上 |
| 7 | `/mcp-manager/api/servers` = 200（上游接管） | 同上 |

任何一条不满足，脚本以非零码退出，终端会打印具体是哪一条、实际状态码是多少。

## 五、 产物与清理

（1）产物不自动删除，目录为 `.tmp/test-cases/LV006/<时间戳>/`，含 `a/home.png`、`a/settings.png`、`b/home.png`、`b/settings.png`、两次启动的 `dsh-web-*.log`，以及汇总的 `result.json`（每条判据的布尔值与接口状态码）。

（2）复核方式：打开 `b/settings.png` 应只看到 Skills 等页签、没有 MCP；`result.json` 里场景 B 的七条应为 `true`。

（3）收尾会 `dsh plugin remove` 上游，再用备份**逐字节还原** profile 的 `package.json` 与 `pnpm-lock.yaml`；脚本会打印「profile 清单已还原」。**若运行前清单里本来就有上游，收尾后仍然是装着的**（还原到运行前，而不是强制清空）。

（4）`node_modules` 里残留的上游包不删除：探测读的是清单，残留不影响判定；要彻底清掉用 `dsh plugin --profile web remove dsh-mcp-manager`。

（5）用例自己起的实例按端口收尾；你正在用的实例不受影响（但 profile 清单被改动过，你那个实例重启后会按新清单加载）。

---

*本文档由 markdowncli 技能辅助生成*
