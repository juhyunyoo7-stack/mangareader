// Pure luminance-buffer analysis shared by auto-trim and panel detection. No DOM.

/** Normalised rectangle: all fields are fractions (0..1) of the page. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 8-bit luminance, row-major. */
export interface Lum {
  data: Uint8Array | Uint8ClampedArray;
  w: number;
  h: number;
}

export const FULL_PAGE: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** Median luminance of the outer ring (2% of the short side, at least 1 px). */
export function borderColor(lum: Lum): number {
  const t = Math.max(1, Math.round(Math.min(lum.w, lum.h) * 0.02));
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = 0; y < lum.h; y++) {
    const edgeRow = y < t || y >= lum.h - t;
    for (let x = 0; x < lum.w; x++) {
      if (edgeRow || x < t || x >= lum.w - t) {
        hist[lum.data[y * lum.w + x]!]!++;
        n++;
      }
    }
  }
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc * 2 >= n) return v;
  }
  return 255;
}

/** Pixel box, x1/y1 exclusive. */
interface PxBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Luminance at or below this counts as "dark" when looking for a scanner border band. */
const DARK = 70;
/** A border line must be dark on at least this share of its pixels. */
const DARK_SHARE = 0.85;
/** A scanner band wider than this (share of the page side) is treated as art, not border. */
const MAX_BAND = 0.04;
/**
 * Safety margin (pixels at the 512 px analysis size) kept around the content when the margin itself
 * is dark: a black panel frame next to a black margin has the margin's colour and would otherwise be
 * cut. Light margins need none (ink is clearly different from paper).
 */
const DARK_MARGIN_PAD_PX = 3;

/** Luminance above this counts as "paper" right after a scanner band. */
const LIGHT = 140;
/** Lines after a band that must be blank paper before the band is stripped. */
const PAPER_LINES = 3;

/** Share of the pixels of one column (vertical) or row inside `b` that pass `test`. */
function lineShare(
  lum: Lum,
  b: PxBox,
  line: number,
  vertical: boolean,
  test: (v: number) => boolean,
): number {
  let hit = 0;
  let n = 0;
  if (vertical) {
    for (let y = b.y0; y < b.y1; y++, n++) if (test(lum.data[y * lum.w + line]!)) hit++;
  } else {
    for (let x = b.x0; x < b.x1; x++, n++) if (test(lum.data[line * lum.w + x]!)) hit++;
  }
  return n ? hit / n : 0;
}

const isDark = (v: number) => v <= DARK;
const isLight = (v: number) => v > LIGHT;

/**
 * Strips a uniform dark scanner band from each side. A band only counts when it ends within
 * MAX_BAND of the page side AND is followed by blank paper; when art (or a panel frame) touches
 * the paper edge right after the band, that side is left uncropped so no ink is ever cut.
 */
export function stripDarkBands(lum: Lum): PxBox {
  const b: PxBox = { x0: 0, y0: 0, x1: lum.w, y1: lum.h };
  const maxX = Math.max(1, Math.floor(lum.w * MAX_BAND));
  const maxY = Math.max(1, Math.floor(lum.h * MAX_BAND));
  const band = (start: number, step: number, max: number, vertical: boolean): number => {
    let n = 0;
    while (n < max && lineShare(lum, b, start + n * step, vertical, isDark) >= DARK_SHARE) n++;
    if (n === 0 || n >= max) return 0; // no band, or dark art that keeps going
    for (let k = 0; k < PAPER_LINES; k++) {
      const line = start + (n + k) * step;
      const inside = vertical ? line >= b.x0 && line < b.x1 : line >= b.y0 && line < b.y1;
      if (!inside || lineShare(lum, b, line, vertical, isLight) < DARK_SHARE) return 0;
    }
    return n;
  };
  // two passes so corner pixels of the other sides' bands do not hide a band
  for (let pass = 0; pass < 2; pass++) {
    const left = band(b.x0, 1, maxX - b.x0, true);
    const right = band(b.x1 - 1, -1, maxX - (lum.w - b.x1), true);
    b.x0 += left;
    b.x1 -= right;
    const top = band(b.y0, 1, maxY - b.y0, false);
    const bottom = band(b.y1 - 1, -1, maxY - (lum.h - b.y1), false);
    b.y0 += top;
    b.y1 -= bottom;
  }
  return b;
}

