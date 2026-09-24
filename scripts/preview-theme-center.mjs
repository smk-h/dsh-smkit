/**
 * Visual smoke test for the merged theme center: one page carrying the REAL
 * shipped `row.css` and `palette.css` (read verbatim from `src/`), the 16 cards
 * rendered exactly as `ThemeCenterRow` renders them, the palette panel rendered
 * exactly as `PalettePanel` renders it, and a mock shell that proves the three
 * migrated skins still paint.
 *
 * Three things it exists to make visible, because none is provable by a unit
 * test:
 *
 * 1. **The card.** The markup is transcribed from the component — day panel,
 *    night strip, contrast badge, palette strip — and the CSS is the shipped
 *    file. What a screenshot shows is what the row draws, at the widths the
 *    settings column gives it.
 * 2. **The rescope.** The three skins' stylesheets are injected verbatim from
 *    `themes.data.json`, which is to say scoped on `body[data-dsh-theme="<id>"]`
 *    rather than on the `body[data-dsh-<dataset>]` they shipped with. The shell
 *    demo applies them the way `apply.ts` does — the attribute on the body, the
 *    sheet swapped into one `<style>` element — and prints the computed colors
 *    it can read back, so a silently-unmatched selector would show as an
 *    unpainted rail or a wrong fill instead of a plausible page.
 * 3. **The palette's start values.** The panel claims every slider starts on the
 *    color the element has right now; this page resolves the same registry
 *    through the same probe (`color: var(--token, fallback)`, computed value read
 *    back) and prints the raw result for all eighteen tokens, live, as the theme
 *    and the day/night attribute move. A token that resolved to nothing would
 *    print its fallback and be visible as such.
 *
 * The registry and the labels are parsed out of the real `palette.ts` and
 * `i18n/zh.ts` rather than retyped, so a token added to the panel shows up here
 * without an edit.
 *
 * Run: node scripts/preview-theme-center.mjs   → prints the page it wrote
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CENTER = `${ROOT}/src/client/features/theme-center`
const read = (relative) => readFileSync(`${CENTER}/${relative}`, 'utf8')

const ROW_CSS = read('style/row.css')
const PALETTE_CSS = read('style/palette.css')
const THEMES = JSON.parse(read('themes.data.json'))

const OUT = join(tmpdir(), 'dsh-smkit-theme-center.html')

/* ------------------------------------------------- the panel's own registry */

/** The groups and their items, in panel order, out of `palette.ts` itself. */
function readRegistry() {
  const source = read('palette.ts')
  const groups = []
  const groupPattern = /labelKey:\s*'(group\w+)',\s*items:\s*\[([\s\S]*?)\n {4}\]/g
  for (const match of source.matchAll(groupPattern)) {
    const items = [...match[2].matchAll(/token:\s*'([^']+)',\s*labelKey:\s*'(\w+)',\s*fallback:\s*'([^']+)'/g)].map(
      (item) => ({ token: item[1], labelKey: item[2], fallback: item[3] }),
    )
    groups.push({ labelKey: match[1], items })
  }
  if (groups.length === 0) throw new Error('palette.ts: no groups parsed')
  return groups
}

/** The Chinese copy for the keys above, out of `i18n/zh.ts`. */
function readLabels() {
  const out = {}
  for (const match of read('i18n/zh.ts').matchAll(/^\s{2}([A-Za-z_][\w-]*):\s*"([^"]*)",$/gm)) {
    out[match[1]] = match[2]
  }
  return out
}

const REGISTRY = readRegistry()
const LABELS = readLabels()

/* ------------------------------------------------------------------- page */

/** The `--dsw-alias-*` values the shell would inject. The real shell always
 * defines these; the page has to stand in for it or every `var()` in the two
 * stylesheets resolves to nothing and the page renders unstyled. */
