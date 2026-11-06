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

/**
 * Stream the images (already in reading order) as a stored CBZ: `sink` receives the archive bytes in
 * order, at most about one 1 MB slice at a time, so the whole archive is never held in memory (the
 * import worker writes the chunks straight into OPFS). Entry names keep the order.
 */
export async function writeCbz(files: File[], sink: (chunk: Uint8Array) => void): Promise<void> {
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else sink(chunk);
  });
  const width = Math.max(4, String(files.length).length);
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const ext = /\.[A-Za-z0-9]{2,5}$/.exec(f.name)?.[0].toLowerCase() ?? '.jpg';
    const entry = new ZipPassThrough(`${String(i + 1).padStart(width, '0')}${ext}`);
    entry.mtime = FIXED_MTIME;
    zip.add(entry);
    for (let o = 0; o < f.size || o === 0; o += CHUNK) {
      const buf = new Uint8Array(await f.slice(o, o + CHUNK).arrayBuffer());
      entry.push(buf, o + CHUNK >= f.size);
      if (failure) throw failure;
    }
  }
  zip.end();
  if (failure) throw failure;
}

/** Newest modification time of the group's files (the bundled book's mtime). */
export function newestMtime(files: File[]): number {
  return files.reduce((m, f) => Math.max(m, f.lastModified), 0) || Date.now();
}

/** The group as an in-memory CBZ File (tests and small selections; the importer streams instead). */
export async function bundleToCbz(group: ImageGroup): Promise<File> {
  const parts: Uint8Array[] = [];
  await writeCbz(group.files, (c) => parts.push(c));
  return new File(parts as BlobPart[], `${group.name}.cbz`, {
    type: 'application/vnd.comicbook+zip',
    lastModified: newestMtime(group.files),
  });
}

/** Split a picked list into image groups (one book each) and everything else (archives etc.). */
export async function splitImages(
  files: File[],
  fallbackName: string,
): Promise<{ groups: ImageGroup[]; rest: File[] }> {
  const flags = await Promise.all(files.map(isImageFile));
  const images = files.filter((_, i) => flags[i]);
  const rest = files.filter((_, i) => !flags[i]);
  return { groups: images.length ? groupImages(images, fallbackName) : [], rest };
}

/**
 * Replace loose images in a file list by one CBZ per group; everything else passes through.
 * `fallbackName` names a group when neither a folder nor a common file-name prefix exists.
 */
export async function bundleLooseImages(files: File[], fallbackName: string): Promise<File[]> {
  const { groups, rest } = await splitImages(files, fallbackName);
  if (groups.length === 0) return files;
  const bundles: File[] = [];
  for (const g of groups) bundles.push(await bundleToCbz(g));
  return [...bundles, ...rest];
}
