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

declare namespace JSX {
  /**
   * The element type produced by the injected `createElement`, kept opaque:
   * components build a tree and hand it straight back to React, never
   * inspecting it. `Element` is an alias of `import('./types').Element` so the
   * JSX and non-JSX call paths agree on one type.
   */
  type Element = import('./types').Element

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
    children?: unknown
    onClick?: (event: EventLike) => void
    onChange?: (event: EventLike) => void
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

  interface SvgProps extends CommonProps {
    width?: string | number
    height?: string | number
    viewBox?: string
    fill?: string
  }

  interface SvgShapeProps extends CommonProps {
    d?: string
    cx?: string | number
    cy?: string | number
    r?: string | number
    stroke?: string
    strokeWidth?: string | number
    strokeLinecap?: 'round' | 'butt' | 'square'
    strokeLinejoin?: 'round' | 'miter' | 'bevel'
  }

  /**
   * Only the tags this section actually renders are declared. Adding a new one
   * is a deliberate edit, and the stylesheet has to gain `.mm_*` rules for it.
   */
  interface IntrinsicElements {
    div: CommonProps
    span: CommonProps
    label: CommonProps
    h3: CommonProps
    input: InputProps
    select: SelectProps
    option: OptionProps
    button: ButtonProps
    svg: SvgProps
    circle: SvgShapeProps
    path: SvgShapeProps
  }
}