const TOKEN_STUBS = `
:root{
  --dsw-alias-label-primary:#1f2430;
  --dsw-alias-label-secondary:#5c6472;
  --dsw-alias-label-tertiary:#8b929e;
  --dsw-alias-bg-layer-1:#ffffff;
  --dsw-alias-bg-layer-2:#f4f5f7;
  --dsw-alias-bg-layer-3:#eceef1;
  --dsw-alias-bg-multi-select:#ffffff;
  --dsw-alias-bg-base:#f6f7f9;
  --dsw-alias-border-l1:#e8eaee;
  --dsw-alias-border-l2:#dde0e6;
  --dsw-alias-border-l4:#c3c8d2;
  --dsw-alias-brand-primary:#0e7490;
  --dsw-alias-interactive-bg-hover:rgba(31,36,48,.06);
  --dsw-alias-scrollbar-bg-l1:rgba(31,36,48,.18);
  --dsw-alias-scrollbar-hover-l1:rgba(31,36,48,.30);
}
`

const PAGE_CSS = `
*{box-sizing:border-box}
body{margin:0;font-family:'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);transition:background-color .15s}
.wrap{max-width:1000px;margin:0 auto;padding:24px 24px 60px;display:flex;flex-direction:column;gap:22px}
.panel{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:4px 20px 18px;transition:background-color .15s,border-color .15s}
.note{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary);margin:0;padding-top:12px}
h2{font-size:13px;font-weight:500;margin:0;padding:16px 0 10px;color:var(--dsw-alias-label-primary)}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding-bottom:12px}
.bar select,.bar button{font-size:12px;line-height:20px;padding:3px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;cursor:pointer}
.bar button[data-on="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.shell{display:flex;height:190px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden}
.shell-rail{width:126px;flex:none;padding:12px 10px;display:flex;flex-direction:column;gap:4px;background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-2))}
.shell-brand{font-size:12px;font-weight:600;padding:0 6px 8px}
.shell-item{font-size:12px;line-height:18px;padding:5px 8px;border-radius:6px}
.shell-item[data-on="true"]{background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.06))}
.shell-canvas{flex:1;min-width:0;padding:14px;display:flex;flex-direction:column;gap:9px}
.shell-title{font-size:13px;font-weight:600}
.shell-bubble{align-self:flex-start;max-width:70%;font-size:12px;line-height:18px;padding:6px 11px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05))}
.shell-cta{align-self:flex-start;border:none;border-radius:8px;padding:6px 14px;font-size:12px;color:#fff;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#333));cursor:pointer}
.report{font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:18px;white-space:pre-wrap;color:var(--dsw-alias-label-secondary);padding-top:10px}
.readout{width:100%;border-collapse:collapse;font-family:ui-monospace,Consolas,monospace;font-size:11px}
.readout th{text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l1);padding:4px 8px 4px 0}
.readout td{padding:3px 8px 3px 0;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.readout td.sw{width:26px}
.readout i{display:block;width:18px;height:18px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2)}
`

/** One palette chip, as the component renders it. */
const chip = (color) =>
  `<span class="dt_chip"><span class="dt_dot" style="background:${color}"></span><span class="dt_hex">${color}</span></span>`

/** One card, transcribed from `ThemeCenterRow`'s markup and style props. */
function card(theme, active) {
  const [bg, surface, accent, text] = theme.swatch.light
  const [nightBg, , , nightFg] = theme.swatch.dark
  const vars = [
    `--dt-day-bg:${bg}`,
    `--dt-day-fg:${text}`,
    `--dt-day-accent:${accent}`,
    `--dt-night-bg:${nightBg}`,
    `--dt-night-fg:${nightFg}`,
  ].join(';')
  return `
  <button type="button" class="dt_card" data-on="${active}" aria-pressed="${active}"
          title="${theme.nameZh} · ${theme.name}" style="${vars}">
    <span class="dt_prev">
      <span class="dt_day">
        <span class="dt_daytop"><span class="dt_aa">Aa</span><span class="dt_bub">用户消息…</span></span>
        <span class="dt_line">${LABELS.lineSample ?? 'Sample body text'}</span>
        <span class="dt_skel"></span>
        <span class="dt_grade">${theme.gradeDay}</span>
      </span>
      <span class="dt_night">
        <span class="dt_aa dt_aa-night">Aa</span>
        <span class="dt_nightgrade">夜间 ${theme.gradeNight}</span>
      </span>
    </span>
    <span class="dt_meta">
      <span class="dt_name">${theme.nameZh}</span>
      <span class="dt_tag">${theme.descZh}</span>
      <span class="dt_chips">${chip(bg)}${chip(surface)}${chip(accent)}</span>
    </span>
  </button>`
}

