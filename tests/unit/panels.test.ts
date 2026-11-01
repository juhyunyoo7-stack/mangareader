import { describe, expect, it } from 'vitest';
import { analyzePanels, detectPanels, readingOrder } from '../../src/core/panels.ts';
import {
  contentBox,
  isNegligibleCrop,
  unionRect,
  type Lum,
  type Rect,
} from '../../src/core/trim.ts';

const W = 512;

/** Deterministic pseudo-noise in [0, 1). */
function rnd(i: number): number {
  let x = (i * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

interface PageOpts {
  w?: number;
  h?: number;
  /** thickness (px) of a dark scanner border around the paper */
  scanBorder?: number;
  bg?: number;
  fill?: number;
  speckle?: number;
}

/** Page of rectangles (fractions) with a 2 px border, hatched fill and optional gutter speckle. */
function makePage(panels: Rect[], o: PageOpts = {}): Lum {
  const W = o.w ?? 512;
  const H = o.h ?? 728;
  const bg = o.bg ?? 255;
  const fill = o.fill ?? 120;
  const data = new Uint8Array(W * H).fill(bg);
  for (const p of panels) {
    const x0 = Math.round(p.x * W);
    const y0 = Math.round(p.y * H);
    const x1 = Math.round((p.x + p.w) * W);
    const y1 = Math.round((p.y + p.h) * H);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const edge = x < x0 + 2 || x >= x1 - 2 || y < y0 + 2 || y >= y1 - 2;
        const hatch = (x + y) % 9 < 2 ? 40 : 0;
        data[y * W + x] = edge ? 0 : Math.max(0, fill - hatch + Math.round(rnd(y * W + x) * 12));
      }
    }
  }
  if (o.speckle) {
    for (let i = 0; i < data.length; i++) {
      if (rnd(i + 99991) < o.speckle && data[i] === bg) data[i] = bg === 255 ? 150 : 100;
    }
  }
  const sb = o.scanBorder ?? 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < sb || x >= W - sb || y < sb || y >= H - sb) data[y * W + x] = 20;
    }
  }
  return { data, w: W, h: H };
}

const iou = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (a.w * a.h + b.w * b.h - i);
};

function exact(found: Rect[], want: Rect[]): boolean {
  return found.length === want.length && want.every((r, i) => iou(found[i]!, r) > 0.93);
}

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

const GRID = [
  r(0.05, 0.04, 0.42, 0.28),
  r(0.53, 0.04, 0.42, 0.28),
  r(0.05, 0.36, 0.42, 0.28),
  r(0.53, 0.36, 0.42, 0.28),
  r(0.05, 0.68, 0.42, 0.28),
  r(0.53, 0.68, 0.42, 0.28),
];
const STAGGER = [
  r(0.05, 0.04, 0.9, 0.3),
  r(0.05, 0.38, 0.55, 0.28),
  r(0.65, 0.38, 0.3, 0.28),
  r(0.05, 0.7, 0.28, 0.26),
  r(0.37, 0.7, 0.28, 0.26),
  r(0.69, 0.7, 0.26, 0.26),
];
const TALL_LEFT = [r(0.05, 0.04, 0.4, 0.92), r(0.5, 0.04, 0.45, 0.44), r(0.5, 0.52, 0.45, 0.44)];

