/**
 * Verification page for the dragon-boat sidebar/texture fix: loads the REAL
 * ported skin CSS verbatim, then renders a minimal DSH-like shell whose
 * sidebar consumes `var(--dsw-specific-sidebar-fill)` — the same token the
 * real shell paints the rail with — so the fix can be asserted in a browser.
 * Buttons toggle the skin attribute and day/night; screenshots + computed
 * styles prove: light sidebar #fafcf8 / dark #101a14, no weave texture.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const SKIN_CSS = readFileSync(
  'E:/AI/dsh-smkit/src/client/features/theme/style/skin-festival-dragonboat.css',
  'utf8',
)

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>端午皮肤修复验证 · 侧边栏令牌 + 纹理移除</title>
<style>${SKIN_CSS}</style>
<style>
  /* minimal shell: consumes the same tokens the real DSH shell does */
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
  .controls {
    display: flex; gap: 10px; padding: 10px 14px;
    background: #26292e; position: sticky; top: 0; z-index: 99;
  }
  .controls button {
    font-size: 12px; padding: 5px 12px; border-radius: 6px; cursor: pointer;
    border: 1px solid #565b63; background: #32363d; color: #e8eaed;
  }
  .controls button.on { background: #2e7d4f; border-color: #2e7d4f; color: #fff; }
  .app { display: flex; flex-direction: column; height: calc(100vh - 46px); }
  .titlebar {
    height: 44px; display: flex; align-items: center; padding: 0 16px;
    font-weight: 600; font-size: 14px;
    background: var(--bg-1, #fff); color: var(--text-primary, #222);
    border-bottom: 1px solid rgba(0,0,0,.06);
  }
  .frame { display: flex; flex: 1; min-height: 0; }
  .sidebar {
    width: 232px; flex: none; padding: 12px 10px; overflow: auto;
    background: var(--dsw-specific-sidebar-fill, #f7f7f7);
  }
  .sidebar .label { font-size: 11px; color: var(--text-secondary, #888); margin: 4px 8px 10px; }
  .nav-item {
    padding: 8px 10px; border-radius: 8px; font-size: 13px; margin-bottom: 2px;
    color: var(--text-primary, #333);
  }
  .nav-item.active {
    background: var(--dsw-specific-sidebar-nav-item-active, #eee);
    color: var(--text-primary, #222); font-weight: 600;
  }
  .nav-item:not(.active):hover { background: var(--dsw-specific-sidebar-nav-item-hover, #f2f2f2); }
  .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .chat { flex: 1; overflow: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; }
  .bubble {
    max-width: 72%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.6;
    background: var(--color-bg-2, #f4f4f4); color: var(--text-primary, #222);
  }
  .bubble.user {
    align-self: flex-end;
    background: var(--dsw-specific-bubble, #f4f4f4);
    color: var(--dsw-static-text-on-bubble, #fff);
  }
  .chat-spacer { flex: 1; }
  pre {
    margin: 0; padding: 12px 14px; border-radius: 8px; font-size: 12.5px;
    background: #f6f8f7; color: #333;
  }
  .inputbar { padding: 12px 24px 18px; }
  .inputbar .box {
    display: flex; align-items: center; gap: 10px;
    border: 1px solid var(--border-base, #ddd); border-radius: 12px; padding: 8px 10px;
    background: var(--color-bg-1, #fff);
  }
  .inputbar .ph { flex: 1; font-size: 13px; color: var(--text-disabled, #aaa); }
  .inputbar button {
    font-size: 12.5px; padding: 6px 16px; border: none; border-radius: 8px;
    cursor: pointer; color: #fff; background: var(--color-brand-fill, #4aae76);
  }
</style>
</head>
<body>
<div class="controls">
  <button id="skin" class="on" onclick="toggleSkin()">皮肤 data-dsh-festival-dragonboat：开</button>
  <button id="mode" onclick="toggleMode()">显示模式：浅色</button>
  <button onclick="report()">打印计算样式</button>
</div>
<div class="app">
  <div class="titlebar">DeepSeek Harness</div>
  <div class="frame">
    <div class="sidebar">
      <div class="label">会话</div>
      <div class="nav-item">帮我写个周报模板</div>
      <div class="nav-item active">主题预览截图管线</div>
      <div class="nav-item">解释 CSS color-mix</div>
      <div class="nav-item">整理本周 TODO</div>
    </div>
    <div class="main">
      <div class="chat">
        <div class="bubble">你好！我是 DeepSeek Harness 助手。这是用于验证端午皮肤修复的模拟对话：标题栏、侧边栏、气泡和输入框都会应用当前主题的配色。</div>
        <div class="bubble user">把侧边栏改成浅透明绿，去掉背景的树叶纹理。</div>
        <div class="bubble">好的。侧边栏现在读取 <code>--dsw-specific-sidebar-fill</code>（浅色 #fafcf8、深色 #101a14），与官方预览图一致；全页的织纹/波点覆盖层已删除。</div>
        <pre>const sidebar = getComputedStyle(document.querySelector('.sidebar')).backgroundColor
// 浅色预期: rgb(250, 252, 248)  = #fafcf8
// 深色预期: rgb(16, 26, 20)     = #101a14</pre>
        <div class="chat-spacer"></div>
      </div>
      <div class="inputbar">
        <div class="box">
          <span class="ph">发消息给 DeepSeek Harness…</span>
          <button>发送</button>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
  function toggleSkin() {
    const on = document.body.toggleAttribute('data-dsh-festival-dragonboat')
    document.getElementById('skin').textContent = '皮肤 data-dsh-festival-dragonboat：' + (on ? '开' : '关')
    document.getElementById('skin').classList.toggle('on', on)
  }
  function toggleMode() {
    const dark = document.body.toggleAttribute('data-ds-dark-theme')
    document.getElementById('mode').textContent = '显示模式：' + (dark ? '深色' : '浅色')
  }
  function report() {
    const cs = (sel, pseudo) => getComputedStyle(document.querySelector(sel), pseudo || null)
    const body = cs('body')
    const before = cs('body', '::before')
    const after = cs('body', '::after')
    window.__report = {
      sidebarFill: cs('.sidebar').backgroundColor,
      navActive: cs('.nav-item.active').backgroundColor,
      bodyBg: body.backgroundColor,
      bodyBeforeContent: before.content,
      bodyBeforeImage: before.backgroundImage,
      bodyAfterImage: after.backgroundImage,
    }
    console.log(JSON.stringify(window.__report, null, 2))
    document.title = JSON.stringify(window.__report)
  }
</script>
</body>
</html>
`

writeFileSync('E:/AI/dsh-themes/design/smkit-skin-check.html', html)
console.log('written E:/AI/dsh-themes/design/smkit-skin-check.html')
