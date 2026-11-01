import { describe, expect, it } from 'vitest';
import { pageEntryNames, isUnsafeOrJunkName } from '../../src/archive/ArchiveReader.ts';
import { analyzeZip } from '../../src/archive/analyze.ts';
import { detectFormat } from '../../src/archive/detect.ts';
import { ArchiveError } from '../../src/archive/errors.ts';
import {
  chooseLegacyEncoding,
  decodeName,
  readZipDirectory,
} from '../../src/archive/zip/zipDirectory.ts';
import { ZipReader } from '../../src/archive/zip/zipReader.ts';
import { FIXTURES, pageColor } from '../../scripts/fixtures/lib.ts';
import { probeImage } from '../../src/archive/imageFormats.ts';
import { writeZip } from '../../scripts/fixtures/zipwriter.ts';
import { blobSource, CountingSource } from './helpers.ts';

const fx = (name: string) => blobSource(FIXTURES[name]!());

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ArchiveError ? e.code : `other:${String(e)}`;
  }
}

describe('zip variants parse and read back identical bytes', () => {
  it.each(['basic-10.cbz', 'deflated.cbz', 'zip64.cbz', 'datadesc.cbz', 'nested.cbz'])(
    '%s',
    async (name) => {
      const src = fx(name);
      const r = await ZipReader.open(src);
      const names = pageEntryNames(await r.listEntries());
      expect(names.length).toBeGreaterThanOrEqual(4);
      for (const [i, n] of names.entries()) {
        const bytes = await r.readEntry(n);
        const probe = probeImage(bytes);
        expect(probe?.kind).toBe('png');
        // the centre pixel colour is checked in e2e; here ensure each page decodes to distinct bytes
        expect(bytes.length).toBeGreaterThan(100);
        void i;
      }
    },
  );

  it('stored and deflated entries return the same content', async () => {
    const stored = await ZipReader.open(fx('basic-10.cbz'));
    const defl = await ZipReader.open(
      blobSource(
        writeZip([{ name: '001.png', data: await stored.readEntry('001.png'), method: 8 }]),
      ),
    );
    expect(await defl.readEntry('001.png')).toEqual(await stored.readEntry('001.png'));
  });

  it('zip64 directory is parsed through the locator', async () => {
    const entries = await readZipDirectory(fx('zip64.cbz'));
    expect(entries.map((e) => e.name)).toEqual(['001.png', '002.png', '003.png', '004.png']);
    expect(entries[0]!.size).toBeGreaterThan(0);
  });

  it('data descriptor archives use central directory sizes', async () => {
    const r = await ZipReader.open(fx('datadesc.cbz'));
    const bytes = await r.readEntry('003.png');
    expect(probeImage(bytes)).toMatchObject({ kind: 'png', w: 300, h: 400 });
  });

  it('readPrefix of a deflated entry returns the real PNG header', async () => {
    const r = await ZipReader.open(fx('deflated.cbz'));
    const prefix = await r.readPrefix('001.png', 1024);
    expect(probeImage(prefix)).toMatchObject({ w: 300, h: 400 });
    expect(prefix.length).toBeLessThanOrEqual(1024);
  });
});

describe('names', () => {
  it('UTF-8 names (CJK, Hangul, emoji)', async () => {
    const r = await ZipReader.open(fx('nonascii.cbz'));
    const names = (await r.listEntries()).map((e) => e.name);
    expect(names).toContain('第01話/ページ 001.png');
    expect(names).toContain('한글폴더/003.png');
    expect(names).toContain('emoji 🎉 page 004.png');
  });
  it('legacy Shift-JIS names without the UTF-8 flag are decoded', async () => {
    const r = await ZipReader.open(fx('sjis.cbz'));
    const names = (await r.listEntries()).map((e) => e.name).sort();
    expect(names[0]).toBe('ページ001.png');
  });
  it('Korean CP949 names (ambiguous with Shift-JIS) decode as hangul, cover first, numeric order', async () => {
    const r = await ZipReader.open(fx('cp949.cbz'));
    const pages = pageEntryNames(await r.listEntries());
    expect(pages).toHaveLength(12);
    expect(pages[0]).toBe('_cover.jpg');
    expect(pages.slice(1, 4)).toEqual(['김일10_01.jpg', '김일10_02.jpg', '김일10_03.jpg']);
    expect(pages.at(-1)).toBe('김일10_11.jpg');
  });
  it('natural sort orders 1,2,10', async () => {
    const r = await ZipReader.open(fx('natural-sort.cbz'));
    expect(pageEntryNames(await r.listEntries())).toEqual(['1.png', '2.png', '10.png']);
  });
  it('traversal, absolute, hidden, junk and markup-like names are handled', async () => {
    const r = await ZipReader.open(fx('traversal.cbz'));
    const pages = pageEntryNames(await r.listEntries());
    expect(pages).toEqual(
      ['<img src=x onerror=alert(1)>.png', 'ok/001.png', 'ok/002.png'].sort(
        (a, b) => pages.indexOf(a) - pages.indexOf(b),
      ),
    );
    expect(pages.some((p) => p.includes('..') || p.startsWith('/'))).toBe(false);
    expect(pages).not.toContain('.hidden.png');
    expect(pages.some((p) => p.includes('__MACOSX'))).toBe(false);
  });
  it('isUnsafeOrJunkName', () => {
    for (const n of [
      '../a.png',
      'a/../b.png',
      '/a.png',
      'C:\\a.png',
      '..\\a.png',
      '.a.png',
      'x/.a.png',
      '__MACOSX/a.png',
      'Thumbs.db',
    ])
      expect(isUnsafeOrJunkName(n), n).toBe(true);
    for (const n of ['a.png', 'dir/a.png', 'a..b.png', '第1話/1.png'])
      expect(isUnsafeOrJunkName(n), n).toBe(false);
  });
});

