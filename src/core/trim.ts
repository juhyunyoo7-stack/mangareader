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

/**
 * Bounding box of "content" (pixels differing from the border colour by more than `tolerance`).
 * Rows and columns holding fewer than `noise` (0.5% by default) content pixels are treated as empty,
 * so scanner dust and single specks do not defeat the trim. Returns the full page for blank pages.
 */
export function contentBox(lum: Lum, tolerance = 24, noise = 0.005): Rect {
  const g = borderColor(lum);
  const rows = new Uint32Array(lum.h);
  const cols = new Uint32Array(lum.w);
  for (let y = 0; y < lum.h; y++) {
    for (let x = 0; x < lum.w; x++) {
      if (Math.abs(lum.data[y * lum.w + x]! - g) > tolerance) {
        rows[y]!++;
        cols[x]!++;
      }
    }
  }
  const rowMin = Math.max(1, Math.round(lum.w * noise));
  const colMin = Math.max(1, Math.round(lum.h * noise));
  let y0 = 0;
  while (y0 < lum.h && rows[y0]! < rowMin) y0++;
  let y1 = lum.h - 1;
  while (y1 > y0 && rows[y1]! < rowMin) y1--;
  let x0 = 0;
  while (x0 < lum.w && cols[x0]! < colMin) x0++;
  let x1 = lum.w - 1;
  while (x1 > x0 && cols[x1]! < colMin) x1--;
  if (y0 >= lum.h || x0 >= lum.w) return FULL_PAGE;
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
