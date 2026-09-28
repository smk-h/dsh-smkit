/**
 * One Dark Pro as an alias-layer token table, stacked over the shell's active
 * theme by the theme center (`ctx.theme.overrideTokens`) while the shell's
 * preference is pinned to the half it is drawn for (`colorScheme: 'dark'` —
 * see `../apply.ts` for why the two live apart).
 *
 * Every value is the palette's own, taken from the theme's source — the VSCode
 * extension it is a port of (`themes/OneDark-Pro.json` in Binaryify/OneDark-Pro)
 * — and the comment on each block names the key it came from, so the mapping can
 * be checked against that file rather than against anyone's reading of it. Where
 * the palette has no counterpart for a token (the masks, the diff washes, the
 * shell's per-half surfaces) the value is composed from the palette's own colors
 * and says so.
 *
 * The palette's vocabulary, as that file spells it: canvas `#282c34` (the
 * editor), panel `#21252b` (the sidebar, the status bar, the inactive tab), the
 * highlighted row `#2c313c` (current line, widget, request), the focused row
 * `#323842` (list focus, tab hover), the well `#1b1d23` (peek view), the wells
 * `#1d1f23` (every input) and `#2e3440` (quote blocks), the rules `#181a1f` →
 * `#3e4452` → `#4b5362` → `#525761`, ink `#abb2bf`, the muted `#7f848e` and
 * `#6b717d`, the status ink `#9da5b4`, the badge blue `#4d78cc`, the cursor blue
 * `#528bff`, the link blue `#61afef`, and the syntax ramp (`#e06c75`, `#98c379`,
 * `#e5c07b`, `#d19a66`, `#56b6c2`, `#c678dd`).
 *
 * Three of those are the ones worth naming, because guessing them is how a
 * "One Dark Pro" ends up looking like something else. The *badge* blue
 * (`#4d78cc`, what the palette puts on activity-bar badges, avatars and remote
 * indicators) is the accent; the *cursor* blue (`#528bff`) only ever marks the
 * caret, and the *link* blue (`#61afef`) is what links and function names take.
 * And the palette's primary button is grey (`#404754`), not blue — VSCode's One
 * Dark Pro has no blue button, and painting one here would be this plugin's
 * idea of the theme rather than the theme.
 *
 * The three layer numbers are roles rather than a ladder — the core-surfaces
 * block spells out which role each holds. The palette supplies all three tones:
 * `#2c313c` (the highlighted row) for the control surface, `#21252b` (the
 * sidebar and the hover widget) for the panel, and `#323842` (the focused row)
 * for the sheet above it. The editor `#282c34` sits between the control tone and
 * the panel, which is what One Dark Pro looks like — the editor is not the
 * darkest thing in it, and nothing here moves it to make a hierarchy look
 * tidier.
 *
 * Two kinds of token live in this table, and they are filled differently on
 * purpose:
 *
 * - *static* surfaces, inks and rules take the palette's own values outright — a
 *   panel is `#21252b` because that is what the palette paints a panel with;
 * - *additive* tokens — everything the shell lays over a surface it did not
 *   choose, which is every hover, pressed, selected and ghost state — carry a
 *   veil instead of a colour. The palette can afford opaque values there
 *   because it knows what it paints its lists on (the sidebar, the editor) and
 *   tunes the row tone to that one surface. The shell does not say what is under
 *   a hovered row: the same token has to read on the canvas, on a panel and on a
 *   raised board at once. A white veil does that by construction, lifting
 *   whatever is beneath it by the same fraction. An opaque value picked for one
 *   of those surfaces reads as nothing on another — which is exactly the bug
 *   that put this paragraph here.
 *
 * The one exception is a fill that has to *hide* what is under it: a floating
 * button stays opaque, and takes the palette's two darkest surface tones, which
 * sit below the canvas and therefore read against every surface the shell has.
 */

