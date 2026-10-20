/**
 * English dictionary for the `outline` locale namespace.
 *
 * Same keys as the Chinese dictionary: one label per kind and one per panel
 * state.
 */

import type { LocaleDict } from '../../../platform/types'

export const OUTLINE_LOCALE_EN: LocaleDict = {
  toggle: 'Outline',
  loading: 'Reading…',
  empty: 'No symbols found',
  failed: 'Outline unavailable: {message}',
  retry: 'Retry',

  kindFunction: 'func',
  kindStruct: 'struct',
  kindUnion: 'union',
  kindEnum: 'enum',
  kindMacro: 'macro',
}