const MIGRATED = ['festival-dragonboat', 'nord', 'zcode']
/** One card per theme, with a migrated one — the ones whose stylesheets had to
 * be rewritten — wearing the applied ring. */
const GRID = THEMES.map((theme) => card(theme, theme.id === 'nord')).join('')

/** Every theme's sheet, injected verbatim: all scoped on an attribute, so only
 * the active one can match. */
const THEME_CSS = THEMES.map((theme) => `/* ${theme.id} */\n${theme.css}`).join('\n')

const shellOptions = THEMES.map(
  (theme) =>
    `<option value="${theme.id}"${theme.id === 'nord' ? ' selected' : ''}>${theme.id}${MIGRATED.includes(theme.id) ? '  ← migrated' : ''}</option>`,
).join('')

/** The panel's markup, with the first row's sliders unfolded so a slider is on
 * screen. The values are placeholders: the script fills every swatch and every
 * readout from the live probe. */
const panelGroups = REGISTRY.map((group, groupIndex) => {
  const rows = group.items
    .map(
      (item, itemIndex) => `
      <div class="tp_row">
        <button type="button" class="tp_rowHead">
          <span class="tp_swatch" data-swatch="${item.token}"></span>
          <span class="tp_label">${LABELS[item.labelKey] ?? item.labelKey}</span>
          <span class="tp_hex" data-hex="${item.token}"></span>
        </button>
        ${
          groupIndex === 0 && itemIndex === 0
            ? `<div class="tp_sliders">
            <label class="tp_slider"><span class="tp_sliderLabel">色相</span>
              <input type="range" min="0" max="360" step="1" value="0" data-slider="${item.token}:h">
              <span class="tp_sliderValue" data-value="${item.token}:h">0</span></label>
            <label class="tp_slider"><span class="tp_sliderLabel">饱和</span>
              <input type="range" min="0" max="100" step="1" value="0" data-slider="${item.token}:s">
              <span class="tp_sliderValue" data-value="${item.token}:s">0</span></label>
            <label class="tp_slider"><span class="tp_sliderLabel">明度</span>
              <input type="range" min="0" max="100" step="1" value="0" data-slider="${item.token}:l">
              <span class="tp_sliderValue" data-value="${item.token}:l">0</span></label>
          </div>`
            : ''
        }
      </div>`,
    )
    .join('')
  return `<details class="tp_group" open><summary class="tp_groupHead">${LABELS[group.labelKey] ?? group.labelKey}</summary>${rows}</details>`
}).join('')

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>smkit 主题中心 · 合并后冒烟预览</title>
<style>${TOKEN_STUBS}${PAGE_CSS}</style>
<style id="dsh-theme-active-style"></style>
<style>${ROW_CSS}</style>
<style>${PALETTE_CSS}</style>
<style>${THEME_CSS}</style>
</head>
<body>
<div class="wrap">

  <div class="panel">
    <h2>一 · 主题中心的一行（真实 row.css + 组件同构 DOM）</h2>
    <div class="dsh-theme-set">
      <div class="dsh-theme-set-head">
        <div class="dsh-theme-set-title">主题中心<span class="dsh-theme-set-count">${THEMES.length} 款</span></div>
        <div class="dsh-theme-set-modes">
          <button type="button" data-on="true">自动</button>
          <button type="button" data-on="false">浅色</button>
          <button type="button" data-on="false">深色</button>
        </div>
      </div>
      <div class="dsh-theme-set-grid">${GRID}</div>
      <div class="dsh-theme-set-foot">
        <span class="dsh-theme-set-hint">选择即保存</span>
        <button type="button" class="dsh-theme-set-reset">恢复默认</button>
      </div>
    </div>
    <p class="note">第 14 张（Nord）带选中环 —— 选中状态沿用主题中心原有的样式。每张卡片上半是昼间预览、右上角是实测对比度徽章，下半夜间条，再往下是名称、描述与三色板。</p>
  </div>

  <div class="panel">
    <h2>二 · 三款迁移皮肤的作用域验证（真实换肤路径）</h2>
    <div class="bar">
      <select id="pick">${shellOptions}</select>
      <button type="button" id="mode">切换夜间</button>
      <button type="button" id="clear">移除主题</button>
    </div>
    <div class="shell">
      <aside class="shell-rail">
        <div class="shell-brand">smkit</div>
        <div class="shell-item" data-on="true">会话</div>
        <div class="shell-item">技能</div>
        <div class="shell-item">设置</div>
      </aside>
      <main class="shell-canvas">
        <div class="shell-title">作用域验证</div>
        <div class="shell-bubble">用户消息…</div>
        <button type="button" class="shell-cta">主按钮</button>
      </main>
    </div>
    <div class="report" id="report"></div>
  </div>

  <div class="panel">
    <h2>三 · 调色板读取验证（真实 palette.css + 真实探测读取路径）</h2>
    <p class="note" style="padding:0 0 10px">下表每一行都由 <b>color: var(--token, fallback)</b> 的探测元素读回计算值：左列是元素当前实际颜色，右列是面板滑块会显示的 HSL。切换上方主题或用「切换夜间」，两列都会跟着变 —— 说明滑块起点来自元素本身，而不是一份写死的表。</p>
    <!-- The real rule is position:fixed (the panel floats over the shell);
         inline here it has to sit in flow, so this one declaration is
         neutralized on the element and every other rule of palette.css still
         does its job. Inline beats the class no matter the sheet order. -->
    <div class="tp_panel" style="position:static;top:auto;right:auto;bottom:auto;max-height:none">
      <div class="tp_head">
        <span class="tp_title">调色板</span>
        <button type="button" class="tp_close">×</button>
      </div>
      <div class="tp_groups">${panelGroups}</div>
      <div class="tp_foot">
        <button type="button" class="tp_save">保存</button>
        <button type="button" class="tp_reset">重置</button>
      </div>
    </div>
    <table class="readout"><thead><tr><th class="sw"></th><th>token</th><th>元素实际计算值</th><th>滑块 HSL</th></tr></thead><tbody id="readout"></tbody></table>
  </div>