/** Every token One Dark Pro repaints. */
export const ONE_DARK_PRO_TOKENS: Readonly<Record<string, string>> = {
  // Core surfaces. The three layer numbers are *roles*, not a ladder: the shell
  // paints an input or a secondary control with layer-1 (`Input`, `HoverCard`,
  // `SegmentedControl`, the sidebars), a panel or a floating card with layer-2
  // (the settings dialog, `Modal`, `Pill`, `Tag`), and the sheet that comes out
  // over both with layer-3 (pickers, dialogs, the center's own cards). That is
  // why layer-1 sits *above* layer-2 here — a control inside a panel is lighter
  // than the panel, the arrangement One Dark Pro itself has between its widgets
  // and its sidebar — and why this ramp is not monotonic. Reading the numbers as
  // "higher means lighter" lifts the settings dialog a step *above* the canvas
  // instead of leaving it below, which is exactly what it looked like before
  // this was sorted out.
  '--dsw-alias-bg-base': '#282c34', // editor.background
  '--dsw-alias-bg-layer-1': '#2c313c', // editor.lineHighlightBackground — controls and inputs
  '--dsw-alias-bg-layer-2': '#21252b', // sideBar.background — panels and dialogs
  '--dsw-alias-bg-layer-3': '#323842', // list.focusBackground — sheets above both
  '--dsw-alias-bg-overlay': '#21252b', // editorWidget.background
  '--dsw-alias-bg-module-platform': '#21252b', // editorWidget.background
  '--dsw-alias-bg-multi-select': '#ffffff14', // 8% white
  '--dsw-alias-bg-skeleton': '#ffffff1d', // editorWhitespace.foreground

  // Borders. The four rungs are roles here rather than a climb, and l3 is the
  // one that steps *below* the others on purpose: the shell spends l3 on the
  // frame's column rules (`sidebarCol`'s right edge, `centerCol`'s and
  // `rightbarCol`'s left edge) plus the thin frames of the cards inside the
  // right column, and a column rule has to *disappear* into the surface —
  // especially on the right, where the shell paints the column with `bg-base`
  // and the rule is the only thing marking the seam. So it takes the palette's
  // `editorGroup.border` / `tab.border`, the rung One Dark Pro itself uses
  // between editor groups. l1 and l2 stay on the visible tones, because they
  // draw edges that are meant to be read: the center's cards and the shell's
  // panels.
  '--dsw-alias-border-l1': '#3e4452', // focusBorder, panel.border, terminal.border
  '--dsw-alias-border-l2': '#4b5362', // textBlockQuote.border
  '--dsw-alias-border-l3': '#181a1f', // tab.border, editorGroup.border — the frame's column rules
  '--dsw-alias-border-l4': '#181a1f', // tab.border, editorGroup.border — the right column's panel edge
  '--dsw-alias-border-l2-darkmode-thin': '#ffffff1d', // editorWhitespace.foreground
  // No counterpart (the palette has no inverted rule); its darkest ink plays
  // that role away from a light surface, and the menu separator is the one
  // mid-tone the palette does use for a rule inside a surface.
  '--dsw-alias-border-inverted': '#181a1f', // tab.border
  '--dsw-alias-border-inverted2': '#343a45', // menu.separatorBackground

  // Brand: the badge blue and the ink the palette puts on it. `#61afef` is the
  // link blue and is used for links — a different role, a different value.
  '--dsw-alias-brand-primary': '#4d78cc', // activityBarBadge.background
  '--dsw-alias-brand-primary-invert': '#f8fafd', // activityBarBadge.foreground
  '--dsw-alias-brand-text': '#f8fafd', // activityBarBadge.foreground
  '--dsw-alias-link': '#61afef', // textLink.foreground

  // Buttons: grey primary, as the palette has them.
  '--dsw-alias-button-primary-fill': '#404754', // button.background
  '--dsw-alias-button-primary-hover': '#525761', // actionBar.toggledBackground
  '--dsw-alias-button-primary-dimmed': '#3e4452', // panel.border
  '--dsw-alias-button-info-fill': '#4d78cc', // activityBarBadge.background
  '--dsw-alias-button-info-hover': '#528bff', // editorCursor.foreground
  '--dsw-alias-button-contrast-fill': '#d7dae0', // activityBar.foreground
  '--dsw-alias-button-elevated-fill': '#404754', // button.background
  '--dsw-alias-button-floating-fill': '#21252b', // sideBar.background
  '--dsw-alias-button-floating-hover': '#2c313c', // editor.lineHighlightBackground
  '--dsw-alias-button-ghost-active-fill': '#ffffff14', // 8% white
  '--dsw-alias-button-ghost-active-hover': '#ffffff1f', // 12% white
  '--dsw-alias-button-ghost-active-border': '#525761', // actionBar.toggledBackground
  '--dsw-alias-button-tool-bar-fill': '#abb2bf80', // editor.foreground, veiled
  '--dsw-alias-button-tool-bar-fill-invisible': '#abb2bf5c',
  '--dsw-alias-button-tool-bar-hover': '#abb2bf99',

  // Typography
  '--dsw-alias-label-primary': '#abb2bf', // editor.foreground
  '--dsw-alias-label-secondary': '#9da5b4', // statusBar.foreground, titleBar.activeForeground
  '--dsw-alias-label-tertiary': '#7f848e', // editor.wordHighlightBorder
  '--dsw-alias-label-caption': '#636b78', // gitDecoration.ignoredResourceForeground
  '--dsw-alias-label-dimmed': '#6b717d', // titleBar.inactiveForeground
  '--dsw-alias-label-primary-bluish': '#d7dae0', // activityBar.foreground
  '--dsw-alias-label-primary-dimmed': '#7f848e', // editor.wordHighlightBorder
  // The shell means "ink on a filled surface" by this one, which the palette
  // answers with the canvas it paints everything else against.
  '--dsw-alias-label-primary-foreground': '#282c34', // editor.background
  '--dsw-alias-label-primary-inverted': '#282c34', // editor.background

  // Interactive washes: the list's own row colors, not a white veil — this
  // palette expresses selection by tinting the row, which is why they are
  // opaque and one step off the surface rather than translucent.
  //
  // Transparent on purpose — see the additive rule in the module doc. These are
  // the tokens the shell lays over a surface of its own choosing, so they carry
  // a veil rather than a colour. The two solid rungs keep the palette's opaque
  // tones for the places that must not composite (a pressed state over a
  // scrolled edge, say), and they are picked from the palette's *rules* rather
  // than its list rows, which are tuned to the sidebar specifically.
  '--dsw-alias-interactive-bg-hover': '#ffffff14', // 8% white
  '--dsw-alias-interactive-bg-active': '#ffffff1f', // 12% white
  '--dsw-alias-interactive-bg-hover-solid': '#3e4452', // focusBorder, opaque
  '--dsw-alias-interactive-bg-hover-accent': '#4d78cc33', // activityBarBadge.background, veiled
  '--dsw-alias-interactive-bg-hover-danger': '#e06c7526', // syntax red, veiled

  // Markdown / code
  '--dsw-alias-markdown-code-block': '#21252b', // sideBar.background
  '--dsw-alias-markdown-code-block-banner': '#1b1d23', // peekViewEditor.background
  '--dsw-alias-markdown-inline-code': '#323842', // list.focusBackground
  '--dsw-alias-markdown-code-segment-selected': '#67769660', // editor.selectionBackground
  '--dsw-alias-markdown-code-segment-unselected': '#282c34', // editor.background
  '--dsw-alias-markdown-citation': '#2e3440', // textBlockQuote.background
  '--dsw-alias-markdown-placeholder': '#282c34', // editor.background
  '--dsw-alias-markdown-tag': '#2c313a', // list.hoverBackground

  // States: the syntax ramp for the primaries, the palette's gutter colors for
  // the tertiary levels they tint.
  '--dsw-alias-state-business-primary': '#4d78cc', // activityBarBadge.background
  '--dsw-alias-state-business-tertiary': 'color-mix(in srgb, #4d78cc 22%, #21252b)',
  '--dsw-alias-state-error-primary': '#e06c75', // syntax red
  '--dsw-alias-state-error-secondary': '#e05561', // terminal.ansiRed
  '--dsw-alias-state-error-tertiary': 'color-mix(in srgb, #9a353d 22%, #21252b)', // editorGutter.deletedBackground
  '--dsw-alias-state-success-primary': '#98c379', // syntax green
  '--dsw-alias-state-success-secondary': '#8cc265', // terminal.ansiGreen
  '--dsw-alias-state-success-tertiary': 'color-mix(in srgb, #109868 22%, #21252b)', // editorGutter.addedBackground
  '--dsw-alias-state-warn-primary': '#d19a66', // syntax orange
  '--dsw-alias-state-warn-secondary': '#d18f52', // terminal.ansiYellow
  '--dsw-alias-state-warn-tertiary': 'color-mix(in srgb, #948b60 22%, #21252b)', // editorGutter.modifiedBackground
  '--dsw-alias-state-warn-label': '#d19a66', // syntax orange

  // Scrollbars: the slider's own alphas, hover and idle.
  '--dsw-alias-scrollbar-bg-l1': '#4e566660', // scrollbarSlider.background
  '--dsw-alias-scrollbar-bg-l2': '#4e566660',
  '--dsw-alias-scrollbar-hover-l1': '#5a637580', // scrollbarSlider.hoverBackground
  '--dsw-alias-scrollbar-hover-l2': '#5a637580',

  // Toast / tooltip: the hover widget, which the palette paints as a panel.
  '--dsw-alias-toast-bg': '#21252b', // editorWidget.background
  '--dsw-alias-toast-label': '#f8fafd', // activityBarBadge.foreground
  '--dsw-alias-tooltip-bg': '#21252b', // editorHoverWidget.background
  '--dsw-alias-tooltip-key-bg': 'color-mix(in srgb, var(--dsw-alias-tooltip-bg), white 18%)',
  '--dsw-alias-menu-icon': '#7f848e', // editor.wordHighlightBorder

  // The masks. No counterpart in the palette — these are veils the shell lays
  // over whatever is already painted, so they stay translucent black.
  '--dsw-alias-bg-mask-1': '#00000080',
  '--dsw-alias-bg-mask-2': '#00000033',
  '--dsw-alias-bg-mask-3': '#0000007a',
  '--dsw-alias-bg-mask-photo': '#000000e0',
  '--dsw-alias-bg-mask-drop': '#21252bb3',

  // Secondary surfaces. The shell gives these a *different* value per palette
  // half (light: menu deck white, document preview pale, drop mask white; dark:
  // the same slots deep). The theme's own vocabulary answers for them — the
  // menu deck is the palette's dropdown, the document preview is its canvas —
  // rather than the shell's neutral grey.
  '--dsw-menu-surface-fill': '#21252b', // dropdown.background
  '--dsw-alias-bg-document-preview': '#282c34', // editor.background
  '--dsw-alias-label-document-preview': '#abb2bf', // editor.foreground
  '--dsw-alias-state-idle-primary': '#636b78', // gitDecoration.ignoredResourceForeground
  // The diff family has no counterpart either; it is the palette's gutter trio,
  // veiled over the panel for the rows and laid on thin for the line washes.
  '--dsw-alias-code-diff-added': 'color-mix(in srgb, #109868 16%, transparent)', // editorGutter.addedBackground
  '--dsw-alias-code-diff-deleted': 'color-mix(in srgb, #9a353d 16%, transparent)', // editorGutter.deletedBackground
  '--dsw-alias-file-diff-added-bg': 'color-mix(in srgb, #109868 14%, #21252b)',
  '--dsw-alias-file-diff-added-gutter': 'color-mix(in srgb, #109868 24%, #21252b)',
  '--dsw-alias-file-diff-added-marker': '#109868', // editorGutter.addedBackground
  '--dsw-alias-file-diff-deleted-bg': 'color-mix(in srgb, #9a353d 14%, #21252b)',
  '--dsw-alias-file-diff-deleted-gutter': 'color-mix(in srgb, #9a353d 24%, #21252b)',
  '--dsw-alias-file-diff-deleted-marker': '#9a353d', // editorGutter.deletedBackground

  // Specific surfaces
  '--dsw-specific-bubble': '#2c313c', // chat.requestBackground
  '--dsw-specific-bubble-highlight': '#6776961d', // chat.requestBubbleBackground
  // The composer is the one input this table does not give the palette's input
  // tone. `input.background` is `#1d1f23`, a step *below* the panel, which suits
  // a form field inside a dialog; the composer is a large surface sitting on the
  // canvas, where that reads as a hole and the panel tone reads as a field. It
  // takes `#21252b` — the same value the palette gives its sidebar and widgets,
  // and the same one the shell paints its own panels with.
  '--dsw-specific-input-major': '#21252b', // sideBar.background
  '--dsw-specific-login-input': '#1d1f23', // input.background
  '--dsw-specific-menu': '#21252b', // dropdown.background
  '--dsw-specific-selector': '#21252b', // dropdown.background
  '--dsw-specific-sidebar-fill': '#21252b', // sideBar.background
  '--dsw-specific-sidebar-nav-item-active': '#ffffff1f', // 12% white
  '--dsw-specific-sidebar-nav-item-active-accent': '#ffffff24', // 14% white
  '--dsw-specific-sidebar-nav-item-hover': '#ffffff14', // 8% white
  '--dsw-specific-tip': '#21252b', // editorHoverWidget.background

  // The think-gradient pair the shell consumes as backgrounds: the canvas and
  // the peek-view well, faded out.
  '--dsw-linear-gradient-think':
    'linear-gradient(180deg, rgb(40, 44, 52) 20.19%, rgba(40, 44, 52, 0) 100%)', // editor.background
  '--dsw-linear-think-select':
    'linear-gradient(180deg, rgb(27, 29, 35) 20.19%, rgba(27, 29, 35, 0) 100%)', // peekViewEditor.background

  // Syntax highlighting. Not a shell token: the markdown renderer reads these
  // directly, which is why they ride the same table. The palette's ramp, from
  // the same source file.
  '--shiki-token-constant': '#d19a66',
  '--shiki-token-string': '#98c379',
  '--shiki-token-comment': '#7f848e',
  '--shiki-token-keyword': '#c678dd',
  '--shiki-token-parameter': '#e06c75',
  '--shiki-token-function': '#61afef',
  '--shiki-token-string-expression': '#98c379',
  '--shiki-token-punctuation': '#abb2bf',
  '--shiki-token-link': '#61afef',
}
