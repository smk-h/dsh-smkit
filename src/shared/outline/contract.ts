/**
 * The wire contract of the C-family outline.
 *
 * One route, one shape: `GET /smkit/api/outline?path=<absolute file>`. The host
 * reads the file, scans it, and answers with the symbols it found; the browser
 * half only renders them and asks for a jump.
 *
 * Type-only by design: the browser bundle is a single CommonJS script with no
 * module resolver, and `import type` is erased before bundling, so nothing here
 * reaches any emitted code.
 */

/** What a symbol is, as far as an outline reader cares. */
export type OutlineKind =
  /** A function definition, or (in a header) its prototype. */
  | 'function'
  /** `struct`, `class`, or a typedef of one. */
  | 'struct'
  /** `union`, or a typedef of one. */
  | 'union'
  /** `enum`, or a typedef of one. */
  | 'enum'
  /** A function-like `#define`. */
  | 'macro'

/** One entry of the outline, in file order. */
export interface OutlineSymbol {
  readonly kind: OutlineKind
  /** Declared name; for an anonymous `typedef struct { … } Foo`, this is `Foo`. */
  readonly name: string
  /** 1-based line of the declaration's first line (the return type's line). */
  readonly line: number
}

/** Stable refusal codes; the browser half shows the host's message verbatim. */
export type OutlineRefusal =
  /** The request did not name an absolute path. */
  | 'outline/not-absolute'
  /** The extension is not one this scanner reads. */
  | 'outline/unsupported'
  /** Nothing exists at that path. */
  | 'outline/missing'
  /** The path exists but is a directory, socket, or something else unreadable as text. */
  | 'outline/not-file'
  /** Larger than the scanner will read in one go. */
  | 'outline/too-large'
  /** The read itself failed (permissions, transient IO). */
  | 'outline/unreadable'

/** Successful answer: the symbols, in file order. */
export interface OutlineResponse {
  readonly symbols: OutlineSymbol[]
}

/** Refused answer: a code the browser half can branch on, plus the words to show. */
export interface OutlineFailure {
  readonly error: string
  readonly code: OutlineRefusal
}
