import { getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
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
    const data = new Uint8Array(await file.arrayBuffer());
    try {
      const task = getDocument({
        data,
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
