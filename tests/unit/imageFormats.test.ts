import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { probeImage, sniffImage } from '../../src/archive/imageFormats.ts';
import { pageJpeg, pagePng } from '../../scripts/fixtures/lib.ts';
import { BitWriter } from './helpers.ts';

const enc = (s: string) => [...s].map((c) => c.charCodeAt(0));
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];

describe('probeImage', () => {
  it('png', () =>
    expect(probeImage(pagePng(0, 123, 456))).toEqual({ kind: 'png', w: 123, h: 456 }));
  it('jpeg', () => expect(probeImage(pageJpeg(0, 64, 96))).toEqual({ kind: 'jpeg', w: 64, h: 96 }));
  it('gif', () => {
    const b = Uint8Array.from([...enc('GIF89a'), 200, 0, 100, 0, 0, 0, 0]);
    expect(probeImage(b)).toEqual({ kind: 'gif', w: 200, h: 100 });
  });
  it('webp VP8X', () => {
    const b = Uint8Array.from([
      ...enc('RIFF'),
      ...le32(30),
      ...enc('WEBP'),
      ...enc('VP8X'),
      ...le32(10),
      0,
      0,
      0,
      0,
      0x0f,
      0x07,
      0x00,
      0x1f,
      0x04,
      0x00,
    ]);
    expect(probeImage(b)).toEqual({ kind: 'webp', w: 0x70f + 1, h: 0x41f + 1 });
  });
  it('webp VP8 (lossy)', () => {
    const b = new Uint8Array(40);
    b.set(enc('RIFF'), 0);
    b.set(enc('WEBP'), 8);
    b.set(enc('VP8 '), 12);
    b.set([0x9d, 0x01, 0x2a], 23);
    b.set([0x00, 0x03, 0x00, 0x02], 26); // 768 x 512
    expect(probeImage(b)).toEqual({ kind: 'webp', w: 768, h: 512 });
  });
  it('webp VP8L (lossless)', () => {
    const b = new Uint8Array(40);
    b.set(enc('RIFF'), 0);
    b.set(enc('WEBP'), 8);
    b.set(enc('VP8L'), 12);
    b[20] = 0x2f;
    const w = 300 - 1,
      h = 200 - 1;
    const bits = w | (h << 14);
    b.set(le32(bits), 21);
    expect(probeImage(b)).toEqual({ kind: 'webp', w: 300, h: 200 });
  });
  it('avif (ispe)', () => {
    const b = Uint8Array.from([
      ...be32(24),
      ...enc('ftyp'),
      ...enc('avif'),
      0,
      0,
      0,
      0,
      ...enc('avifmif1'),
      ...be32(20),
      ...enc('ispe'),
      0,
      0,
      0,
      0,
      ...be32(1600),
      ...be32(2400),
    ]);
    expect(probeImage(b)).toEqual({ kind: 'avif', w: 1600, h: 2400 });
  });
  it('jxl codestream, small header', () => {
    const w = new BitWriter().write(0x0aff, 16).write(1, 1).write(4, 5).write(0, 3).write(9, 5);
    expect(probeImage(w.bytes())).toEqual({ kind: 'jxl', w: 80, h: 40 });
  });
  it('jxl codestream, 1:1 ratio', () => {
    const w = new BitWriter().write(0x0aff, 16).write(0, 1).write(1, 2).write(1199, 13).write(1, 3);
    expect(probeImage(w.bytes())).toEqual({ kind: 'jxl', w: 1200, h: 1200 });
  });
  it('jxl codestream, explicit width', () => {
    const w = new BitWriter()
      .write(0x0aff, 16)
      .write(0, 1)
      .write(1, 2)
      .write(2999, 13)
      .write(0, 3)
      .write(1, 2)
      .write(799, 13);
    expect(probeImage(w.bytes())).toEqual({ kind: 'jxl', w: 800, h: 3000 });
  });
  it('bmp', () => {
    const b = new Uint8Array(30);
    b[0] = 0x42;
    b[1] = 0x4d;
    new DataView(b.buffer).setInt32(18, 320, true);
    new DataView(b.buffer).setInt32(22, -240, true);
    expect(probeImage(b)).toEqual({ kind: 'bmp', w: 320, h: 240 });
  });
  it('unknown, tiny and truncated inputs return null', () => {
    expect(probeImage(new Uint8Array(0))).toBeNull();
    expect(probeImage(Uint8Array.from(enc('hello world, not an image')))).toBeNull();
    expect(probeImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBeNull();
    expect(probeImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]))).toBeNull();
  });
  it('sniffImage ignores extension, uses magic', () => {
    expect(sniffImage(pagePng(0, 10, 10))).toBe('png');
    expect(sniffImage(pageJpeg(0, 16, 16))).toBe('jpeg');
  });
});

describe('AVIF / JXL header probing on real encoder output', () => {
  it.each(['page-0.avif', 'page-1.jxl', 'page-2.jxl', 'page-2.avif'])('%s -> 200x300', (n) => {
    const bytes = new Uint8Array(readFileSync(`tests/fixtures/bin/${n}`));
    const p = probeImage(bytes);
    expect(p).toMatchObject({ w: 200, h: 300 });
    expect(p?.kind).toBe(n.endsWith('avif') ? 'avif' : 'jxl');
  });
});
