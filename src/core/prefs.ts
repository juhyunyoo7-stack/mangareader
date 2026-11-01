import { DEFAULT_PREFS, type GlobalPrefs, type ReaderPrefs } from './types.ts';

/** Effective prefs = book ?? series ?? global ?? defaults, field by field (DESIGN 5.3). */
export function effectivePrefs(
  global: Partial<GlobalPrefs> | undefined,
  series: ReaderPrefs | undefined,
  book: ReaderPrefs | undefined,
): GlobalPrefs {
  const out: GlobalPrefs = { ...DEFAULT_PREFS };
  for (const layer of [global, series, book]) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export type PrefScope = 'book' | 'series';

/** Apply a patch at the chosen scope; series scope also clears the same keys from the book. */
export function applyPrefPatch(
  scope: PrefScope,
  patch: ReaderPrefs,
  current: { series: ReaderPrefs; book: ReaderPrefs },
): { series: ReaderPrefs; book: ReaderPrefs } {
  if (scope === 'book') return { series: current.series, book: { ...current.book, ...patch } };
  const book = { ...current.book };
  for (const k of Object.keys(patch)) delete (book as Record<string, unknown>)[k];
  return { series: { ...current.series, ...patch }, book };
}
