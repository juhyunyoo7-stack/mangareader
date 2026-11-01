import { describe, expect, it } from 'vitest';
import {
  isWide,
  layoutSpreads,
  pageToSpread,
  resolveLayout,
  spreadToPage,
  visualOrder,
} from '../../src/core/spread.ts';
import type { LayoutMode, PageInfo, PageOverride } from '../../src/core/types.ts';

function pages(n: number, wide: number[] = []): PageInfo[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    entry: `p${i}.png`,
    w: wide.includes(i) ? 2000 : 1000,
    h: 1500,
    wide: wide.includes(i),
  }));
}
function lay(
  n: number,
  o: {
    wide?: number[];
    cover?: boolean;
    shift?: 0 | 1;
    ov?: PageOverride[];
    layout?: LayoutMode;
  } = {},
) {
  return layoutSpreads(pages(n, o.wide), {
    coverOffset: o.cover ?? false,
    pairShift: o.shift ?? 0,
    overrides: o.ov ?? [],
    layout: o.layout ?? 'double',
  }).map((s) => s.pages);
}

describe('layoutSpreads table', () => {
  const cases: [string, ReturnType<typeof lay>, number[][]][] = [
    [
      'no offset, even',
      lay(4),
      [
        [0, 1],
        [2, 3],
      ],
    ],
    ['no offset, odd', lay(5), [[0, 1], [2, 3], [4]]],
    ['cover offset, even', lay(4, { cover: true }), [[0], [1, 2], [3]]],
    ['cover offset, odd', lay(5, { cover: true }), [[0], [1, 2], [3, 4]]],
    ['single page book', lay(1), [[0]]],
    ['single page book with cover', lay(1, { cover: true }), [[0]]],
    ['empty book', lay(0), []],
    ['two pages with cover', lay(2, { cover: true }), [[0], [1]]],
    ['single layout', lay(3, { layout: 'single' }), [[0], [1], [2]]],
    ['webtoon layout', lay(3, { layout: 'webtoon' }), [[0], [1], [2]]],
    [
      'auto pairs like double',
      lay(4, { layout: 'auto' }),
      [
        [0, 1],
        [2, 3],
      ],
    ],
    ['wide mid-book alone, repairs after', lay(6, { wide: [2] }), [[0, 1], [2], [3, 4], [5]]],
    ['wide flushes pending', lay(5, { wide: [1] }), [[0], [1], [2, 3], [4]]],
    ['wide first page', lay(4, { wide: [0] }), [[0], [1, 2], [3]]],
    ['wide last page', lay(4, { wide: [3] }), [[0, 1], [2], [3]]],
    ['wide with cover', lay(6, { cover: true, wide: [3] }), [[0], [1, 2], [3], [4, 5]]],
    ['consecutive wide', lay(4, { wide: [1, 2] }), [[0], [1], [2], [3]]],
    ['all wide', lay(3, { wide: [0, 1, 2] }), [[0], [1], [2]]],
    ['shift without cover', lay(5, { shift: 1 }), [[0], [1, 2], [3, 4]]],
    ['shift with cover', lay(6, { cover: true, shift: 1 }), [[0], [1], [2, 3], [4, 5]]],
    ['override single', lay(5, { ov: [{ index: 2, kind: 'single' }] }), [[0, 1], [2], [3, 4]]],
    [
      'override single flushes pending',
      lay(5, { ov: [{ index: 1, kind: 'single' }] }),
      [[0], [1], [2, 3], [4]],
    ],
    [
      'override spreadStart',
      lay(5, { ov: [{ index: 1, kind: 'spreadStart' }] }),
      [[0], [1, 2], [3, 4]],
    ],
    [
      'override spreadStart on already-aligned page is a no-op',
      lay(4, { ov: [{ index: 2, kind: 'spreadStart' }] }),
      [
        [0, 1],
        [2, 3],
      ],
    ],
    ['override hidden', lay(4, { ov: [{ index: 1, kind: 'hidden' }] }), [[0, 2], [3]]],
    [
      'hidden in single layout',
      lay(3, { layout: 'single', ov: [{ index: 1, kind: 'hidden' }] }),
      [[0], [2]],
    ],
    [
      'hidden cover with offset: page 0 is skipped, page 1 pairs',
      lay(4, { cover: true, ov: [{ index: 0, kind: 'hidden' }] }),
      [[1, 2], [3]],
    ],
    [
      'spreadStart + cover',
      lay(6, { cover: true, ov: [{ index: 3, kind: 'spreadStart' }] }),
      [[0], [1, 2], [3, 4], [5]],
    ],
    [
      'single override on wide is still alone',
      lay(3, { wide: [1], ov: [{ index: 1, kind: 'single' }] }),
      [[0], [1], [2]],
    ],
  ];
  it.each(cases)('%s', (_n, got, want) => {
    expect(got).toEqual(want);
  });
});

