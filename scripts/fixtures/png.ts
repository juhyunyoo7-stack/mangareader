// Minimal deterministic raster helpers + PNG encoder for fixtures and icons (no native deps).
import { zlibSync } from 'fflate';

export interface Raster {
  w: number;
  h: number;
  /** RGB, 3 bytes per pixel */
  data: Uint8Array;
}

export function makeRaster(w: number, h: number, bg: [number, number, number]): Raster {
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    data[i * 3] = bg[0];
    data[i * 3 + 1] = bg[1];
    data[i * 3 + 2] = bg[2];
  }
  return { w, h, data };
}

export function fillRect(
  r: Raster,
  x: number,
  y: number,
  w: number,
  h: number,
  c: [number, number, number],
): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(r.w, x + w);
  const y1 = Math.min(r.h, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * r.w + xx) * 3;
      r.data[i] = c[0];
      r.data[i + 1] = c[1];
      r.data[i + 2] = c[2];
    }
  }
}

export function strokeRect(r: Raster, t: number, c: [number, number, number]): void {
  fillRect(r, 0, 0, r.w, t, c);
  fillRect(r, 0, r.h - t, r.w, t, c);
  fillRect(r, 0, 0, t, r.h, c);
  fillRect(r, r.w - t, 0, t, r.h, c);
}

const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  P: ['111', '101', '111', '100', '100'],
  '-': ['000', '000', '111', '000', '000'],
};

/** Draw digits/letters with a 3x5 font, `s` pixels per font cell. */
export function drawText(
  r: Raster,
  text: string,
  x: number,
  y: number,
  s: number,
  c: [number, number, number],
): void {
  let cx = x;
  for (const ch of text) {
    const g = FONT[ch];
    if (g) {
      for (let gy = 0; gy < 5; gy++)
        for (let gx = 0; gx < 3; gx++)
          if (g[gy]![gx] === '1') fillRect(r, cx + gx * s, y + gy * s, s, s, c);
    }
    cx += 4 * s;
  }
}

export function textWidth(text: string, s: number): number {
  return text.length * 4 * s - s;
}

function crc32Table(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const TABLE = crc32Table();
export function crc32(buf: Uint8Array, seed = 0): number {
  let c = ~seed >>> 0;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode RGB raster as PNG (filter 0 per row, deterministic zlib level 6). */
export function encodePng(r: Raster, level: 0 | 1 | 6 = 1): Uint8Array {
  const stride = r.w * 3;
  const raw = new Uint8Array((stride + 1) * r.h);
  for (let y = 0; y < r.h; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(r.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, r.w);
  dv.setUint32(4, r.h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