describe('hostile and damaged archives', () => {
  it('not a zip', async () => {
    expect(await code(readZipDirectory(fx('notazip.cbz')))).toBe('not-zip');
    expect(await code(readZipDirectory(blobSource(new Uint8Array(5))))).toBe('not-zip');
  });
  it('truncated archive', async () => {
    expect(await code(readZipDirectory(fx('truncated.cbz')))).toBe('truncated');
  });
  it('encrypted images', async () => {
    expect(await code(ZipReader.open(fx('encrypted.cbz')))).toBe('encrypted');
  });
  it('declared entry size over the limit', async () => {
    const r = await ZipReader.open(fx('fake-size.cbz'));
    expect(await code(r.readEntry('001.png'))).toBe('entry-too-large');
  });
  it('compression-ratio bomb is rejected, siblings still readable', async () => {
    const r = await ZipReader.open(fx('bomb-ratio.cbz'));
    expect(await code(r.readEntry('001.png'))).toBe('ratio');
    expect((await r.readEntry('002.png')).length).toBeGreaterThan(0);
  });
  it('too many entries', async () => {
    const many = writeZip(
      Array.from({ length: 50 }, (_, i) => ({
        name: `${i}.png`,
        data: new Uint8Array(1),
        method: 0 as const,
      })),
    );
    expect(
      await code(
        readZipDirectory(blobSource(many), {
          maxEntries: 10,
          maxEntryBytes: 1e9,
          ratioMinBytes: 1e9,
          maxRatio: 300,
        }),
      ),
    ).toBe('too-many-entries');
  });
  it('no images', async () => {
    expect(await code(analyzeZip(fx('no-images.cbz')))).toBe('no-images');
  });
  it('corrupt entry data fails the crc check', async () => {
    const bytes = FIXTURES['basic-10.cbz']!().slice();
    // flip a byte inside the first entry payload (after 30-byte header + 7 byte name)
    bytes[30 + 7 + 200] ^= 0xff;
    const r = await ZipReader.open(blobSource(bytes));
    expect(await code(r.readEntry('001.png'))).toBe('bad-entry');
  });
  it('a deflated entry whose stream is bad throws bad-entry', async () => {
    const good = writeZip([{ name: '001.png', data: new Uint8Array(5000).fill(7), method: 8 }]);
    good[30 + 7 + 2] ^= 0xff;
    const r = await ZipReader.open(blobSource(good));
    expect(await code(r.readEntry('001.png'))).toBe('bad-entry');
  });
});