</div>
<script>
  var THEMES = ${JSON.stringify(THEMES.map(({ id, css }) => ({ id, css })))};
  var REGISTRY = ${JSON.stringify(REGISTRY)};
  var styleEl = document.getElementById('dsh-theme-active-style');

  // The applier, reduced to what a preview needs: the attribute on the body and
  // the sheet in the one style element, exactly the pair apply.ts moves.
  function applyTheme(id) {
    if (id) {
      document.body.setAttribute('data-dsh-theme', id);
      var found = THEMES.filter(function (theme) { return theme.id === id; })[0];
      styleEl.textContent = found ? found.css : '';
    } else {
      document.body.removeAttribute('data-dsh-theme');
      styleEl.textContent = '';
    }
    refresh();
  }

  /* --- the read path, mirroring palette.ts's probe ------------------------ */

  var probe = null;
  function readTokenColor(token, fallback) {
    if (!probe) {
      probe = document.createElement('div');
      probe.style.display = 'none';
      document.body.appendChild(probe);
    }
    probe.style.color = 'var(' + token + ', ' + fallback + ')';
    var resolved = getComputedStyle(probe).color;
    probe.style.color = '';
    return resolved;
  }

  function rgbToHsl(value) {
    var m = /^rgba?\\(([^)]+)\\)$/i.exec(value.trim());
    if (!m) return null;
    var parts = m[1].split(/[\\s,\\/]+/).filter(function (p) { return p !== ''; });
    var rgb = parts.slice(0, 3).map(function (p) {
      return p.indexOf('%') >= 0 ? (parseFloat(p) / 100) * 255 : parseFloat(p);
    });
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var span = max - min;
      s = l > 0.5 ? span / (2 - max - min) : span / (max + min);
      if (max === r) h = ((g - b) / span + (g < b ? 6 : 0)) * 60;
      else if (max === g) h = ((b - r) / span + 2) * 60;
      else h = ((r - g) / span + 4) * 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function refresh() {
    var tbody = document.getElementById('readout');
    var html = '';
    REGISTRY.forEach(function (group) {
      group.items.forEach(function (item) {
        var raw = readTokenColor(item.token, item.fallback);
        var hsl = rgbToHsl(raw);
        var text = hsl ? (hsl.h + '° / ' + hsl.s + '% / ' + hsl.l + '%') : '无法解析 → 用 fallback';
        html += '<tr><td class="sw"><i style="background:' + raw + '"></i></td><td>' + item.token + '</td><td>' + raw + '</td><td>' + text + '</td></tr>';
        var swatch = document.querySelector('[data-swatch="' + item.token + '"]');
        var hex = document.querySelector('[data-hex="' + item.token + '"]');
        if (swatch) swatch.style.background = raw;
        if (hex) hex.textContent = hsl ? ('hsl ' + hsl.h + ' ' + hsl.s + '% ' + hsl.l + '%') : '—';
        if (hsl) {
          ['h', 's', 'l'].forEach(function (channel) {
            var slider = document.querySelector('[data-slider="' + item.token + ':' + channel + '"]');
            var value = document.querySelector('[data-value="' + item.token + ':' + channel + '"]');
            if (slider) slider.value = hsl[channel];
            if (value) value.textContent = hsl[channel];
          });
        }
      });
    });
    tbody.innerHTML = html;

    var cs = function (selector, property) {
      var el = document.querySelector(selector);
      return el ? getComputedStyle(el)[property] : '(missing)';
    };
    var body = getComputedStyle(document.body);
    document.getElementById('report').textContent = [
      'data-dsh-theme     = ' + (document.body.getAttribute('data-dsh-theme') || '(none)'),
      'data-ds-dark-theme = ' + document.body.hasAttribute('data-ds-dark-theme'),
      'body  background   = ' + body.backgroundColor,
      'body  color        = ' + body.color,
      'rail  background   = ' + cs('.shell-rail', 'backgroundColor') + '   (--dsw-specific-sidebar-fill)',
      'cta   background   = ' + cs('.shell-cta', 'backgroundColor') + '   (button-primary-fill)',
    ].join('\\n');
  }

  document.getElementById('pick').onchange = function (event) { applyTheme(event.target.value); };
  document.getElementById('clear').onclick = function () { applyTheme(null); };
  document.getElementById('mode').onclick = function (event) {
    if (document.body.hasAttribute('data-ds-dark-theme')) document.body.removeAttribute('data-ds-dark-theme');
    else document.body.setAttribute('data-ds-dark-theme', '');
    event.target.setAttribute('data-on', String(document.body.hasAttribute('data-ds-dark-theme')));
    refresh();
  };
  applyTheme(document.getElementById('pick').value);
</script>
</body>
</html>
`

writeFileSync(OUT, html)
console.log(`written ${OUT}`)
console.log(
  `${THEMES.length} cards · migrated: ${MIGRATED.join(', ')} · readout: ${REGISTRY.reduce((n, g) => n + g.items.length, 0)} tokens in ${REGISTRY.length} groups`,
)
