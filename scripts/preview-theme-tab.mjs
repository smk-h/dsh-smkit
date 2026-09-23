/**
 * One-off visual smoke-test page: embeds the REAL shipped theme page.css
 * (read verbatim from src/) plus the platform mm_btn base rule, stubs the
 * --dsw-alias-* tokens with the light palette values, and reproduces the
 * exact DOM ThemeContent/ThemeCard render for the two shipped skins
 * (dragonboat applied, nord idle). Served from dsh-themes/design/ next to
 * the approved mockup; screenshot it through the browser to confirm the
 * card layout before shipping.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PAGE_CSS = readFileSync('E:/AI/dsh-smkit/src/client/features/theme/style/page.css', 'utf8')

const TOKEN_STUBS = `
  /* light-palette stubs for the --dsw-alias-* tokens page.css reads */
  :root {
    --dsw-alias-label-primary: #1f2a22;
    --dsw-alias-label-secondary: #5a6a5e;
    --dsw-alias-label-tertiary: #8b9a8f;
    --dsw-alias-border-l2: #e3e8e2;
    --dsw-alias-border-l4: #c8d2ca;
    --dsw-alias-bg-layer-1: #ffffff;
    --dsw-alias-brand-primary: #3a7d54;
    --dsw-alias-interactive-bg-hover: rgba(31, 42, 34, 0.06);
    --dsw-alias-label-primary-foreground: #ffffff;
  }
  body { margin: 0; font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #f4f6f4; }
  .stage { max-width: 820px; margin: 32px auto; padding: 20px 24px 28px; background: #fff; border: 1px solid #e3e8e2; border-radius: 16px; }
`

const MM_BTN_STUBS = `
  .mm_btn {
    position: relative;
    cursor: pointer;
    font-size: 12px;
    line-height: 18px;
    padding: 3px 10px;
    border-radius: 8px;
    border: 1px solid var(--dsw-alias-border-l2);
    background: transparent;
    color: var(--dsw-alias-label-primary);
  }
  .mm_btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
`

/** One card, fields verbatim from ThemeCard + theme/zh + skins.ts. */
function card({ skin, active, name, tagline, bubble, gradeDay, gradeNight, apply, applied }) {
  const vars = [
    `--th-day-bg: ${skin.day.bg}`,
    `--th-day-fg: ${skin.day.fg}`,
    `--th-day-accent: ${skin.day.accent}`,
    `--th-night-bg: ${skin.night.bg}`,
    `--th-night-fg: ${skin.night.fg}`,
  ].join('; ')
  return `
    <button type="button" class="th_card${active ? ' th_card--active' : ''}"
      style="${vars}" aria-pressed="${active}" title="${tagline}">
      <span class="th_preview">
        <span class="th_day">
          <span class="th_daytop">
            <span class="th_aa">Aa</span>
            <span class="th_bubble">${bubble}</span>
          </span>
          <span class="th_line">${tagline}</span>
          <span class="th_skel"></span>
          <span class="th_grade">${gradeDay}</span>
        </span>
        <span class="th_night">
          <span class="th_aa th_aa_night">Aa</span>
          <span class="th_nightgrade">夜间 ${gradeNight}</span>
        </span>
      </span>
      <span class="th_meta">
        <span class="th_namerow">
          <span class="th_name">${name}</span>
          <span class="${active ? 'th_pill' : 'th_apply'}">${active ? applied : apply}</span>
        </span>
        <span class="th_tagline">${tagline}</span>
        <span class="th_palette">
          <span class="th_chip"><span class="th_dot" style="background: ${skin.day.bg}"></span><span class="th_hex">${skin.day.bg}</span></span>
          <span class="th_chip"><span class="th_dot" style="background: ${skin.day.fg}"></span><span class="th_hex">${skin.day.fg}</span></span>
          <span class="th_chip"><span class="th_dot" style="background: ${skin.day.accent}"></span><span class="th_hex">${skin.day.accent}</span></span>
        </span>
      </span>
    </button>`
}

const dragonboat = card({
  skin: { day: { bg: '#f2f6ef', fg: '#1a2b21', accent: '#2e7d4f' }, night: { bg: '#0a120d', fg: '#e6f0e9' } },
  active: true,
  name: '端午 Dragon Boat',
  tagline: '艾草绿粽叶香，龙舟红漆竞渡忙',
  bubble: '用户消息…',
  gradeDay: 'AAA · 13.6:1',
  gradeNight: '16.3:1',
  apply: '应用',
  applied: '✓ 使用中',
})

const nord = card({
  skin: { day: { bg: '#eceff4', fg: '#2e3440', accent: '#5e81ac' }, night: { bg: '#2e3440', fg: '#e5e9f0' } },
  active: false,
  name: 'Nord',
  tagline: 'Snow Storm 雪原昼色，Frost 冰蓝点缀',
  bubble: '用户消息…',
  gradeDay: 'AA · 10.8:1',
  gradeNight: '10.3:1',
  apply: '应用',
  applied: '✓ 使用中',
})

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>smkit 主题标签页 · 真实 page.css 冒烟预览</title>
<style>${TOKEN_STUBS}${MM_BTN_STUBS}${PAGE_CSS}</style>
</head>
<body>
<div class="stage">
  <div class="th_panel">
    <p class="th_intro">为长时间阅读挑选的低刺激配色：底色低饱和，正文对比度达标（卡片上的徽章为实测值），昼夜间均不用纯黑纯白。点卡片即换肤，昼取浅色、夜取深色，跟随 DSH 自带的显示模式切换。</p>
    <div class="th_row">
      <span class="th_count">2 款护眼配色</span>
      <span class="th_spacer"></span>
      <button type="button" class="mm_btn">恢复默认</button>
    </div>
    <div class="th_grid">${dragonboat}${nord}</div>
  </div>
</div>
</body>
</html>
`

writeFileSync('E:/AI/dsh-themes/design/smkit-theme-tab.html', html)
console.log('written E:/AI/dsh-themes/design/smkit-theme-tab.html')