describe('invariants', () => {
  it('every visible page appears exactly once, in order', () => {
    for (const n of [0, 1, 2, 3, 7, 10, 25]) {
      for (const cover of [false, true]) {
        for (const shift of [0, 1] as const) {
          const wide = [2, 5, 9].filter((x) => x < n);
          const flat = lay(n, { wide, cover, shift }).flat();
          expect(flat).toEqual(Array.from({ length: n }, (_, i) => i));
        }
      }
    }
  });
  it('spreads never exceed 2 pages and never pair a wide page', () => {
    const wide = [3, 4, 8];
    const sp = lay(12, { wide, cover: true });
    for (const s of sp) {
      expect(s.length).toBeLessThanOrEqual(2);
      if (s.length === 2) expect(s.some((p) => wide.includes(p))).toBe(false);
    }
  });
});

describe('page <-> spread mapping', () => {
  const sp = layoutSpreads(pages(7, [4]), {
    coverOffset: true,
    pairShift: 0,
    overrides: [],
    layout: 'double',
  });
  it('maps every page to a spread containing it', () => {
    for (let p = 0; p < 7; p++) {
      expect(sp[pageToSpread(sp, p)]!.pages).toContain(p);
    }
  });
  it('spreadToPage returns lowest page', () => {
    expect(spreadToPage(sp, 1)).toBe(1);
    expect(spreadToPage(sp, 2)).toBe(3);
    expect(spreadToPage(sp, 99)).toBe(spreadToPage(sp, sp.length - 1));
    expect(spreadToPage(sp, -3)).toBe(0);
  });
  it('round trip: spreadToPage(pageToSpread(p)) <= p and same spread', () => {
    for (let p = 0; p < 7; p++) {
      const s = pageToSpread(sp, p);
      expect(spreadToPage(sp, s)).toBeLessThanOrEqual(p);
      expect(pageToSpread(sp, spreadToPage(sp, s))).toBe(s);
    }
  });
  it('hidden page maps to the next visible spread', () => {
    const s2 = layoutSpreads(pages(5), {
      coverOffset: false,
      pairShift: 0,
      overrides: [{ index: 2, kind: 'hidden' }],
      layout: 'double',
    });
    expect(s2.map((s) => s.pages)).toEqual([
      [0, 1],
      [3, 4],
    ]);
    expect(pageToSpread(s2, 2)).toBe(1);
  });
  it('empty list is safe', () => {
    expect(pageToSpread([], 3)).toBe(0);
    expect(spreadToPage([], 3)).toBe(0);
  });
});

describe('layout change preserves the page being read', () => {
  it('stored page index survives switching layout and offset', () => {
    const base = { pairShift: 0 as const, overrides: [] };
    for (let page = 0; page < 9; page++) {
      const a = layoutSpreads(pages(9), { ...base, coverOffset: false, layout: 'double' });
      const b = layoutSpreads(pages(9), { ...base, coverOffset: true, layout: 'double' });
      const c = layoutSpreads(pages(9), { ...base, coverOffset: true, layout: 'single' });
      // the reader stores the page index, then re-derives the spread after the change
      expect(a[pageToSpread(a, page)]!.pages).toContain(page);
      expect(b[pageToSpread(b, page)]!.pages).toContain(page);
      expect(c[pageToSpread(c, page)]!.pages).toEqual([page]);
    }
  });
});

describe('visual order and helpers', () => {
  it('rtl reverses a pair, ltr keeps it', () => {
    expect(visualOrder({ pages: [4, 5] }, 'rtl')).toEqual([5, 4]);
    expect(visualOrder({ pages: [4, 5] }, 'ltr')).toEqual([4, 5]);
    expect(visualOrder({ pages: [4] }, 'rtl')).toEqual([4]);
  });
  it('isWide', () => {
    expect(isWide(2000, 1500)).toBe(true);
    expect(isWide(1000, 1500)).toBe(false);
    expect(isWide(1000, 1000)).toBe(false);
    expect(isWide(1000, 0)).toBe(false);
  });
  it('resolveLayout', () => {
    expect(resolveLayout('auto', 1600, 900)).toBe('double');
    expect(resolveLayout('auto', 400, 800)).toBe('single');
    expect(resolveLayout('webtoon', 1600, 900)).toBe('webtoon');
  });
});
