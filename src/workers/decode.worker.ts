/// <reference lib="webworker" />
import type { ArchiveReader } from '../archive/ArchiveReader.ts';
import { detectFormat } from '../archive/detect.ts';
import { openArchive } from '../archive/open.ts';
import { currentBudget } from '../core/memoryBudget.ts';
import type { PdfBook } from '../archive/pdf/pdfBook.ts';
import { probeImage, sniffImage } from '../archive/imageFormats.ts';
import { contentBox, isNegligibleCrop, FULL_PAGE, type Rect } from '../core/trim.ts';
import { analyzePanels } from '../core/panels.ts';
import { clampDecodeSize } from '../core/tiling.ts';
import { pdfEntryIndex } from '../archive/pdf/entryName.ts';
import { cropScaled, decodeScaled, getCaps } from './imaging.ts';
import { serve, transferred } from './rpc.ts';
import { prepareImageBlob, setForceWasmImages } from './wasmImages.ts';

declare const self: DedicatedWorkerGlobalScope;

const readers = new Map<string, ArchiveReader>();
const pdfs = new Map<string, PdfBook>();

/** Full-size decodes kept for tile requests of the same page (bounded). */
interface FullEntry {
  key: string;
  bitmap: ImageBitmap;
  /** decoded-size / source-size (1 unless the source was too big to decode whole) */
  factor: number;
  srcW: number;
  srcH: number;
}
const MAX_FULL_PIXELS = 64_000_000;
/** Retry size when the browser refuses a full decode (iOS caps canvases/bitmaps near 16.7 MP). */
const FALLBACK_FULL_PIXELS = 16_000_000;
/** Kept full decodes: at most half the device's page-cache budget (100 MB on iPhone), max 300 MB. */
const MAX_FULL_BYTES = Math.min(300 * 1024 * 1024, currentBudget().cacheBytes / 2);
const fulls: FullEntry[] = [];

function trimFulls(): void {
  let total = fulls.reduce((a, f) => a + f.bitmap.width * f.bitmap.height * 4, 0);
  while (fulls.length > 1 && (fulls.length > 2 || total > MAX_FULL_BYTES)) {
    const f = fulls.shift()!;
    total -= f.bitmap.width * f.bitmap.height * 4;
    f.bitmap.close();
  }
}

class DecodeError extends Error {
  code = 'decode';
}

async function entryBlob(
  bookId: string,
  entry: string,
): Promise<{ blob: Blob; w: number; h: number }> {
  const r = readers.get(bookId);
  if (!r) throw new DecodeError('book not open');
  const bytes = await r.readEntry(entry);
  const kind = sniffImage(bytes);
  const probe = probeImage(bytes);
  if (!kind || !probe) throw new DecodeError('unrecognised image');
  try {
    return { blob: await prepareImageBlob(bytes, kind), w: probe.w, h: probe.h };
  } catch {
    throw new DecodeError('cannot decode image');
  }
}

async function loadFull(bookId: string, entry: string): Promise<FullEntry> {
  const key = `${bookId}\u0000${entry}`;
  const hit = fulls.find((f) => f.key === key);
  if (hit) return hit;
  const { blob, w, h } = await entryBlob(bookId, entry);
  let bitmap: ImageBitmap;
  let factor = 1;
  const scaled = async (maxPixels: number) => {
    const k = Math.sqrt(maxPixels / (w * h));
    const bmp = await decodeScaled(blob, Math.floor(w * k), Math.floor(h * k));
    factor = bmp.width / w;
    return bmp;
  };
  try {
    if (w * h <= MAX_FULL_PIXELS) bitmap = await createImageBitmap(blob);
    else bitmap = await scaled(MAX_FULL_PIXELS);
  } catch {
    // a very large page can exceed the browser's bitmap limit (iOS Safari): retry smaller
    if (w * h <= FALLBACK_FULL_PIXELS) throw new DecodeError('cannot decode image');
    try {
      bitmap = await scaled(FALLBACK_FULL_PIXELS);
    } catch {
      throw new DecodeError('cannot decode image');
    }
  }
  const f: FullEntry = { key, bitmap, factor, srcW: w, srcH: h };
  fulls.push(f);
  trimFulls();
  return f;
}