/** Median luminance of the 2% ring just inside `b`. */
function ringColor(lum: Lum, b: PxBox): number {
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  const t = Math.max(1, Math.round(Math.min(bw, bh) * 0.02));
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = b.y0; y < b.y1; y++) {
    const edgeRow = y < b.y0 + t || y >= b.y1 - t;
    for (let x = b.x0; x < b.x1; x++) {
      if (edgeRow || x < b.x0 + t || x >= b.x1 - t) {
        hist[lum.data[y * lum.w + x]!]!++;
        n++;
      }
    }
  }
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc * 2 >= n) return v;
  }
  return 255;
}

/**
 * Bounding box of "content" (pixels differing from the paper colour by more than `tolerance`).
 * A dark scanner band around the paper is removed first (stripDarkBands), then blank paper margins.
 * Rows and columns holding fewer than `noise` (0.5% by default) content pixels are treated as empty,
 * so scanner dust and single specks do not defeat the trim. Ink touching the paper edge is never
 * cut (guard tests in tests/unit/panels.test.ts). Returns the full page for blank pages.
 */
export function contentBox(lum: Lum, tolerance = 24, noise = 0.005): Rect {
  const b = stripDarkBands(lum);
  if (b.x1 - b.x0 < lum.w / 2 || b.y1 - b.y0 < lum.h / 2) return FULL_PAGE;
  const g = ringColor(lum, b);
  const rows = new Uint32Array(lum.h);
  const cols = new Uint32Array(lum.w);
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      if (Math.abs(lum.data[y * lum.w + x]! - g) > tolerance) {
        rows[y]!++;
        cols[x]!++;
      }
    }
  }
  const rowMin = Math.max(1, Math.round((b.x1 - b.x0) * noise));
  const colMin = Math.max(1, Math.round((b.y1 - b.y0) * noise));
  let y0 = b.y0;
  while (y0 < b.y1 && rows[y0]! < rowMin) y0++;
  let y1 = b.y1 - 1;
  while (y1 > y0 && rows[y1]! < rowMin) y1--;
  let x0 = b.x0;
  while (x0 < b.x1 && cols[x0]! < colMin) x0++;
  let x1 = b.x1 - 1;
  while (x1 > x0 && cols[x1]! < colMin) x1--;
  if (y0 >= b.y1 || x0 >= b.x1) {
    // blank paper inside a scanner band: the band alone may still be cropped
    if (b.x0 === 0 && b.y0 === 0 && b.x1 === lum.w && b.y1 === lum.h) return FULL_PAGE;
    x0 = b.x0;
    y0 = b.y0;
    x1 = b.x1 - 1;
    y1 = b.y1 - 1;
  }
  // safety margin on dark margins, but never back into the stripped band
  const pad = g <= DARK ? Math.max(1, Math.round((DARK_MARGIN_PAD_PX * lum.w) / 512)) : 0;
  x0 = Math.max(b.x0, x0 - pad);
  y0 = Math.max(b.y0, y0 - pad);
  x1 = Math.min(b.x1 - 1, x1 + pad);
  y1 = Math.min(b.y1 - 1, y1 + pad);
  return { x: x0 / lum.w, y: y0 / lum.h, w: (x1 - x0 + 1) / lum.w, h: (y1 - y0 + 1) / lum.h };
}

/** Smallest rectangle containing both (used so both pages of a spread keep the same crop). */
export function unionRect(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** True when trimming would remove less than `minShare` of the page (not worth cropping). */
export function isNegligibleCrop(r: Rect, minShare = 0.01): boolean {
  return 1 - r.w * r.h < minShare;
}
