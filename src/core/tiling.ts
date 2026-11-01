/** Pure size-clamping and tiling math (DESIGN 7.1). The iOS canvas cap is 16,777,216 px. */
export const MAX_CANVAS_PIXELS = 16_000_000;
export const MAX_DIMENSION = 8192;
export const TILE_SIZE = 2048;

export interface Size {
  w: number;
  h: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Clamp a wanted decode size: never upscale past native pixels, never exceed the canvas area cap or
 * the max dimension. Aspect ratio of the source is preserved.
 */
export function clampDecodeSize(
  src: Size,
  want: Size,
  maxPixels = MAX_CANVAS_PIXELS,
  maxDim = MAX_DIMENSION,
): Size & { scale: number } {
  let scale = Math.min(want.w / src.w, want.h / src.h, 1);
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  const areaScale = Math.sqrt(maxPixels / (src.w * src.h));
  const dimScale = maxDim / Math.max(src.w, src.h);
  scale = Math.min(scale, areaScale, dimScale);
  const w = Math.max(1, Math.floor(src.w * scale));
  const h = Math.max(1, Math.floor(src.h * scale));
  return { w, h, scale };
}

export function fitsCanvas(
  w: number,
  h: number,
  maxPixels = MAX_CANVAS_PIXELS,
  maxDim = MAX_DIMENSION,
): boolean {
  return w * h <= maxPixels && Math.max(w, h) <= maxDim;
}

/** Grid of tiles covering a w x h area; every tile is at most `tile` in each dimension. */
export function planTiles(w: number, h: number, tile = TILE_SIZE): Rect[] {
  const out: Rect[] = [];
  for (let y = 0; y < h; y += tile) {
    for (let x = 0; x < w; x += tile) {
      out.push({ x, y, w: Math.min(tile, w - x), h: Math.min(tile, h - y) });
    }
  }
  return out;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Tiles of the grid that intersect a region (used for visible-region-only rendering). */
export function tilesForRegion(w: number, h: number, region: Rect, tile = TILE_SIZE): Rect[] {
  return planTiles(w, h, tile).filter((t) => intersects(t, region));
}

/** Horizontal strips of a tall page, used by webtoon mode. `stripH` is in output pixels. */
export function planStrips(h: number, stripH = TILE_SIZE): { y: number; h: number }[] {
  const out: { y: number; h: number }[] = [];
  for (let y = 0; y < h; y += stripH) out.push({ y, h: Math.min(stripH, h - y) });
  return out;
}

export function bitmapBytes(w: number, h: number): number {
  return w * h * 4;
}
