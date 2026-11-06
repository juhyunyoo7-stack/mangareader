/// <reference lib="webworker" />
import { analyzeArchive, type Analysis } from '../archive/analyze.ts';
import { detectFormat } from '../archive/detect.ts';
import { openArchive } from '../archive/open.ts';
import { currentBudget } from '../core/memoryBudget.ts';
import { probeImage, sniffImage } from '../archive/imageFormats.ts';
import { decodeScaled, getCaps } from './imaging.ts';
import { serve } from './rpc.ts';
import { prepareImageBlob } from './wasmImages.ts';
import { writeCbz } from '../data/imageBundle.ts';

declare const self: DedicatedWorkerGlobalScope;

const cancelled = new Set<string>();

class ImportCancelled extends Error {
  code = 'cancelled';
  constructor() {
    super('Import cancelled');
  }
}

async function root(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

async function writeAll(fh: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const ah = await fh.createSyncAccessHandle();
  try {
    ah.truncate(0);
    ah.write(bytes, { at: 0 });
    ah.flush();
  } finally {
    ah.close();
  }
}

async function removeIncoming(tmpId: string): Promise<void> {
  try {
    const inc = await (await root()).getDirectoryHandle('incoming');
    await inc.removeEntry(tmpId);
  } catch {
    /* nothing to remove */
  }
}

async function copyToIncoming(
  tmpId: string,
  file: File,
  emit: (e: string, d: unknown) => void,
): Promise<FileSystemFileHandle> {
  const inc = await (await root()).getDirectoryHandle('incoming', { create: true });
  const fh = await inc.getFileHandle(tmpId, { create: true });
  const ah = await fh.createSyncAccessHandle();
  let at = 0;
  let last = 0;
  try {
    ah.truncate(0);
    const reader = file.stream().getReader();
    for (;;) {
      if (cancelled.has(tmpId)) {
        await reader.cancel();
        throw new ImportCancelled();
      }
      const { done, value } = await reader.read();
      if (done) break;
      ah.write(value, { at });
      at += value.byteLength;
      const now = performance.now();
      if (now - last > 120) {
        last = now;
        emit('progress', { tmpId, bytes: at, total: file.size });
      }
    }
    ah.flush();
  } catch (e) {
    ah.close();
    await removeIncoming(tmpId);
    throw e;
  }
  ah.close();
  emit('progress', { tmpId, bytes: at, total: file.size });
  return fh;
}

/** Bundle loose page images (in reading order) into incoming/<tmpId> as a stored CBZ, streamed. */
async function bundleToIncoming(
  tmpId: string,
  images: File[],
  emit: (e: string, d: unknown) => void,
): Promise<FileSystemFileHandle> {
  const inc = await (await root()).getDirectoryHandle('incoming', { create: true });
  const fh = await inc.getFileHandle(tmpId, { create: true });
  const ah = await fh.createSyncAccessHandle();
  const total = images.reduce((n, f) => n + f.size, 0);
  let at = 0;
  let last = 0;
  try {
    ah.truncate(0);
    await writeCbz(images, (chunk) => {
      if (cancelled.has(tmpId)) throw new ImportCancelled();
      ah.write(chunk, { at });
      at += chunk.byteLength;
      const now = performance.now();
      if (now - last > 120) {
        last = now;
        emit('progress', { tmpId, bytes: Math.min(at, total), total });
      }
    });
    ah.flush();
  } catch (e) {
    ah.close();
    await removeIncoming(tmpId);
    throw e;
  }
  ah.close();
  emit('progress', { tmpId, bytes: total, total });
  return fh;
}

async function openSource(src: { file?: File; opfsPath?: string[] }): Promise<File> {
  if (src.file) return src.file;
  let d = await root();
  const path = src.opfsPath ?? [];
  for (const p of path.slice(0, -1)) d = await d.getDirectoryHandle(p);
  return (await d.getFileHandle(path[path.length - 1]!)).getFile();
}

async function writeCover(bookId: string, blob: Blob): Promise<boolean> {
  const thumbs = await (await root()).getDirectoryHandle('thumbs', { create: true });
  const bookDir = await thumbs.getDirectoryHandle(bookId, { create: true });
  const fh = await bookDir.getFileHandle('cover.webp', { create: true });
  await writeAll(fh, new Uint8Array(await blob.arrayBuffer()));
  return true;
}

async function makeCover(args: {
  bookId: string;
  file?: File;
  opfsPath?: string[];
  entry: string;
}): Promise<boolean> {
  const caps = await getCaps();
  if (!caps.offscreen2d) return false;
  const src = await openSource(args);
  if (detectFormat(new Uint8Array(await src.slice(0, 16).arrayBuffer())) === 'pdf') {
    const { PdfBook } = await import('../archive/pdf/pdfBook.ts');
    const pdf = await PdfBook.open(src, currentBudget().wholeArchiveLimit);
    try {
      const d = await pdf.dims(0);
      const bmp = await pdf.renderFit(0, Math.min(300, d.w));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      bmp.close();
      return await writeCover(
        args.bookId,
        await c.convertToBlob({ type: 'image/webp', quality: 0.82 }),
      );
    } finally {
      pdf.close();
    }
  }
  const { reader } = await openArchive(src);
  try {
    const bytes = await reader.readEntry(args.entry);
    const kind = sniffImage(bytes);
    const probe = probeImage(bytes);
    if (!kind || !probe) return false;
    const w = Math.min(300, probe.w);
    const h = Math.max(1, Math.round((w * probe.h) / probe.w));
    const bmp = await decodeScaled(await prepareImageBlob(bytes, kind), w, h);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    return await writeCover(
      args.bookId,
      await c.convertToBlob({ type: 'image/webp', quality: 0.82 }),
    );
  } finally {
    reader.close();
  }
}

type FileHandleWithMove = FileSystemFileHandle & {
  move?: (dir: FileSystemDirectoryHandle, name: string) => Promise<void>;
};

serve(self, {
  /** Copy `file` (or bundle the loose `images`) into incoming/<tmpId> and analyse it. */
  async importFile(
    { tmpId, file, images }: { tmpId: string; file?: File; images?: File[] },
    ctx,
  ): Promise<{ analysis: Analysis; size: number }> {
    cancelled.delete(tmpId);
    const fh = images
      ? await bundleToIncoming(tmpId, images, ctx.emit)
      : await copyToIncoming(tmpId, file!, ctx.emit);
    try {
      const f = await fh.getFile();
      const analysis = await analyzeArchive(f);
      return { analysis, size: f.size };
    } catch (e) {
      await removeIncoming(tmpId);
      throw e;
    } finally {
      cancelled.delete(tmpId);
    }
  },

  async analyzeFile({ file }: { file: File }): Promise<{ analysis: Analysis; size: number }> {
    return { analysis: await analyzeArchive(file), size: file.size };
  },

  cancel({ tmpId }: { tmpId: string }): void {
    cancelled.add(tmpId);
  },

  async discard({ tmpId }: { tmpId: string }): Promise<void> {
    await removeIncoming(tmpId);
  },

  /** Atomically publish incoming/<tmpId> as books/<bookId>/<name>. */
  async commit({
    tmpId,
    bookId,
    name,
  }: {
    tmpId: string;
    bookId: string;
    name: string;
  }): Promise<void> {
    const r = await root();
    const inc = await r.getDirectoryHandle('incoming');
    const fh = (await inc.getFileHandle(tmpId)) as FileHandleWithMove;
    const books = await r.getDirectoryHandle('books', { create: true });
    const dest = await books.getDirectoryHandle(bookId, { create: true });
    if (typeof fh.move === 'function') {
      await fh.move(dest, name);
      return;
    }
    // fallback: copy then delete
    const src = await fh.getFile();
    const out = await (await dest.getFileHandle(name, { create: true })).createSyncAccessHandle();
    try {
      out.truncate(0);
      const rd = src.stream().getReader();
      let at = 0;
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        out.write(value, { at });
        at += value.byteLength;
      }
      out.flush();
    } finally {
      out.close();
    }
    await inc.removeEntry(tmpId);
  },

  makeCover,

  async cleanupIncoming(): Promise<number> {
    let n = 0;
    try {
      const inc = await (await root()).getDirectoryHandle('incoming');
      for await (const k of inc.keys()) {
        await inc.removeEntry(k as string);
        n++;
      }
    } catch {
      /* no incoming dir */
    }
    return n;
  },
});