describe('panel detection on generated grid fixtures', () => {
  it('2x3 grid, ltr and rtl reading order', () => {
    const page = makePage(GRID);
    const ltr = detectPanels(page, false);
    expect(exact(ltr, GRID)).toBe(true);
    const rtl = detectPanels(page, true);
    expect(exact(rtl, [GRID[1]!, GRID[0]!, GRID[3]!, GRID[2]!, GRID[5]!, GRID[4]!])).toBe(true);
  });

  it('staggered rows (1 / 2 / 3 panels)', () => {
    expect(exact(detectPanels(makePage(STAGGER), false), STAGGER)).toBe(true);
    const rtl = detectPanels(makePage(STAGGER), true);
    expect(
      exact(rtl, [STAGGER[0]!, STAGGER[2]!, STAGGER[1]!, STAGGER[5]!, STAGGER[4]!, STAGGER[3]!]),
    ).toBe(true);
  });

  it('tall left panel next to two stacked panels', () => {
    const page = makePage(TALL_LEFT);
    expect(exact(detectPanels(page, false), TALL_LEFT)).toBe(true);
    expect(exact(detectPanels(page, true), [TALL_LEFT[1]!, TALL_LEFT[2]!, TALL_LEFT[0]!])).toBe(
      true,
    );
  });

  it('black gutters with light panels', () => {
    const page = makePage(GRID, { bg: 0, fill: 200 });
    // border of panels is 0 = same as gutter, interior still detected as content
    expect(detectPanels(page, false)).toHaveLength(6);
  });

  it('survives gutter speckle (scan dust)', () => {
    expect(exact(detectPanels(makePage(GRID, { speckle: 0.0015 }), false), GRID)).toBe(true);
  });

  it('full-bleed page and single splash fall back to the whole page', () => {
    expect(detectPanels(makePage([r(0, 0, 1, 1)]), false)).toEqual([r(0, 0, 1, 1)]);
    expect(detectPanels(makePage([r(0.05, 0.05, 0.9, 0.9)]), false)).toEqual([r(0, 0, 1, 1)]);
  });

  it('blank page falls back to the whole page', () => {
    expect(detectPanels(makePage([]), false)).toEqual([r(0, 0, 1, 1)]);
  });

  it('meets the >= 80% exact-set accuracy target over the fixture set', () => {
    const cases: [Rect[], boolean][] = [
      [GRID, false],
      [GRID, true],
      [STAGGER, false],
      [STAGGER, true],
      [TALL_LEFT, false],
      [TALL_LEFT, true],
      [GRID.slice(0, 4), false],
      [STAGGER.slice(0, 3), false],
      [[r(0.05, 0.05, 0.9, 0.4), r(0.05, 0.55, 0.9, 0.4)], false],
      [[r(0.05, 0.05, 0.4, 0.9), r(0.55, 0.05, 0.4, 0.9)], true],
    ];
    let ok = 0;
    for (const [panels, rtl] of cases) {
      const found = detectPanels(makePage(panels), rtl);
      const want = rtl ? detectPanels(makePage(panels), true) : panels; // order checked above
      if (found.length === panels.length && found.every((f) => want.some((w) => iou(f, w) > 0.93)))
        ok++;
    }
    expect(ok / cases.length).toBeGreaterThanOrEqual(0.8);
  });
});

describe('real-scan situations', () => {
  const pageGrid = (ox: number, sx: number): Rect[] =>
    [0, 1].flatMap((r) =>
      [0, 1].map((c) => ({
        x: ox + (0.06 + c * 0.22) * sx,
        y: 0.05 + r * 0.46,
        w: 0.2 * sx,
        h: 0.42,
      })),
    );

  it('two-page spread: each half is analysed, first page is read before the second', () => {
    const left = pageGrid(0, 0.5);
    const right = pageGrid(0.5, 0.5);
    const lum = makePage([...left, ...right], { w: 1000, h: 720 });
    const a = analyzePanels(lum);
    expect(a.spread).toBe(true);
    expect(a.panels).toHaveLength(8);
    const ltr = readingOrder(a.panels, false, true);
    expect(ltr.slice(0, 4).every((p) => p.x + p.w / 2 < 0.5)).toBe(true);
    expect(ltr.slice(4).every((p) => p.x + p.w / 2 >= 0.5)).toBe(true);
    const rtl = readingOrder(a.panels, true, true);
    expect(rtl.slice(0, 4).every((p) => p.x + p.w / 2 >= 0.5)).toBe(true);
    // inside the first page of an RTL book the top-right panel comes first
    expect(rtl[0]!.y).toBeLessThan(0.2);
    expect(rtl[0]!.x).toBeGreaterThan(rtl[1]!.x);
  });

  it('dark scanner border around white paper does not hide the gutters', () => {
    const page = makePage(GRID, { scanBorder: 10 });
    expect(detectPanels(page, false)).toHaveLength(6);
  });

  it('a spread whose halves have no structure is left whole', () => {
    const lum = makePage([r(0.03, 0.03, 0.44, 0.94), r(0.53, 0.03, 0.44, 0.94)], {
      w: 1000,
      h: 720,
    });
    expect(analyzePanels(lum).panels).toEqual([r(0, 0, 1, 1)]);
  });
});

