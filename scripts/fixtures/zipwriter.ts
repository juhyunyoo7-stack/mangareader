// Small ZIP writer used only for generating test fixtures. Supports options the app must parse:
// stored/deflate, zip64 records, data descriptors, raw (non-UTF-8) names, encryption flag.
import { deflateSync } from 'fflate';
import { crc32 } from './png.ts';

export interface ZipEntryIn {
  /** name as text (encoded UTF-8 unless rawName is given) */
  name: string;
  rawName?: Uint8Array;
  data: Uint8Array;
  method?: 0 | 8;
  /** force the "encrypted" general-purpose bit */
  encrypted?: boolean;
  /** claim a different uncompressed size in directories (zip-bomb style) */
  fakeUncompressedSize?: number;
}

export interface ZipOptions {
  zip64?: boolean;
  dataDescriptor?: boolean;
  /** do not set the UTF-8 flag even for non-ASCII names */
  noUtf8Flag?: boolean;
  comment?: string;
}

const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1; // 2020-01-01, deterministic

class Buf {
  parts: Uint8Array[] = [];
  length = 0;
  push(u: Uint8Array): void {
    this.parts.push(u);
    this.length += u.length;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

function u16(n: number): Uint8Array {
  return Uint8Array.of(n & 255, (n >> 8) & 255);
}
function u32(n: number): Uint8Array {
  return Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
}
function u64(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}
function cat(...a: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of a) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

export function writeZip(entries: ZipEntryIn[], opts: ZipOptions = {}): Uint8Array {
  const out = new Buf();
  const central: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const e of entries) {
    const nameBytes = e.rawName ?? enc.encode(e.name);
    const ascii = nameBytes.every((b) => b < 128);
    const method = e.method ?? 8;
    const comp = method === 0 ? e.data : deflateSync(e.data, { level: 6 });
    const crc = crc32(e.data);
    let flags = 0;
    if (!ascii && !opts.noUtf8Flag && !e.rawName) flags |= 0x800;
    if (opts.dataDescriptor) flags |= 0x08;
    if (e.encrypted) flags |= 0x01;
    const offset = out.length;
    const usizeClaim = e.fakeUncompressedSize ?? e.data.length;
    // local header
    const lhSizes = opts.dataDescriptor
      ? [0, 0, 0]
      : [crc, opts.zip64 ? 0xffffffff : comp.length, opts.zip64 ? 0xffffffff : usizeClaim];
    const localExtra =
      opts.zip64 && !opts.dataDescriptor
        ? cat(u16(1), u16(16), u64(usizeClaim), u64(comp.length))
        : new Uint8Array(0);
    out.push(
      cat(
        u32(0x04034b50),
        u16(opts.zip64 ? 45 : 20),
        u16(flags),
        u16(method),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(lhSizes[0]!),
        u32(lhSizes[1]!),
        u32(lhSizes[2]!),
        u16(nameBytes.length),
        u16(localExtra.length),
        nameBytes,
        localExtra,
      ),
    );
    out.push(comp);
    if (opts.dataDescriptor) {
      out.push(
        opts.zip64
          ? cat(u32(0x08074b50), u32(crc), u64(comp.length), u64(usizeClaim))
          : cat(u32(0x08074b50), u32(crc), u32(comp.length), u32(usizeClaim)),
      );
    }
    const cExtra = opts.zip64
      ? cat(u16(1), u16(24), u64(usizeClaim), u64(comp.length), u64(offset))
      : new Uint8Array(0);
    central.push(
      cat(
        u32(0x02014b50),
        u16(opts.zip64 ? 45 : 20),
        u16(opts.zip64 ? 45 : 20),
        u16(flags),
        u16(method),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(crc),
        u32(opts.zip64 ? 0xffffffff : comp.length),
        u32(opts.zip64 ? 0xffffffff : usizeClaim),
        u16(nameBytes.length),
        u16(cExtra.length),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(opts.zip64 ? 0xffffffff : offset),
        nameBytes,
        cExtra,
      ),
    );
  }
  const cdOffset = out.length;
  for (const c of central) out.push(c);
  const cdSize = out.length - cdOffset;
  const comment = enc.encode(opts.comment ?? '');
  if (opts.zip64) {
    const eocd64Off = out.length;
    out.push(
      cat(
        u32(0x06064b50),
        u64(44),
        u16(45),
        u16(45),
        u32(0),
        u32(0),
        u64(entries.length),
        u64(entries.length),
        u64(cdSize),
        u64(cdOffset),
      ),
    );
    out.push(cat(u32(0x07064b50), u32(0), u64(eocd64Off), u32(1)));
    out.push(
      cat(
        u32(0x06054b50),
        u16(0xffff),
        u16(0xffff),
        u16(0xffff),
        u16(0xffff),
        u32(0xffffffff),
        u32(0xffffffff),
        u16(comment.length),
        comment,
      ),
    );
  } else {
    out.push(
      cat(
        u32(0x06054b50),
        u16(0),
        u16(0),
        u16(entries.length),
        u16(entries.length),
        u32(cdSize),
        u32(cdOffset),
        u16(comment.length),
        comment,
      ),
    );
  }
  return out.bytes();
}
