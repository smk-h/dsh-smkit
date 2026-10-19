/**
 * English dictionary for the `explorer` locale namespace.
 *
 * Key set must stay identical to `zh.ts`.
 */

import type { LocaleDict } from '../../../platform/types'

export const EXPLORER_MENU_LOCALE_EN: LocaleDict = {
  "copyRelative": "Copy relative path",
  "copyAbsolute": "Copy absolute path",
  "copied": "Copied",
  "newFolder": "New folder",
  "newFile": "New file",
  "newFolderPlaceholder": "Folder name",
  "newFilePlaceholder": "File name",
  "folderNameInvalid": "That folder name is not valid",
  "fileNameInvalid": "That file name is not valid",
  "fileNameExists": "A file with that name already exists",
  "createFailed": "Could not create it",
  "rename": "Rename",
  "renameInvalid": "The name cannot be empty or contain path separators.",
  "renameFailed": "Could not rename it",
  "delete": "Delete",
  "deleteTitle": "Delete \"{name}\"?",
  "deleteDescFile": "This permanently deletes the file. This cannot be undone.",
  "deleteDescDir": "This permanently deletes the directory and everything inside it. This cannot be undone.",
  "deleteFailed": "Could not delete it",
}
