import { borderColor, FULL_PAGE, type Lum, type Rect } from './trim.ts';

export type { Rect } from './trim.ts';

const TOLERANCE = 24;
const NOISE = 0.02; // a row/column with under 1% content pixels counts as gutter
const MIN_GUTTER = 0.005; // gutter at least 1% of the page side
const MAX_DEPTH = 4;
const MIN_AREA = 0.02;
const MIN_PANELS = 2;
const MAX_PANELS = 30;
/** Pages at least this wide are scanned double-page spreads: each half is analysed on its own. */
const SPREAD_ASPECT = 1.2;
/** Width (fraction of the short side) of the page edge / spine band that is ignored (scan shading). */
const EDGE_BAND = 0.015;

interface Box {
  x0: number;
  y0: number;
  x1: number; // exclusive
  y1: number;
}

export interface PanelAnalysis {
  /** unordered panel rectangles (fractions of the page) */
  panels: Rect[];
  /** the page is a two-page spread: panels belong to the left or right half */
  spread: boolean;
}

/** Content runs separated by gutters in a 1-D projection (positions are within [from, to)). */
function runs(profile: Uint32Array, from: number, to: number, noise: number, minGap: number) {
  const out: [number, number][] = [];
  let start = -1;
  let gap = 0;
  for (let i = from; i < to; i++) {
    if (profile[i]! > noise) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap >= minGap) {
        out.push([start, i - gap + 1]);
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) out.push([start, to - gap]);
  return out;
}

/** Binary "content" mask for a gutter colour; the page edge (and spine) bands count as gutter. */
function buildMask(lum: Lum, gutter: number, spineX: number | null): Uint8Array {
  const { w, h, data } = lum;
  const mask = new Uint8Array(w * h);
  const band = Math.max(2, Math.round(Math.min(w, h) * EDGE_BAND));
  for (let y = 0; y < h; y++) {
    const edgeY = y < band || y >= h - band;
    for (let x = 0; x < w; x++) {
      const edgeX = x < band || x >= w - band || (spineX !== null && Math.abs(x - spineX) < band);
      if (!edgeY && !edgeX && Math.abs(data[y * w + x]! - gutter) > TOLERANCE) mask[y * w + x] = 1;
    }
  }
  return mask;
}

function profile(mask: Uint8Array, w: number, h: number, b: Box, axis: 'row' | 'col'): Uint32Array {
  const p = new Uint32Array(axis === 'row' ? h : w);
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      if (mask[y * w + x]) {
        if (axis === 'row') p[y]!++;
        else p[x]!++;
      }
    }
  }
  return p;
}

/** Number of gutter rows + columns inside `b`: how well `mask` separates this region into panels. */
function gutterScore(mask: Uint8Array, w: number, h: number, b: Box): number {
  const rows = profile(mask, w, h, b, 'row');
  const cols = profile(mask, w, h, b, 'col');
  let n = 0;
  for (let y = b.y0; y < b.y1; y++) if (rows[y]! <= (b.x1 - b.x0) * NOISE) n++;
  for (let x = b.x0; x < b.x1; x++) if (cols[x]! <= (b.y1 - b.y0) * NOISE) n++;
  return n;
}

/** The brightest common luminance (page paper), or null when the page has no light peak. */
function lightPeak(lum: Lum): number | null {
  const hist = new Uint32Array(256);
  for (const v of lum.data) hist[v]!++;
  let best = -1;
  let bestN = 0;
  for (let v = 190; v < 256; v++) {
    let n = 0;
    for (let d = -3; d <= 3; d++) n += hist[Math.min(255, Math.max(0, v + d))]!;
    if (n > bestN) {
      bestN = n;
      best = v;
    }
  }
  return bestN >= lum.data.length * 0.05 ? best : null;
}

function leavesIn(mask: Uint8Array, w: number, h: number, region: Box): Box[] {
  const minGapY = Math.max(2, Math.round(h * MIN_GUTTER));
  const minGapX = Math.max(2, Math.round(w * MIN_GUTTER));
  const leaves: Box[] = [];
  const cut = (b: Box, depth: number): void => {
    if (b.x1 - b.x0 < 2 || b.y1 - b.y0 < 2) return;
    if (depth < MAX_DEPTH) {
      const rows = runs(profile(mask, w, h, b, 'row'), b.y0, b.y1, (b.x1 - b.x0) * NOISE, minGapY);
      if (rows.length > 1) {
        for (const [a, z] of rows) cut({ ...b, y0: a, y1: z }, depth + 1);
        return;
      }
      const cols = runs(profile(mask, w, h, b, 'col'), b.x0, b.x1, (b.y1 - b.y0) * NOISE, minGapX);
      if (cols.length > 1) {
        for (const [a, z] of cols) cut({ ...b, x0: a, x1: z }, depth + 1);
        return;
      }
    }
    // leaf: trim to the content bounds
    const rows = runs(profile(mask, w, h, b, 'row'), b.y0, b.y1, (b.x1 - b.x0) * NOISE, 1);
    const cols = runs(profile(mask, w, h, b, 'col'), b.x0, b.x1, (b.y1 - b.y0) * NOISE, 1);
    if (rows.length === 0 || cols.length === 0) return;
    leaves.push({
      x0: cols[0]![0],
      x1: cols[cols.length - 1]![1],
      y0: rows[0]![0],
      y1: rows[rows.length - 1]![1],
    });
  };
  cut(region, 0);
  return leaves;
}

