import { DEFAULT_FILTERS, type FilterPrefs } from '../core/types.ts';

/**
 * Presets tuned on grey scanned manga (owner's Kindaichi volumes, 2026-10-13).
 * - dim: paper becomes a warm mid grey, ink stays black: easy on the eyes, no halo, faces stay faces.
 * - invert-soft: inverted with the contrast pulled in and the blacks lifted (background ~30% grey, not
 *   black), hue turned back so colour covers stay recognisable. A global filter cannot tell a face
 *   from paper (both are white in the scan), so faces still come out dark: use Dim when that matters.
 */
const PRESETS: Record<FilterPrefs['preset'], string> = {
  none: '',
  dim: 'brightness(0.64) sepia(0.2) contrast(1.06)',
  'invert-soft': 'invert(1) hue-rotate(180deg) contrast(0.55) brightness(1.35) sepia(0.18)',
  sepia: 'sepia(0.6) contrast(0.95)',
  eink: 'grayscale(1) contrast(1.3)',
};

/** CSS `filter` value for the reader layer; '' when nothing is to be applied. */
export function filterCss(f: FilterPrefs | undefined): string {
  if (!f) return '';
  const parts: string[] = [];
  // 'night' was the old single dark preset; it maps to the soft invert
  const key = (f.preset as string) === 'night' ? 'invert-soft' : f.preset;
  if (PRESETS[key]) parts.push(PRESETS[key]);
  if (Math.abs(f.brightness - 1) > 0.005) parts.push(`brightness(${f.brightness.toFixed(2)})`);
  if (Math.abs(f.contrast - 1) > 0.005) parts.push(`contrast(${f.contrast.toFixed(2)})`);
  return parts.join(' ');
}

export function isDefaultFilters(f: FilterPrefs): boolean {
  return filterCss(f) === '' && f.preset === DEFAULT_FILTERS.preset;
}
