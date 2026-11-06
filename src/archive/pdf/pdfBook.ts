import {
  getDocument,
  PDFDataRangeTransport,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
// The legacy build: the modern one calls Map#getOrInsertComputed, Math.sumPrecise and Promise.try
// directly (MDN: getOrInsertComputed is "Baseline 2026"), which iPadOS 17/18 Safari and older Android
// Chrome do not have, so PDFs would fail to open there (Node 22 fails the same way: no Promise.try).
// The legacy build ships polyfills for them.
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { ArchiveError } from '../errors.ts';

/**
 * PDF pages rendered on demand with pdf.js (DESIGN 6). Runs inside our own worker: pdf.js' parser is
 * run in the same thread ("fake worker") so no nested worker or extra asset URL is needed, and
 * rendering uses OffscreenCanvas through a custom canvas factory (pdf.js' default needs `document`).
 */
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = { WorkerMessageHandler };

/** Source pixels per PDF point: pages are treated as 144 dpi rasters for dimensions and tiling. */
export const PDF_SRC_SCALE = 2;
const MAX_SRC_SIDE = 30000;

class OffscreenCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: false }) };
  }
  reset(c: { canvas: OffscreenCanvas }, width: number, height: number) {
    c.canvas.width = width;
    c.canvas.height = height;
  }
  destroy(c: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (c.canvas) {
      c.canvas.width = 0;
      c.canvas.height = 0;
    }
    c.canvas = null;
    c.context = null;
  }
}

/** Bytes per range read: pdf.js asks for the parts of the file it needs instead of the whole file. */
const RANGE_CHUNK = 1 << 20;

/**
 * Serves pdf.js range requests from slices of the Blob (an OPFS file or picked File), so opening a
 * large PDF does not read the whole file into one ArrayBuffer (DESIGN 6; matters on iPad/phones).
 */
class BlobRangeTransport extends PDFDataRangeTransport {
  constructor(
    private readonly blob: Blob,
    initial: Uint8Array,
  ) {
    super(blob.size, initial);
  }
  override requestDataRange(begin: number, end: number): void {
    void this.blob
      .slice(begin, end)
      .arrayBuffer()
      .then(
        (b) => this.onDataRange(begin, new Uint8Array(b)),
        () => this.abort(),
      );
  }
}

export interface PdfPageDims {
  w: number;
  h: number;
}

export class PdfBook {
  private constructor(
    private task: PDFDocumentLoadingTask,
    private doc: PDFDocumentProxy,
    readonly pageCount: number,
  ) {}

  static async open(file: Blob, maxBytes: number): Promise<PdfBook> {
    if (file.size > maxBytes) throw new ArchiveError('too-large');
    const initial = new Uint8Array(
      await file.slice(0, Math.min(file.size, RANGE_CHUNK)).arrayBuffer(),
    );
    try {
      const task = getDocument({
        range: new BlobRangeTransport(file, initial),
        rangeChunkSize: RANGE_CHUNK,
        disableAutoFetch: true, // only fetch the ranges the visited pages need
        disableStream: true,
        CanvasFactory: OffscreenCanvasFactory,
        disableFontFace: true,
        useSystemFonts: false,
      });
      const doc = await task.promise;
      if (doc.numPages < 1) throw new ArchiveError('no-images');
      return new PdfBook(task, doc, doc.numPages);
    } catch (e) {
      if (e instanceof ArchiveError) throw e;
      const name = (e as { name?: string }).name;
      if (name === 'PasswordException') throw new ArchiveError('encrypted');
      throw new ArchiveError('bad-entry');
    }
  }

  /** Page size in source pixels (PDF_SRC_SCALE x points, rotation applied). */
  async dims(index: number): Promise<PdfPageDims> {
    const page = await this.doc.getPage(index + 1);
    const v = page.getViewport({ scale: PDF_SRC_SCALE });
    page.cleanup();
    const k = Math.min(1, MAX_SRC_SIDE / Math.max(v.width, v.height));
    return { w: Math.max(1, Math.round(v.width * k)), h: Math.max(1, Math.round(v.height * k)) };
  }

  /**
   * Render the source rectangle (sx, sy, sw, sh in source pixels) at `scale` output px per source px.
   * Output is round(sw*scale) x round(sh*scale).
   */
  async renderRegion(
    index: number,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    scale: number,
  ): Promise<ImageBitmap> {
    const page = await this.doc.getPage(index + 1);
    try {
      const outW = Math.max(1, Math.round(sw * scale));
      const outH = Math.max(1, Math.round(sh * scale));
      const canvas = new OffscreenCanvas(outW, outH);
      const ctx = canvas.getContext('2d')!;
      const viewport = page.getViewport({ scale: PDF_SRC_SCALE * scale });
      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        canvas: null,
        viewport,
        transform: [1, 0, 0, 1, -sx * scale, -sy * scale],
        background: 'white',
      }).promise;
      return canvas.transferToImageBitmap();
    } finally {
      page.cleanup();
    }
  }

  /** Whole page scaled to a width of outW px (aspect kept). */
  async renderFit(index: number, outW: number): Promise<ImageBitmap> {
    const d = await this.dims(index);
    return this.renderRegion(index, 0, 0, d.w, d.h, outW / d.w);
  }

  close(): void {
    void this.task.destroy();
  }
}
