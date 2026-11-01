import { ArchiveReader } from 'libarchive-wasm';
import type { ArchiveReader as ArchiveReaderIface, EntryInfo } from '../ArchiveReader.ts';
import { isUnsafeOrJunkName } from '../ArchiveReader.ts';
import { ArchiveError } from '../errors.ts';
import type { LibarchiveLoader } from './wasmLoader.ts';

const WANTED = /\.(jpe?g|png|gif|webp|avif|jxl|bmp)$|(^|\/)comicinfo\.xml$/i;

/** readData() already returns a copy of the WASM heap range; reinterpret it as bytes. */
function asBytes(d: Int8Array): Uint8Array {
  return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
}

/**
 * RAR (v4/v5, solid) and 7z via libarchive compiled to WASM.
 * These formats need the whole archive in memory and solid archives can only be decoded in order,
 * so open() decodes every image entry once and serves reads from memory (DESIGN 6; OPFS extraction
 * is not implemented, `maxBytes` bounds what is held).
 */
export class LibarchiveReader implements ArchiveReaderIface {
  private constructor(private entries: Map<string, Uint8Array>) {}

  static async open(
    file: Blob,
    load: LibarchiveLoader,
    opts: { maxBytes: number },
  ): Promise<LibarchiveReader> {
    if (file.size > opts.maxBytes) throw new ArchiveError('too-large');
    let mod;
    try {
      mod = await load();
    } catch {
      throw new ArchiveError('unsupported-format');
    }
    const data = new Int8Array(await file.arrayBuffer());
    let reader;
    try {
      reader = new ArchiveReader(mod, data);
    } catch {
      throw new ArchiveError('bad-entry');
    }
    const out = new Map<string, Uint8Array>();
    let total = 0;
    let seen = 0;
    try {
      if (reader.hasEncryptedData()) throw new ArchiveError('encrypted');
      for (const entry of reader.entries()) {
        seen++;
        const name = entry.getPathname().replaceAll('\\', '/');
        if (entry.getFiletype() !== 'File' || isUnsafeOrJunkName(name) || !WANTED.test(name)) {
          entry.skipData();
          continue;
        }
        if (entry.isEncrypted()) throw new ArchiveError('encrypted');
        const d = entry.readData();
        if (!d) throw new ArchiveError('bad-entry');
        total += d.byteLength;
        if (total > opts.maxBytes) throw new ArchiveError('too-large');
        out.set(name, asBytes(d));
      }
      // libarchive reports unreadable/encrypted headers as an empty archive
      if (seen === 0) throw new ArchiveError('truncated');
    } catch (e) {
      if (e instanceof ArchiveError) throw e;
      throw new ArchiveError('bad-entry');
    } finally {
      reader.free();
    }
    return new LibarchiveReader(out);
  }

  async listEntries(): Promise<EntryInfo[]> {
    return [...this.entries].map(([name, b]) => ({
      name,
      size: b.length,
      compressedSize: b.length,
      method: 0,
    }));
  }

  async readEntry(name: string): Promise<Uint8Array> {
    const b = this.entries.get(name);
    if (!b) throw new ArchiveError('bad-entry');
    return b;
  }

  async readPrefix(name: string, maxBytes: number): Promise<Uint8Array> {
    return (await this.readEntry(name)).subarray(0, maxBytes);
  }

  close(): void {
    this.entries = new Map();
  }
}