/**
 * Panels via a recursive X-Y cut on a binary content mask. The gutter colour is the page border
 * colour or, when that separates the page worse, the light paper peak (scans often have a dark
 * scanner border around white gutters). Double-page spreads are cut in two and each half analysed
 * separately. Falls back to the whole page when the result is implausible (DESIGN 7.6).
 */
export function analyzePanels(lum: Lum): PanelAnalysis {
  const { w, h } = lum;
  const spread = w / h >= SPREAD_ASPECT;
  const spineX = spread ? Math.round(w / 2) : null;
  const regions: Box[] = spread
    ? [
        { x0: 0, y0: 0, x1: spineX!, y1: h },
        { x0: spineX!, y0: 0, x1: w, y1: h },
      ]
    : [{ x0: 0, y0: 0, x1: w, y1: h }];

  const candidates = [borderColor(lum)];
  const peak = lightPeak(lum);
  if (peak !== null && Math.abs(peak - candidates[0]!) > TOLERANCE) candidates.push(peak);
  let mask = buildMask(lum, candidates[0]!, spineX);
  let bestScore = regions.reduce((a, r) => a + gutterScore(mask, w, h, r), 0);
  for (const c of candidates.slice(1)) {
    const m = buildMask(lum, c, spineX);
    const score = regions.reduce((a, r) => a + gutterScore(m, w, h, r), 0);
    if (score > bestScore) {
      bestScore = score;
      mask = m;
    }
  }

  const perRegion = regions.map((r) => leavesIn(mask, w, h, r));
  // a spread needs structure in at least one half; a single page needs two panels
  const total = perRegion.reduce((a, l) => a + l.length, 0);
  const structured = spread ? perRegion.some((l) => l.length >= 2) : total >= MIN_PANELS;
  const rects: Rect[] = perRegion
    .flat()
    .map((b) => ({ x: b.x0 / w, y: b.y0 / h, w: (b.x1 - b.x0) / w, h: (b.y1 - b.y0) / h }))
    .filter((r) => r.w * r.h >= MIN_AREA / (spread ? 2 : 1));
  if (!structured || rects.length < MIN_PANELS || rects.length > MAX_PANELS) {
    return { panels: [FULL_PAGE], spread };
  }
  return { panels: rects, spread };
}

/** Unordered panel rectangles (or the whole page); order them with readingOrder(). */
export function findPanels(lum: Lum): Rect[] {
  return analyzePanels(lum).panels;
}

export function detectPanels(lum: Lum, rtl: boolean): Rect[] {
  const a = analyzePanels(lum);
  return a.panels.length === 1 ? a.panels : readingOrder(a.panels, rtl, a.spread);
}

/** Rows by vertical overlap (> 50% of the shorter panel), then left/right per direction. */
function rowsInOrder(rects: Rect[], rtl: boolean): Rect[] {
  const byTop = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Rect[][] = [];
  for (const r of byTop) {
    const row = rows.find((row) => {
      const ref = row[0]!;
      const overlap = Math.min(ref.y + ref.h, r.y + r.h) - Math.max(ref.y, r.y);
      return overlap > 0.5 * Math.min(ref.h, r.h);
    });
    if (row) row.push(r);
    else rows.push([r]);
  }
  rows.sort((a, b) => Math.min(...a.map((r) => r.y)) - Math.min(...b.map((r) => r.y)));
  return rows.flatMap((row) => row.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x)));
}

/**
 * Reading order. On a two-page spread the whole first page (right half when `rtl`) is read before
 * the other, each in row order; otherwise plain row order.
 */
export function readingOrder(rects: Rect[], rtl: boolean, spread = false): Rect[] {
  if (!spread) return rowsInOrder(rects, rtl);
  const left = rects.filter((r) => r.x + r.w / 2 < 0.5);
  const right = rects.filter((r) => r.x + r.w / 2 >= 0.5);
  const first = rtl ? right : left;
  const second = rtl ? left : right;
  return [...rowsInOrder(first, rtl), ...rowsInOrder(second, rtl)];
}