serve(self, {
  async open({
    bookId,
    file,
    opfsPath,
    forceWasmImages,
  }: {
    bookId: string;
    file?: File;
    opfsPath?: string[];
    forceWasmImages?: boolean;
  }) {
    setForceWasmImages(forceWasmImages === true);
    if (readers.has(bookId) || pdfs.has(bookId)) return { caps: await getCaps() };
    let f = file;
    if (!f) {
      let d = await navigator.storage.getDirectory();
      const path = opfsPath ?? [];
      for (const p of path.slice(0, -1)) d = await d.getDirectoryHandle(p);
      f = await (await d.getFileHandle(path[path.length - 1]!)).getFile();
    }
    if (detectFormat(new Uint8Array(await f.slice(0, 16).arrayBuffer())) === 'pdf') {
      const { PdfBook } = await import('../archive/pdf/pdfBook.ts');
      pdfs.set(bookId, await PdfBook.open(f, currentBudget().wholeArchiveLimit));
    } else {
      readers.set(bookId, (await openArchive(f)).reader);
    }
    return { caps: await getCaps() };
  },

  close({ bookId }: { bookId: string }) {
    readers.get(bookId)?.close();
    readers.delete(bookId);
    pdfs.get(bookId)?.close();
    pdfs.delete(bookId);
    for (let i = fulls.length - 1; i >= 0; i--) {
      if (fulls[i]!.key.startsWith(bookId + '\u0000')) fulls.splice(i, 1)[0]!.bitmap.close();
    }
  },

  /** Layout analysis on a 512 px wide luminance copy: margin box and (unordered) panel rectangles. */
  async analyzePage({ bookId, entry }: { bookId: string; entry: string }) {
    const caps = await getCaps();
    if (!caps.offscreen2d) return { trim: FULL_PAGE, panels: [FULL_PAGE], spread: false };
    const ANALYSIS_W = 512;
    let bmp: ImageBitmap;
    const pdf = pdfs.get(bookId);
    try {
      if (pdf) bmp = await pdf.renderFit(pdfEntryIndex(entry), ANALYSIS_W);
      else {
        const { blob, w, h } = await entryBlob(bookId, entry);
        bmp = await decodeScaled(blob, ANALYSIS_W, Math.max(1, Math.round((ANALYSIS_W * h) / w)));
      }
    } catch {
      throw new DecodeError('cannot analyse page');
    }
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0);
    const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
    const lum = new Uint8Array(c.width * c.height);
    for (let i = 0; i < lum.length; i++) {
      lum[i] = (rgba[i * 4]! * 299 + rgba[i * 4 + 1]! * 587 + rgba[i * 4 + 2]! * 114) / 1000;
    }
    const buf = { data: lum, w: c.width, h: c.height };
    bmp.close();
    let trim: Rect = contentBox(buf);
    if (isNegligibleCrop(trim)) trim = FULL_PAGE;
    const pa = analyzePanels(buf);
    return { trim, panels: pa.panels, spread: pa.spread };
  },

  /** Whole page scaled to fit within wantW x wantH (clamped to the canvas cap, never upscaled). */
  async decodePage({
    bookId,
    entry,
    wantW,
    wantH,
  }: {
    bookId: string;
    entry: string;
    wantW: number;
    wantH: number;
  }) {
    const pdf = pdfs.get(bookId);
    if (pdf) {
      const i = pdfEntryIndex(entry);
      const d = await pdf.dims(i);
      const t = clampDecodeSize(d, { w: wantW, h: wantH });
      let bitmap: ImageBitmap;
      try {
        bitmap = await pdf.renderFit(i, t.w);
      } catch {
        throw new DecodeError('cannot render PDF page');
      }
      return transferred({ bitmap, srcW: d.w, srcH: d.h }, [bitmap]);
    }
    const { blob, w, h } = await entryBlob(bookId, entry);
    const t = clampDecodeSize({ w, h }, { w: wantW, h: wantH });
    let bitmap: ImageBitmap;
    try {
      bitmap = await decodeScaled(blob, t.w, t.h);
    } catch {
      throw new DecodeError('cannot decode image');
    }
    return transferred({ bitmap, srcW: w, srcH: h }, [bitmap]);
  },

  /**
   * One tile: source rectangle (sx, sy, sw, sh) in source pixels resampled by `scale`.
   * Output is at most 2048 px per side when requested by the renderer.
   */
  async decodeTile({
    bookId,
    entry,
    sx,
    sy,
    sw,
    sh,
    scale,
  }: {
    bookId: string;
    entry: string;
    sx: number;
    sy: number;
    sw: number;
    sh: number;
    scale: number;
  }) {
    const pdf = pdfs.get(bookId);
    if (pdf) {
      const i = pdfEntryIndex(entry);
      const d = await pdf.dims(i);
      let bitmap: ImageBitmap;
      try {
        bitmap = await pdf.renderRegion(i, sx, sy, sw, sh, scale);
      } catch {
        throw new DecodeError('cannot render PDF page');
      }
      return transferred({ bitmap, srcW: d.w, srcH: d.h }, [bitmap]);
    }
    const full = await loadFull(bookId, entry);
    const f = full.factor;
    const dx = Math.max(0, Math.round(sx * f));
    const dy = Math.max(0, Math.round(sy * f));
    const dw = Math.max(1, Math.min(full.bitmap.width - dx, Math.round(sw * f)));
    const dh = Math.max(1, Math.min(full.bitmap.height - dy, Math.round(sh * f)));
    const outW = Math.max(1, Math.round(sw * scale));
    const outH = Math.max(1, Math.round(sh * scale));
    const bitmap = await cropScaled(full.bitmap, dx, dy, dw, dh, outW, outH);
    return transferred({ bitmap, srcW: full.srcW, srcH: full.srcH }, [bitmap]);
  },
});
