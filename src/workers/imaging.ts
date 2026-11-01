/// <reference lib="webworker" />
/** Image decode helpers shared by workers, with runtime capability probes (DESIGN 7.1). */
export interface Caps {
  /** createImageBitmap honours resizeWidth/resizeHeight */
  bitmapResize: boolean;
  /** createImageBitmap(bitmap, sx, sy, sw, sh, {resize*}) works */
  cropResize: boolean;
  offscreen2d: boolean;
}

const PROBE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let caps: Promise<Caps> | undefined;

export function getCaps(): Promise<Caps> {
  caps ??= (async () => {
    const out: Caps = { bitmapResize: false, cropResize: false, offscreen2d: false };
    try {
      const c = new OffscreenCanvas(2, 2);
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillRect(0, 0, 1, 1);
        out.offscreen2d = typeof c.transferToImageBitmap === 'function';
      }
    } catch {
      out.offscreen2d = false;
    }
    try {
      const bytes = Uint8Array.from(atob(PROBE_PNG), (ch) => ch.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      const b = await createImageBitmap(blob, {
        resizeWidth: 2,
        resizeHeight: 2,
        resizeQuality: 'high',
      });
      out.bitmapResize = b.width === 2 && b.height === 2;
      b.close();
      const src = await createImageBitmap(blob);
      try {
        const t = await createImageBitmap(src, 0, 0, 1, 1, {
          resizeWidth: 2,
          resizeHeight: 2,
          resizeQuality: 'high',
        });
        out.cropResize = t.width === 2 && t.height === 2;
        t.close();
      } catch {
        out.cropResize = false;
      }
      src.close();
    } catch {
      out.bitmapResize = false;
    }
    return out;
  })();
  return caps;
}

/** Downscale `src` in steps of at most 2x using an offscreen canvas (quality fallback path). */
function stepDown(src: ImageBitmap, tw: number, th: number): ImageBitmap {
  let cur: ImageBitmap | OffscreenCanvas = src;
  let cw = src.width;
  let ch = src.height;
  while (cw > tw * 2 || ch > th * 2) {
    const nw = Math.max(tw, Math.ceil(cw / 2));
    const nh = Math.max(th, Math.ceil(ch / 2));
    const c = new OffscreenCanvas(nw, nh);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, nw, nh);
    cur = c;
    cw = nw;
    ch = nh;
  }
  const out = new OffscreenCanvas(tw, th);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, tw, th);
  return out.transferToImageBitmap();
}

/** Decode a blob directly at the target size. */
export async function decodeScaled(blob: Blob, tw: number, th: number): Promise<ImageBitmap> {
  const caps = await getCaps();
  tw = Math.max(1, Math.round(tw));
  th = Math.max(1, Math.round(th));
  if (caps.bitmapResize) {
    return createImageBitmap(blob, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' });
  }
  const full = await createImageBitmap(blob);
  if (full.width === tw && full.height === th) return full;
  if (!caps.offscreen2d) return full; // last resort: caller downscales on the main thread
  try {
    return stepDown(full, tw, th);
  } finally {
    full.close();
  }
}

/** Crop a source rectangle out of `src` and resample it to dw x dh. */
export async function cropScaled(
  src: ImageBitmap,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Promise<ImageBitmap> {
  const caps = await getCaps();
  dw = Math.max(1, Math.round(dw));
  dh = Math.max(1, Math.round(dh));
  if (caps.cropResize) {
    return createImageBitmap(src, sx, sy, sw, sh, {
      resizeWidth: dw,
      resizeHeight: dh,
      resizeQuality: 'high',
    });
  }
  if (!caps.offscreen2d) return createImageBitmap(src, sx, sy, sw, sh);
  const c = new OffscreenCanvas(dw, dh);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
  return c.transferToImageBitmap();
}
