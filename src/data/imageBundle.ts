import { Zip, ZipPassThrough } from 'fflate';
import { naturalCompare } from '../archive/ArchiveReader.ts';
import { sniffImage } from '../archive/imageFormats.ts';
import { stripExtension } from '../core/naming.ts';

/**
 * Loose page images (selected in the file picker, a picked folder or dropped) become one book each:
 * the images are streamed into a stored (uncompressed) CBZ that then goes through the normal import.
 */
export interface ImageGroup {
  /** book name without extension */
  name: string;
  files: File[];
}

export async function isImageFile(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return sniffImage(head) !== null;
}

function folderOf(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
  const parts = rel.split('/').filter(Boolean);
  return parts.slice(0, -1).join('/');
}

/** Longest common prefix of the file names, without trailing digits/separators ("page_" from page_001..). */
export function commonPrefixName(names: string[]): string {
  if (names.length === 0) return '';
  const base = names.map((n) => stripExtension(n));
  let p = base[0]!;
  for (const b of base) {
    let i = 0;
    while (i < p.length && i < b.length && p[i] === b[i]) i++;
    p = p.slice(0, i);
  }
  return p.replace(/[\s_\-.([{]*\d*[\s_\-.)\]}]*$/, '').trim();
}

/** Group image files into books: one per picked folder; loose files together as one book. */
export function groupImages(files: File[], fallbackName: string): ImageGroup[] {
  const byFolder = new Map<string, File[]>();
  for (const f of files) {
    const k = folderOf(f);
    const list = byFolder.get(k);
    if (list) list.push(f);
    else byFolder.set(k, [f]);
  }
  const out: ImageGroup[] = [];
  for (const [folder, list] of byFolder) {
    const sorted = [...list].sort((a, b) => naturalCompare(a.name, b.name));
    const fromFolder = folder.split('/').pop() ?? '';
    const prefix = commonPrefixName(sorted.map((f) => f.name));
    const name = (fromFolder || (prefix.length >= 1 ? prefix : fallbackName)).trim();
    out.push({ name: name.replace(/[\\/:*?"<>|]+/g, '_'), files: sorted });
  }
  return out;
}

const CHUNK = 1 << 20;
/** Fixed entry time (1980-01-01): the same images must always produce the same bytes, so a re-import is seen as a duplicate. */
const FIXED_MTIME = Date.UTC(1980, 0, 1);

/** Stream the images (already in reading order) into a stored CBZ. Entry names keep the order. */
export async function bundleToCbz(group: ImageGroup): Promise<File> {
  const parts: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else parts.push(chunk);
  });
  const width = Math.max(4, String(group.files.length).length);
  let newest = 0;
  for (let i = 0; i < group.files.length; i++) {
    const f = group.files[i]!;
    newest = Math.max(newest, f.lastModified);
    const ext = /\.[A-Za-z0-9]{2,5}$/.exec(f.name)?.[0].toLowerCase() ?? '.jpg';
    const entry = new ZipPassThrough(`${String(i + 1).padStart(width, '0')}${ext}`);
    entry.mtime = FIXED_MTIME;
    zip.add(entry);
    for (let o = 0; o < f.size || o === 0; o += CHUNK) {
      const buf = new Uint8Array(await f.slice(o, o + CHUNK).arrayBuffer());
      entry.push(buf, o + CHUNK >= f.size);
    }
  }
  zip.end();
  if (failure) throw failure;
  return new File(parts as BlobPart[], `${group.name}.cbz`, {
    type: 'application/vnd.comicbook+zip',
    lastModified: newest || Date.now(),
  });
}

/**
 * Replace loose images in a file list by one CBZ per group; everything else passes through.
 * `fallbackName` names a group when neither a folder nor a common file-name prefix exists.
 */
export async function bundleLooseImages(files: File[], fallbackName: string): Promise<File[]> {
  const flags = await Promise.all(files.map(isImageFile));
  const images = files.filter((_, i) => flags[i]);
  if (images.length === 0) return files;
  const rest = files.filter((_, i) => !flags[i]);
  const bundles: File[] = [];
  for (const g of groupImages(images, fallbackName)) bundles.push(await bundleToCbz(g));
  return [...bundles, ...rest];
}
