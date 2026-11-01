// Minimal RAR writers (stored method only, no compression) for test fixtures: no RAR compressor is
// available on the dev PC. They exercise container parsing (RAR4 and RAR5 headers, CRCs, names), not
// RAR decompression; compressed and solid RAR are NOT covered by these fixtures.
import { crc32 } from './png.ts';

export interface RarEntryIn {
  name: string;
  data: Uint8Array;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function vint(n: number): Uint8Array {
  const b: number[] = [];
  do {
    let x = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) x |= 0x80;
    b.push(x);
  } while (n > 0);
  return Uint8Array.from(b);
}

function u32(n: number): Uint8Array {
  return Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
}
function u16(n: number): Uint8Array {
  return Uint8Array.of(n & 255, (n >>> 8) & 255);
}

function rar5Block(body: Uint8Array, data?: Uint8Array): Uint8Array[] {
  const size = vint(body.length);
  const crc = u32(crc32(concat([size, body])));
  return [crc, size, body, ...(data ? [data] : [])];
}

export function writeRar5Stored(entries: RarEntryIn[]): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00)];
  parts.push(...rar5Block(concat([vint(1), vint(0), vint(0)]))); // main header, no archive flags
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const body = concat([
      vint(2), // file header
      vint(0x02), // data area present
      vint(e.data.length), // data size
      vint(0x04), // file flags: CRC32 present
      vint(e.data.length), // unpacked size
      vint(0o100644), // attributes: regular file, rw-r--r--
      u32(crc32(e.data)),
      vint(0), // compression info: version 0, stored
      vint(1), // host OS: unix
      vint(name.length),
      name,
    ]);
    parts.push(...rar5Block(body, e.data));
  }
  parts.push(...rar5Block(concat([vint(5), vint(0), vint(0)]))); // end of archive
  return concat(parts);
}

function rar4Block(type: number, flags: number, rest: Uint8Array, data?: Uint8Array): Uint8Array[] {
  const size = 7 + rest.length;
  const tail = concat([Uint8Array.of(type), u16(flags), u16(size), rest]);
  const crc = u16(crc32(tail) & 0xffff);
  return [crc, tail, ...(data ? [data] : [])];
}

export function writeRar4Stored(entries: RarEntryIn[]): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00)];
  parts.push(...rar4Block(0x73, 0, new Uint8Array(6))); // main header
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const rest = concat([
      u32(e.data.length), // packed size
      u32(e.data.length), // unpacked size
      Uint8Array.of(2), // host OS: win32
      u32(crc32(e.data)),
      u32(0x5a210000), // dos time/date
      Uint8Array.of(20), // unpack version
      Uint8Array.of(0x30), // method: store
      u16(name.length),
      u32(0x20), // attributes
      name,
    ]);
    parts.push(...rar4Block(0x74, 0x8000, rest, e.data));
  }
  parts.push(Uint8Array.of(0xc4, 0x3d, 0x7b, 0x00, 0x40, 0x07, 0x00)); // end of archive
  return concat(parts);
}
