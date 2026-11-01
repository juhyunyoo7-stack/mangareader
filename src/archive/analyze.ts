import { parseComicInfo } from '../core/comicinfo.ts';
import { contentKey } from '../core/contentKey.ts';
import { currentBudget } from '../core/memoryBudget.ts';
import { isWide } from '../core/spread.ts';
import type { BookFormat, ComicInfo, PageInfo } from '../core/types.ts';
import { findComicInfoName, pageEntryNames, type ArchiveReader } from './ArchiveReader.ts';
import { ArchiveError } from './errors.ts';
import { detectFormat } from './detect.ts';
import { isEpubEntryList, resolveEpubPages } from './epub/epubPages.ts';
import { openArchive } from './open.ts';
import { pdfEntryName } from './pdf/entryName.ts';
import { probeImage } from './imageFormats.ts';
import { ZipReader } from './zip/zipReader.ts';
import { DEFAULT_LIMITS, type SliceSource, type ZipLimits } from './zip/zipDirectory.ts';

export interface Analysis {
  pages: PageInfo[];
  comicInfo?: ComicInfo;
  contentKey: string;
  format: BookFormat;
  entryNames: string[];
}

const FALLBACK_DIMS = { w: 1000, h: 1400 };

export async function probePageDims(
  reader: ArchiveReader,
  name: string,
): Promise<{ w: number; h: number } | null> {
  for (const n of [64 * 1024, 1024 * 1024]) {
    const p = probeImage(await reader.readPrefix(name, n));
    if (p) return p;
  }
  try {
    const p = probeImage(await reader.readEntry(name));
    return p;
  } catch {
    return null;
  }
}

export async function openZipSource(
  src: SliceSource,
  limits: ZipLimits = DEFAULT_LIMITS,
): Promise<ZipReader> {
  return ZipReader.open(src, limits);
}

/** Open a ZIP slice source, list, probe page dimensions, parse ComicInfo and compute the content key. */
export async function analyzeZip(
  src: SliceSource,
  limits: ZipLimits = DEFAULT_LIMITS,
  onProgress?: (done: number, total: number) => void,
): Promise<Analysis> {
  return analyzeReader(await ZipReader.open(src, limits), src, 'zip', onProgress);
}

/** Same as analyzeZip for any supported archive container (zip, rar, 7z), chosen by magic bytes. */
export async function analyzeArchive(
  file: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<Analysis> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (detectFormat(head) === 'pdf') return analyzePdf(file, onProgress);
  const { reader, format } = await openArchive(file);
  return analyzeReader(reader, file, format, onProgress);
}

async function analyzeReader(
  reader: ArchiveReader,
  src: SliceSource,
  initialFormat: BookFormat,
  onProgress?: (done: number, total: number) => void,
): Promise<Analysis> {
  let format = initialFormat;
  try {
    const entries = await reader.listEntries();
    let names = pageEntryNames(entries);
    let comicInfo: ComicInfo | undefined;
    if (format === 'zip' && isEpubEntryList(entries.map((e) => e.name))) {
      const dec = new TextDecoder();
      const epub = await resolveEpubPages(new Set(entries.map((e) => e.name)), async (n) =>
        dec.decode(await reader.readEntry(n)),
      );
      names = epub.images;
      format = 'epub';
      comicInfo = { title: epub.title, manga: epub.rtl ? 'YesAndRightToLeft' : undefined };
    }
    if (names.length === 0) throw new ArchiveError('no-images');
    const ciName = format === 'epub' ? undefined : findComicInfoName(entries);
    if (ciName) {
      try {
        comicInfo = parseComicInfo(new TextDecoder().decode(await reader.readEntry(ciName)));
      } catch {
        comicInfo = undefined;
      }
    }
    const hints = new Map((comicInfo?.pages ?? []).map((p) => [p.image, p]));
    const pages: PageInfo[] = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!;
      let dims: { w: number; h: number } | null = null;
      try {
        dims = await probePageDims(reader, name);
      } catch {
        dims = null;
      }
      const d = dims ?? FALLBACK_DIMS;
      pages.push({
        index: i,
        entry: name,
        w: d.w,
        h: d.h,
        wide: isWide(d.w, d.h) || hints.get(i)?.doublePage === true,
      });
      onProgress?.(i + 1, names.length);
    }
    const key = await contentKey(
      src,
      entries.map((e) => e.name),
    );
    return { pages, comicInfo, contentKey: key, format, entryNames: names };
  } finally {
    reader.close();
  }
}

/** PDF: one page per PDF page, dimensions from the page boxes (no ComicInfo, no entries). */
async function analyzePdf(
  file: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<Analysis> {
  const { PdfBook } = await import('./pdf/pdfBook.ts');
  const book = await PdfBook.open(file, currentBudget().wholeArchiveLimit);
  try {
    const pages: PageInfo[] = [];
    for (let i = 0; i < book.pageCount; i++) {
      const d = await book.dims(i);
      pages.push({ index: i, entry: pdfEntryName(i), w: d.w, h: d.h, wide: isWide(d.w, d.h) });
      onProgress?.(i + 1, book.pageCount);
    }
    const names = pages.map((p) => p.entry);
    return { pages, contentKey: await contentKey(file, names), format: 'pdf', entryNames: names };
  } finally {
    book.close();
  }
}
