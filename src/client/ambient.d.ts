/*
 * Ambient declarations for the browser half.
 *
 * This project type-checks the browser half but does not emit it: `tsdown`
 * bundles and emits `lib/client.js` (see `tsdown.config.ts`). Two consequences:
 *
 * 1. Relative imports in `src/client/**` are written **without** a `.js`
 *    extension, which is what `moduleResolution: "bundler"` resolves.
 * 2. `require` is not declared by any `@types` package here (`types: []` keeps
 *    Node out of browser code), so it is declared once, below. It survives
 *    bundling because tsdown marks `react` as never-bundled, leaving the call
 *    for the factory's own `require` to resolve at runtime.
 * 3. Stylesheets are imported as *strings* rather than for their side effects
 *    (`platform/styles.ts`): the build's `cssTextPlugin` compiles each `.css` to
 *    `export default "<rules>"`, so the declaration below has to state that
 *    shape instead of the CSS-Modules class map the other convention implies.
 *
 * JSX uses the **classic** runtime (`jsxFactory: "h"`) with `h` bound to the
 * injected `createElement` through `ClientDeps`. There is no module-level
 * global `h`: every component factory destructures it from `deps`, which is why
 * TypeScript's "requires 'h' to be in scope" check is satisfied by a closure
 * binding. This file must stay a *script* (no imports/exports), otherwise the
 * `JSX` namespace would land in module scope and every intrinsic element would
 * degrade to `any`.
 */

/** Resolve one module: relative ids go to the bundle registry, bare ids to the
 * DSH client-runtime loader (`react`, injected service packages). */
declare function require(id: string): any

/** package.json identity, injected at build time by tsdown `define`
 * (see tsdown.config.ts); the settings section badges itself with them. */
declare const __PLUGIN_NAME__: string
declare const __PLUGIN_VERSION__: string

/** One stylesheet, as the text the build's `cssTextPlugin` compiles it to
 * (see tsdown.config.ts). The client half injects the rules itself, because a
 * single-script bundle can reference no stylesheet file. */
declare module '*.css' {
  const css: string
  export default css
}

declare namespace JSX {
  /**
   * The element type produced by the injected `createElement`, kept opaque:
   * components build a tree and hand it straight back to React, never
   * inspecting it. `Element` is an alias of `import('./runtime/types').Element`
   * so the JSX and non-JSX call paths agree on one type.
   */
  type Element = import('./runtime/types').Element

  /**
   * Structural stand-in for a React synthetic event. The browser half has no
   * `@types/react`, and every handler here only ever reads `target` or stops
   * propagation, so this narrow shape is enough to type-check honestly.
   */
  interface EventLike {
    target: { value: string; checked: boolean }
    stopPropagation(): void
    preventDefault(): void
  }

  /**
   * A pointer or focus event, as the tool list's hover card reads one:
   * everything it needs is the element the handler is bound to, whose viewport
   * rect decides where the fixed-position card opens. `currentTarget` is a live
   * property for the duration of the handler in React, which is exactly how
   * long it is read.
   */
  interface AnchorEventLike extends EventLike {
    currentTarget: HTMLElement
  }

  /**
   * A pointer event, plus where the pointer was: the tool list tells "moved
   * onto the card" from "left the chip" by direction, and the position at the
   * moment of the event is what answers it. Declared apart from
   * `AnchorEventLike` because the focus events shepherded through the same
   * handlers carry no coordinates.
   */
  interface PointerEventLike extends AnchorEventLike {
    clientX: number
    clientY: number
  }

  /**
   * A focus event, plus where focus went. The tool list reads `relatedTarget`
   * to tell focus moving inside a block (a click on the card) from focus
   * leaving it (a keyboard walking on), which are the same event otherwise.
   */
  interface FocusEventLike extends AnchorEventLike {
    relatedTarget: Node | null
  }

  /** `key` is accepted on every element, intrinsic or component. */
  interface IntrinsicAttributes {
    key?: string | number
  }

  /**
   * Attributes shared by all rendered tags. `data-*` and `aria-*` are matched
   * by template-literal index signatures rather than a blanket `[k: string]`,
   * so a misspelled attribute (`classname`, `onclick`) is still an error.
   */
  interface CommonProps {
    key?: string | number
    className?: string
    title?: string
    role?: string
    /** Inline geometry, as the tool list's hover card needs: it is placed from
     * measured viewport coordinates, which no stylesheet can know. */
    style?: Record<string, string>
    /** Set only by the tool chips, which answer a keyboard walk with the same
     * card a hover opens. */
    tabIndex?: number
    children?: unknown
    onClick?: (event: EventLike) => void
    onChange?: (event: EventLike) => void
    onMouseEnter?: (event: PointerEventLike) => void
    onMouseLeave?: (event: PointerEventLike) => void
    onMouseDown?: (event: PointerEventLike) => void
    onFocus?: (event: AnchorEventLike) => void
    onBlur?: (event: FocusEventLike) => void
    [attribute: `data-${string}`]: unknown
    [attribute: `aria-${string}`]: unknown
  }

  interface InputProps extends CommonProps {
    type?: 'text' | 'search' | 'checkbox' | 'button'
    value?: string
    checked?: boolean
    disabled?: boolean
    placeholder?: string
  }

  interface SelectProps extends CommonProps {
    value?: string
    disabled?: boolean
  }

  interface OptionProps extends CommonProps {
    value?: string
  }

  interface ButtonProps extends CommonProps {
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
  }

  interface AnchorProps extends CommonProps {
    href?: string
    target?: string
    rel?: string
  }

  interface ParagraphProps extends CommonProps {}

  interface SvgProps extends CommonProps {
    width?: string | number
    height?: string | number
    viewBox?: string
    fill?: string
  }

  /**
   * Only the tags this section's own JSX renders are declared; the elements
   * inside an icon reach the DOM as tag strings through `h()` (see
   * icons/Icon.tsx), so they need no entry here. Adding a tag is a deliberate
   * edit, and the stylesheet has to gain `.mm_*` rules for it.
   */
  interface IntrinsicElements {
    div: CommonProps
    span: CommonProps
    label: CommonProps
    nav: CommonProps
    h2: CommonProps
    h3: CommonProps
    p: ParagraphProps
    a: AnchorProps
    input: InputProps
    select: SelectProps
    option: OptionProps
    button: ButtonProps
    svg: SvgProps
  }
}
