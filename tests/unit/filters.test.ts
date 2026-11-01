import { describe, expect, it } from 'vitest';
import { filterCss } from '../../src/engine/filters.ts';
import { DEFAULT_FILTERS } from '../../src/core/types.ts';
import { validateState, emptyState } from '../../src/core/syncMerge.ts';

describe('filterCss', () => {
  it('is empty for the defaults and for undefined', () => {
    expect(filterCss(DEFAULT_FILTERS)).toBe('');
    expect(filterCss(undefined)).toBe('');
  });
  it('maps presets', () => {
    expect(filterCss({ ...DEFAULT_FILTERS, preset: 'dim' })).toMatch(/^brightness\(0\.64\)/);
    expect(filterCss({ ...DEFAULT_FILTERS, preset: 'invert-soft' })).toContain('invert(1)');
    // the old single 'night' preset (stored in existing libraries) maps to the soft invert
    expect(filterCss({ ...DEFAULT_FILTERS, preset: 'night' as never })).toBe(
      filterCss({ ...DEFAULT_FILTERS, preset: 'invert-soft' }),
    );
    expect(filterCss({ ...DEFAULT_FILTERS, preset: 'sepia' })).toContain('sepia(');
    expect(filterCss({ ...DEFAULT_FILTERS, preset: 'eink' })).toContain('grayscale(1)');
  });
  it('stacks brightness and contrast on top of a preset', () => {
    const css = filterCss({ preset: 'eink', brightness: 1.2, contrast: 0.8 });
    expect(css).toBe('grayscale(1) contrast(1.3) brightness(1.20) contrast(0.80)');
  });
});

describe('state file keeps the new reader prefs and clamps them', () => {
  it('round-trips autoTrim / guided / filters and drops junk', () => {
    const key = 'a'.repeat(32);
    const doc = validateState({
      ...emptyState('dev', '2026-01-01T00:00:00.000Z'),
      format: 'mangareader-state',
      version: 1,
      bookPrefs: [
        {
          contentKey: key,
          overrides: [],
          updatedAt: 5,
          prefs: {
            autoTrim: true,
            guided: true,
            filters: { preset: 'night', brightness: 9, contrast: 'x' }, // legacy name
          },
        },
        {
          contentKey: 'b'.repeat(32),
          overrides: [],
          updatedAt: 5,
          prefs: { filters: { preset: 'x' } },
        },
      ],
    });
    expect(doc.bookPrefs[0]!.prefs).toEqual({
      autoTrim: true,
      guided: true,
      filters: { preset: 'invert-soft', brightness: 1.5, contrast: 1 },
    });
    expect(doc.bookPrefs[1]!.prefs).toEqual({});
  });
});
