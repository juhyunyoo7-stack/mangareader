import { Inflate, inflateSync } from 'fflate';
import { crc32 } from '../../core/crc32.ts';
import { type ArchiveReader, type EntryInfo, isUnsafeOrJunkName } from '../ArchiveReader.ts';
import { ArchiveError } from '../errors.ts';
import {
  checkEntryLimits,
  DEFAULT_LIMITS,
  readZipDirectory,
  type SliceSource,
  type ZipEntry,
  type ZipLimits,
} from './zipDirectory.ts';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|jxl|bmp)$/i;

export class ZipReader implements ArchiveReader {
  private byName = new Map<string, ZipEntry>();
  private constructor(
    private readonly src: SliceSource,
    private readonly limits: ZipLimits,
    entries: ZipEntry[],
  ) {
    for (const e of entries) if (!e.isDirectory) this.byName.set(e.name, e);
  }

  static async open(src: SliceSource, limits: ZipLimits = DEFAULT_LIMITS): Promise<ZipReader> {
    const entries = await readZipDirectory(src, limits);
    // fail early on encrypted image entries; other limit checks happen per entry on read
    for (const e of entries) {
      if (e.encrypted && IMAGE_EXT.test(e.name) && !isUnsafeOrJunkName(e.name)) {
        throw new ArchiveError('encrypted');
      }
    }
    return new ZipReader(src, limits, entries);
  }

  async listEntries(): Promise<EntryInfo[]> {
    return [...this.byName.values()].map((e) => ({
      name: e.name,
      size: e.size,
      compressedSize: e.compressedSize,
      method: e.method,
    }));
  }

  private entry(name: string): ZipEntry {
    const e = this.byName.get(name);
    if (!e) throw new ArchiveError('bad-entry', `No such entry`);
    return e;
  }

  private async dataStart(e: ZipEntry): Promise<number> {
    const h = new Uint8Array(await this.src.slice(e.localOffset, e.localOffset + 30).arrayBuffer());
    const dv = new DataView(h.buffer);
    if (h.length < 30 || dv.getUint32(0, true) !== 0x04034b50) throw new ArchiveError('truncated');
    return e.localOffset + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  }

  async readEntry(name: string): Promise<Uint8Array> {
    const e = this.entry(name);
    checkEntryLimits(e, this.limits);
    const start = await this.dataStart(e);
    if (start + e.compressedSize > this.src.size) throw new ArchiveError('truncated');
    const comp = new Uint8Array(
      await this.src.slice(start, start + e.compressedSize).arrayBuffer(),
    );
    let out: Uint8Array;
    if (e.method === 0) out = comp;
    else if (e.method === 8) {
      try {
        out = inflateSync(comp, { out: new Uint8Array(e.size) });
      } catch {
        throw new ArchiveError('bad-entry');
      }
    } else throw new ArchiveError('unsupported-method');
    if (out.length !== e.size || crc32(out) !== e.crc) throw new ArchiveError('bad-entry');
    return out;
  }

  async readPrefix(name: string, maxBytes: number): Promise<Uint8Array> {
    const e = this.entry(name);
    checkEntryLimits(e, this.limits);
    const start = await this.dataStart(e);
    if (e.method === 0) {
      const n = Math.min(maxBytes, e.compressedSize);
      return new Uint8Array(await this.src.slice(start, start + n).arrayBuffer());
    }
    if (e.method !== 8) throw new ArchiveError('unsupported-method');
    const chunks: Uint8Array[] = [];
    let got = 0;
    const inf = new Inflate((chunk) => {
      if (got < maxBytes) {
        chunks.push(chunk);
        got += chunk.length;
      }
    });
    const step = 64 * 1024;
    try {
      for (let p = 0; p < e.compressedSize && got < maxBytes; p += step) {
        const end = Math.min(e.compressedSize, p + step);
        const piece = new Uint8Array(await this.src.slice(start + p, start + end).arrayBuffer());
        inf.push(piece, end === e.compressedSize);
      }
    } catch {
      throw new ArchiveError('bad-entry');
    }
    const out = new Uint8Array(Math.min(got, maxBytes));
    let o = 0;
    for (const c of chunks) {
      const take = Math.min(c.length, out.length - o);
      if (take <= 0) break;
      out.set(c.subarray(0, take), o);
      o += take;
    }
    return out;
  }

  close(): void {
    this.byName.clear();
  }
}
