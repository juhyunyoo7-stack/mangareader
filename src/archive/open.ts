import type { BookFormat } from '../core/types.ts';
import { currentBudget } from '../core/memoryBudget.ts';
import type { ArchiveReader } from './ArchiveReader.ts';
import { detectFormat } from './detect.ts';
import { ArchiveError } from './errors.ts';
import { ZipReader } from './zip/zipReader.ts';

export interface OpenedArchive {
  reader: ArchiveReader;
  format: BookFormat;
}

/** Formats whose pages are listed by an ArchiveReader (zip/rar/7z). */
export const ARCHIVE_FORMATS: readonly BookFormat[] = ['zip', 'rar', '7z'];

/** Sniff the container by magic bytes and open the matching reader (RAR/7z load WASM lazily). */
export async function openArchive(file: Blob, maxBytes?: number): Promise<OpenedArchive> {
  const format = detectFormat(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (format === 'zip') return { reader: await ZipReader.open(file), format };
  if (format === 'rar' || format === '7z') {
    const limit = maxBytes ?? currentBudget().wholeArchiveLimit;
    const [{ LibarchiveReader }, { loadLibarchive }] = await Promise.all([
      import('./libarchive/libarchiveReader.ts'),
      import('./libarchive/wasmLoader.ts'),
    ]);
    return {
      reader: await LibarchiveReader.open(file, loadLibarchive, { maxBytes: limit }),
      format,
    };
  }
  throw new ArchiveError('unsupported-format');
}
