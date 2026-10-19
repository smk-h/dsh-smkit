/**
 * The wire contract of the explorer's creating rows.
 *
 * Two routes, one shape: `POST /smkit/api/explorer/create-folder` and
 * `POST /smkit/api/explorer/create-file`, both taking the directory a row was
 * right-clicked on plus the one-segment name typed into the inline editor.
 *
 * Type-only by design: the browser bundle is a single CommonJS script with no
 * module resolver, and `import type` is erased before bundling, so nothing here
 * reaches any emitted code.
 */

/**
 * Stable refusal codes. The browser half shows the host's own message and uses
 * the code only to tell a name problem (which the editor stays open for) from a
 * filesystem failure (which it also stays open for, but says differently).
 */
export type ExplorerCreateRefusal =
  /** The name is not one storable path segment (shape, Windows rules, too long). */
  | 'explorer/invalid-name'
  /** Something already occupies `<directory>/<name>` — file, folder or link. */
  | 'explorer/exists'
  /** The target either does not exist or is not a directory. */
  | 'explorer/not-directory'
  /** The entry is gone (renamed or deleted by something else since the menu). */
  | 'explorer/missing'
  /** The request names something this plugin never touches (a filesystem root). */
  | 'explorer/refused'
  /** The filesystem refused the write (permissions, read-only mount, no space). */
  | 'explorer/unavailable'

/** Body of both creating routes. */
export interface ExplorerCreateRequest {
  /** Absolute path of the directory the row names. */
  path: string
  /** The new entry's base name — one segment, never a path. */
  name: string
}

/** Receipt of a landed creation: the new entry's absolute path. */
export interface ExplorerCreateReceipt {
  path: string
}

/** Body of `POST /explorer/rename`. */
export interface ExplorerRenameRequest {
  /** Absolute path of the entry being renamed. */
  path: string
  /** Its new base name — one segment, never a path. */
  name: string
}

/** Body of `POST /explorer/delete`. */
export interface ExplorerDeleteRequest {
  /** Absolute path of the entry being removed. */
  path: string
}

/** Receipt of a landed rename: the entry's new absolute path. */
export interface ExplorerRenameReceipt {
  path: string
}
