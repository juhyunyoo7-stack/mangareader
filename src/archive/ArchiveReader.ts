export interface EntryInfo {
  name: string;
  size: number;
  compressedSize: number;
  method: number;
}

export interface ArchiveReader {
  listEntries(): Promise<EntryInfo[]>;
  readEntry(name: string): Promise<Uint8Array>;
  /** First `maxBytes` of the decompressed entry (for header probes); may return fewer. */
  readPrefix(name: string, maxBytes: number): Promise<Uint8Array>;
  close(): void;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|jxl|bmp)$/i;
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** True for names that must never be treated as content (traversal, junk, hidden). */
export function isUnsafeOrJunkName(name: string): boolean {
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return true;
  const segs = n.split('/').filter((s) => s !== '');
  if (segs.some((s) => s === '..' || s === '.')) return true;
  if (segs.some((s) => s.startsWith('.') || s === '__MACOSX')) return true;
  const last = segs[segs.length - 1] ?? '';
  if (/^(thumbs\.db|desktop\.ini)$/i.test(last)) return true;
  return false;
}

/** Image entry names in reading order (natural sort of full path), junk and unsafe names dropped. */
export function pageEntryNames(entries: EntryInfo[]): string[] {
  return entries
    .filter((e) => !e.name.endsWith('/') && IMAGE_EXT.test(e.name) && !isUnsafeOrJunkName(e.name))
    .map((e) => e.name)
    .sort(naturalCompare);
}

export function findComicInfoName(entries: EntryInfo[]): string | undefined {
  const c = entries
    .filter((e) => /(^|\/)comicinfo\.xml$/i.test(e.name) && !isUnsafeOrJunkName(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.split('/').length - b.split('/').length);
  return c[0];
}