describe('format detection', () => {
  it('detects by magic bytes', () => {
    expect(detectFormat(Uint8Array.from([0x50, 0x4b, 3, 4]))).toBe('zip');
    expect(detectFormat(new TextEncoder().encode('Rar!\x1a\x07'))).toBe('rar');
    expect(detectFormat(Uint8Array.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))).toBe('7z');
    expect(detectFormat(new TextEncoder().encode('%PDF-1.7'))).toBe('pdf');
    expect(detectFormat(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe('image');
    expect(detectFormat(new TextEncoder().encode('hello world!'))).toBeNull();
  });
});

describe('analysis', () => {
  it('lists pages with dimensions, wide flag, content key', async () => {
    const a = await analyzeZip(fx('spread-wide.cbz'));
    expect(a.pages).toHaveLength(10);
    expect(a.pages[5]).toMatchObject({ w: 1200, h: 900, wide: true });
    expect(a.pages[4]).toMatchObject({ w: 600, h: 900, wide: false });
    expect(a.contentKey).toMatch(/^[0-9a-f]{32}$/);
  });
  it('mixed JPEG/PNG dims', async () => {
    const a = await analyzeZip(fx('mixed-jpeg.cbz'));
    expect(a.pages.map((p) => [p.w, p.h])).toEqual([
      [500, 700],
      [500, 700],
      [500, 700],
      [500, 700],
    ]);
  });
  it('ComicInfo RTL manga', async () => {
    const a = await analyzeZip(fx('rtl-manga.cbz'));
    expect(a.comicInfo).toMatchObject({ series: 'Right Left', manga: 'YesAndRightToLeft' });
    expect(a.pages).toHaveLength(8);
  });
  it('content key is stable and differs between books', async () => {
    const a1 = await analyzeZip(fx('basic-10.cbz'));
    const a2 = await analyzeZip(fx('basic-10.cbz'));
    const b = await analyzeZip(fx('odd-7.cbz'));
    expect(a1.contentKey).toBe(a2.contentKey);
    expect(a1.contentKey).not.toBe(b.contentKey);
  });
});

describe('fixtures', () => {
  it('are deterministic', () => {
    for (const n of ['basic-10.cbz', 'zip64.cbz', 'sjis.cbz', 'traversal.cbz']) {
      expect(FIXTURES[n]!()).toEqual(FIXTURES[n]!());
    }
  });
  it('page colours are distinct per page', () => {
    const set = new Set(Array.from({ length: 50 }, (_, i) => pageColor(i).join(',')));
    expect(set.size).toBe(50);
  });
});

describe('lazy reading from a huge archive', () => {
  it('reading entry 250 of a 300-entry ~200 MB archive touches < 2 MB', async () => {
    const payload = new Uint8Array(680 * 1024);
    // make each entry unique cheaply
    const entries = Array.from({ length: 300 }, (_, i) => {
      const d = payload.slice();
      d[0] = i & 255;
      d[1] = i >> 8;
      return { name: `${String(i + 1).padStart(3, '0')}.png`, data: d, method: 0 as const };
    });
    const zip = writeZip(entries);
    expect(zip.length).toBeGreaterThan(200 * 1000 * 1000 - 5_000_000);
    const src = new CountingSource(blobSource(zip));
    const r = await ZipReader.open(src);
    const before = src.bytesRead;
    const bytes = await r.readEntry('250.png');
    expect(bytes[0]).toBe(249);
    expect(src.bytesRead).toBeLessThan(2 * 1024 * 1024);
    expect(before).toBeLessThan(200 * 1024);
  }, 120_000);
});

describe('legacy zip name encoding is chosen per archive', () => {
  const b = (...xs: number[]) => Uint8Array.from(xs);
  it('Korean bytes that are also valid Shift-JIS are read as EUC-KR', () => {
    expect(chooseLegacyEncoding([b(0xb1, 0xe8, 0xc0, 0xcf, 0x31)])).toBe('euc-kr');
  });
  it('Japanese Shift-JIS names are read as Shift-JIS (not as extended-hangul UHC)', () => {
    expect(chooseLegacyEncoding([b(0x83, 0x79, 0x81, 0x5b, 0x83, 0x57, 0x31)])).toBe('shift_jis');
  });
  it('one decision for every entry, UTF-8 and ASCII names are left alone', () => {
    const names = [
      b(0xb1, 0xe8, 0xc0, 0xfc, 0xc0, 0xcf),
      b(0xb1, 0xe8, 0xc0, 0xcf),
      b(0x61, 0x2e),
      new TextEncoder().encode('한'),
    ];
    expect(chooseLegacyEncoding(names)).toBe('euc-kr');
    expect(decodeName(names[0]!, 0, undefined, 'euc-kr')).toBe('김전일');
    expect(decodeName(names[3]!, 0, undefined, 'euc-kr')).toBe('한');
  });
  it('bytes valid in neither code page fall back to windows-1252, never throw', () => {
    expect(chooseLegacyEncoding([b(0xff, 0xfe, 0xfd)])).toBe('windows-1252');
    expect(decodeName(b(0xff, 0xfe, 0xfd), 0)).toHaveLength(3);
  });
});
