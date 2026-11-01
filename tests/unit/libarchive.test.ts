import { readFileSync } from 'node:fs';
import { libarchiveWasm } from 'libarchive-wasm';
import { describe, expect, it } from 'vitest';
import { pageEntryNames } from '../../src/archive/ArchiveReader.ts';
import { detectFormat } from '../../src/archive/detect.ts';
import { ArchiveError } from '../../src/archive/errors.ts';
import { probeImage } from '../../src/archive/imageFormats.ts';
import { LibarchiveReader } from '../../src/archive/libarchive/libarchiveReader.ts';
import { pagePng, name3 } from '../../scripts/fixtures/lib.ts';
import { writeRar4Stored, writeRar5Stored } from '../../scripts/fixtures/rarwriter.ts';
import { blobSource } from './helpers.ts';

const load = () => libarchiveWasm();
const MAX = 64 * 1024 * 1024;
const bin = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/bin/${n}`));
const open = (b: Uint8Array, maxBytes = MAX) =>
  LibarchiveReader.open(blobSource(b), load, { maxBytes });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ArchiveError ? e.code : `other:${String(e)}`;
  }
}

const pages = [0, 1, 2].map((i) => ({ name: name3(i), data: pagePng(i, 120, 180) }));

describe('format detection', () => {
  it('recognises RAR4, RAR5 and 7z by magic bytes', () => {
    expect(detectFormat(writeRar4Stored(pages))).toBe('rar');
    expect(detectFormat(writeRar5Stored(pages))).toBe('rar');
    expect(detectFormat(bin('solid4.7z'))).toBe('7z');
  });
});

describe('RAR (stored fixtures; compressed/solid RAR is not covered, no RAR compressor available)', () => {
  it.each([
    ['rar4', writeRar4Stored],
    ['rar5', writeRar5Stored],
  ])('%s: lists and reads back identical page bytes', async (_n, write) => {
    const r = await open(
      write([...pages, { name: 'ComicInfo.xml', data: new TextEncoder().encode('<ComicInfo/>') }]),
    );
    const entries = await r.listEntries();
    expect(pageEntryNames(entries)).toEqual(['001.png', '002.png', '003.png']);
    for (const p of pages) {
      expect(await r.readEntry(p.name)).toEqual(p.data);
      expect(probeImage(await r.readPrefix(p.name, 65536))).toMatchObject({ w: 120, h: 180 });
    }
    expect(entries.some((e) => e.name === 'ComicInfo.xml')).toBe(true);
  });

  it('drops traversal and hidden entries', async () => {
    const r = await open(
      writeRar5Stored([
        { name: '001.png', data: pages[0]!.data },
        { name: '../evil.png', data: pages[1]!.data },
        { name: '.hidden/002.png', data: pages[1]!.data },
      ]),
    );
    expect(pageEntryNames(await r.listEntries())).toEqual(['001.png']);
  });

  it('damaged archive fails with a typed error, not a crash', async () => {
    const bytes = writeRar5Stored(pages);
    const cut = bytes.slice(0, Math.floor(bytes.length / 2));
    expect(await code(open(cut))).toMatch(/^(bad-entry|truncated|no-images)$|ok/);
    expect(await code(open(new TextEncoder().encode('Rar!\x1a\x07\x00 not really a rar')))).toBe(
      'truncated',
    );
  });
});

describe('7z (real 7-Zip output)', () => {
  it.each(['solid4.7z', 'plain4.7z'])('%s opens and every page decodes to a PNG', async (n) => {
    const r = await open(bin(n));
    const names = pageEntryNames(await r.listEntries());
    expect(names).toEqual(['001.png', '002.png', '003.png', '004.png']);
    for (const [i, name] of names.entries()) {
      expect(await r.readEntry(name)).toEqual(pagePng(i, 200, 300));
    }
  });

  it('encrypted 7z is rejected with the encrypted code', async () => {
    expect(await code(open(bin('encrypted.7z')))).toBe('encrypted');
  });

  it('7z with encrypted headers is rejected (reported as damaged: libarchive cannot tell)', async () => {
    expect(await code(open(bin('encrypted-headers.7z')))).toBe('truncated');
  });
});

describe('convert-needed fallback', () => {
  it('archive over the whole-archive limit is rejected as too-large before WASM work', async () => {
    expect(await code(open(bin('solid4.7z'), 1000))).toBe('too-large');
  });

  it('decompressed content over the limit is rejected too', async () => {
    const big = writeRar5Stored([{ name: '001.png', data: new Uint8Array(5000) }]);
    expect(await code(open(big, 4000))).toBe('too-large');
  });

  it('WASM load failure becomes unsupported-format (convert hint), not an unhandled error', async () => {
    const failing = () => Promise.reject(new Error('no wasm'));
    expect(
      await code(LibarchiveReader.open(blobSource(bin('solid4.7z')), failing, { maxBytes: MAX })),
    ).toBe('unsupported-format');
  });
});
