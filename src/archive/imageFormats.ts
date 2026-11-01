/** Header-only image format detection and dimension probing (never decodes pixels). */
export type ImageKind = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif' | 'jxl' | 'bmp';

export interface ImageProbe {
  kind: ImageKind;
  w: number;
  h: number;
}

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (b.length >= 6 && ascii(b, 0, 3) === 'GIF') return 'gif';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0x0a) return 'jxl';
  if (b.length >= 12 && ascii(b, 4, 4) === 'JXL ') return 'jxl';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  return null;
}

export function mimeFor(kind: ImageKind): string {
  return kind === 'jpeg'
    ? 'image/jpeg'
    : kind === 'bmp'
      ? 'image/bmp'
      : kind === 'jxl'
        ? 'image/jxl'
        : `image/${kind}`;
}

function jpegDims(b: Uint8Array): { w: number; h: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1]!;
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (b[i + 5]! << 8) | b[i + 6]!, w: (b[i + 7]! << 8) | b[i + 8]! };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function u32be(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}
function u16le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function u24le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
}

function webpDims(b: Uint8Array): { w: number; h: number } | null {
  const fourcc = ascii(b, 12, 4);
  if (fourcc === 'VP8X' && b.length >= 30) {
    return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1 };
  }
  if (fourcc === 'VP8 ' && b.length >= 30) {
    return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
  }
  if (fourcc === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

function avifDims(b: Uint8Array): { w: number; h: number } | null {
  for (let i = 0; i + 16 <= b.length; i++) {
    if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) {
      // 'ispe' + version/flags(4) + width(4) + height(4)
      return { w: u32be(b, i + 8), h: u32be(b, i + 12) };
    }
  }
  return null;
}

class BitReader {
  private pos = 0;
  constructor(private readonly b: Uint8Array) {}
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.b[this.pos >> 3] ?? 0;
      v |= ((byte >> (this.pos & 7)) & 1) << i;
      this.pos++;
    }
    return v >>> 0;
  }
}

const JXL_RATIOS: [number, number][] = [
  [1, 1],
  [12, 10],
  [4, 3],
  [3, 2],
  [16, 9],
  [5, 4],
  [2, 1],
];

function jxlCodestreamDims(cs: Uint8Array): { w: number; h: number } | null {
  if (cs.length < 4 || cs[0] !== 0xff || cs[1] !== 0x0a) return null;
  const r = new BitReader(cs.subarray(2));
  const u32 = () => {
    const sel = r.read(2);
    const bits = [9, 13, 18, 30][sel]!;
    return r.read(bits) + 1;
  };
  const small = r.read(1);
  let h: number;
  if (small) h = (r.read(5) + 1) * 8;
  else h = u32();
  const ratio = r.read(3);
  let w: number;
  if (ratio === 0) w = small ? (r.read(5) + 1) * 8 : u32();
  else {
    const [n, d] = JXL_RATIOS[ratio - 1]!;
    w = Math.floor((h * n) / d);
  }
  return { w, h };
}

function jxlDims(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] === 0xff && b[1] === 0x0a) return jxlCodestreamDims(b);
  let o = 0;
  while (o + 8 <= b.length) {
    const size = u32be(b, o);
    const type = ascii(b, o + 4, 4);
    const end = size === 0 ? b.length : o + size;
    if (type === 'jxlc') return jxlCodestreamDims(b.subarray(o + 8, end));
    if (type === 'jxlp') return jxlCodestreamDims(b.subarray(o + 12, end));
    if (size < 8) break;
    o = end;
  }
  return null;
}

/** Probe the first bytes of an image; returns null if unknown or dimensions not found. */
export function probeImage(b: Uint8Array): ImageProbe | null {
  const kind = sniffImage(b);
  if (!kind) return null;
  let d: { w: number; h: number } | null = null;
  switch (kind) {
    case 'jpeg':
      d = jpegDims(b);
      break;
    case 'png':
      d = b.length >= 24 ? { w: u32be(b, 16), h: u32be(b, 20) } : null;
      break;
    case 'gif':
      d = b.length >= 10 ? { w: u16le(b, 6), h: u16le(b, 8) } : null;
      break;
    case 'webp':
      d = webpDims(b);
      break;
    case 'avif':
      d = avifDims(b);
      break;
    case 'jxl':
      d = jxlDims(b);
      break;
    case 'bmp':
      if (b.length >= 26) {
        const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        d = { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)) };
      }
      break;
  }
  if (!d || d.w <= 0 || d.h <= 0) return null;
  return { kind, ...d };
}