describe('content box (auto-trim)', () => {
  const near = (a: Rect, b: Rect) => {
    const tol = 2 / W;
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol * 1.5);
    expect(Math.abs(a.x + a.w - (b.x + b.w))).toBeLessThanOrEqual(tol);
    expect(Math.abs(a.y + a.h - (b.y + b.h))).toBeLessThanOrEqual(tol * 1.5);
  };

  it('finds white margins within 2 px', () => {
    const box = r(0.1, 0.08, 0.78, 0.84);
    near(contentBox(makePage([box])), box);
  });

  it('finds black margins around light content', () => {
    const box = r(0.12, 0.1, 0.7, 0.8);
    near(contentBox(makePage([box], { bg: 0, fill: 210 })), { ...box });
  });

  it('ignores isolated specks', () => {
    const box = r(0.1, 0.08, 0.78, 0.84);
    near(contentBox(makePage([box], { speckle: 0.0008 })), box);
  });

  it('blank page and full-bleed page return the full page', () => {
    expect(contentBox(makePage([]))).toEqual(r(0, 0, 1, 1));
    near(contentBox(makePage([r(0, 0, 1, 1)])), r(0, 0, 1, 1));
  });

  /** Every ink pixel (outside the synthetic scanner border) lies inside the crop. */
  const inkInside = (lum: Lum, c: Rect, sb = 0) => {
    const x0 = Math.floor(c.x * lum.w);
    const y0 = Math.floor(c.y * lum.h);
    const x1 = Math.ceil((c.x + c.w) * lum.w);
    const y1 = Math.ceil((c.y + c.h) * lum.h);
    let outside = 0;
    for (let y = sb; y < lum.h - sb; y++) {
      for (let x = sb; x < lum.w - sb; x++) {
        if (lum.data[y * lum.w + x]! < 200 && (x < x0 || x >= x1 || y < y0 || y >= y1)) outside++;
      }
    }
    return outside;
  };

  it('dark scanner border around white margins: border and margins go, panels stay', () => {
    const page = makePage(GRID, { scanBorder: 10 });
    const c = contentBox(page);
    near(c, r(0.05, 0.04, 0.9, 0.92));
    expect(inkInside(page, c, 10)).toBe(0);
  });

  it('guard: art touching the paper edge inside a dark scanner border is never cropped', () => {
    for (const box of [
      r(10 / W, 0.2, 0.5, 0.6), // left edge
      r(0.3, 10 / 728, 0.4, 0.5), // top edge
      r(0.4, 0.3, 1 - 0.4 - 10 / W, 0.4), // right edge
      r(0.1, 0.5, 0.6, 0.5 - 10 / 728), // bottom edge
      r(10 / W, 10 / 728, 1 - 20 / W, 1 - 20 / 728), // full-bleed art inside the border
    ]) {
      const page = makePage([box], { scanBorder: 10 });
      const c = contentBox(page);
      expect(inkInside(page, c, 10)).toBe(0);
    }
  });

  it('guard: dark art at the image edge is not mistaken for a scanner border', () => {
    // a black area 10% wide down the whole left edge, then white paper with a panel
    const page = makePage([r(0.3, 0.2, 0.5, 0.5)]);
    for (let y = 0; y < page.h; y++)
      for (let x = 0; x < Math.round(page.w * 0.1); x++) page.data[y * page.w + x] = 5;
    const c = contentBox(page);
    expect(c.x).toBe(0);
    expect(inkInside(page, c)).toBe(0);
    // dark art covering only part of the edge
    const part = makePage([r(0, 0.1, 0.3, 0.3), r(0.4, 0.5, 0.5, 0.4)]);
    expect(inkInside(part, contentBox(part))).toBe(0);
    expect(contentBox(part).x).toBe(0);
  });

  it('union keeps both pages of a spread aligned; negligible crops are skipped', () => {
    const u = unionRect(r(0.1, 0.1, 0.5, 0.5), r(0.05, 0.2, 0.7, 0.6));
    expect([u.x, u.y, u.w, u.h].map((v) => Math.round(v * 1000))).toEqual([50, 100, 700, 700]);
    expect(isNegligibleCrop(r(0.002, 0.002, 0.996, 0.996))).toBe(true);
    expect(isNegligibleCrop(r(0.1, 0.1, 0.8, 0.8))).toBe(false);
  });
});
