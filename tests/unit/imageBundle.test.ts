import { describe, expect, it } from 'vitest';
import { pageEntryNames } from '../../src/archive/ArchiveReader.ts';
import { detectFormat } from '../../src/archive/detect.ts';
import { readZipDirectory } from '../../src/archive/zip/zipDirectory.ts';
import { ZipReader } from '../../src/archive/zip/zipReader.ts';
import {
  bundleLooseImages,
  bundleToCbz,
  commonPrefixName,
  groupImages,
  splitImages,
  writeCbz,
} from '../../src/data/imageBundle.ts';
import { pageJpeg, pagePng } from '../../scripts/fixtures/lib.ts';

const png = (name: string, n: number, rel?: string): File => {
  const f = new File([pagePng(n, 40, 60) as BlobPart], name, { type: 'image/png' });
  if (rel) Object.defineProperty(f, 'webkitRelativePath', { value: rel });
  return f;
};

describe('commonPrefixName', () => {
  it('drops the page counter and separators', () => {
    expect(commonPrefixName(['one piece 001.jpg', 'one piece 002.jpg', 'one piece 010.jpg'])).toBe(
      'one piece',
    );
    expect(commonPrefixName(['p_1.png', 'p_2.png'])).toBe('p');
  });
  it('is empty when nothing is shared', () => {
    expect(commonPrefixName(['a.png', 'b.png'])).toBe('');
  });
});

describe('groupImages', () => {
  it('sorts naturally and names a loose group after the shared prefix', () => {
    const g = groupImages([png('s 10.png', 1), png('s 2.png', 2), png('s 1.png', 3)], 'fallback');
    expect(g).toHaveLength(1);
    expect(g[0]!.name).toBe('s');
    expect(g[0]!.files.map((f) => f.name)).toEqual(['s 1.png', 's 2.png', 's 10.png']);
  });
  it('uses the fallback name when no prefix is shared', () => {
    expect(groupImages([png('a.png', 1), png('b.png', 2)], 'Images 2026')[0]!.name).toBe(
      'Images 2026',
    );
  });
  it('makes one book per folder, named after the folder', () => {
    const g = groupImages(
      [
        png('1.png', 1, 'Vol A/1.png'),
        png('1.png', 2, 'Vol B/1.png'),
        png('2.png', 3, 'Vol A/2.png'),
      ],
      'fallback',
    );
    expect(g.map((x) => [x.name, x.files.length]).sort()).toEqual([
      ['Vol A', 2],
      ['Vol B', 1],
    ]);
  });
  it('strips characters that are unsafe in file names', () => {
    expect(groupImages([png('1.png', 1, 'a:b?c/1.png')], 'x')[0]!.name).toBe('a_b_c');
  });
});

describe('bundleToCbz', () => {
  it('writes a CBZ the reader opens, pages in order, bytes identical', async () => {
    const files = [png('c 11.png', 3), png('c 2.png', 1), png('c 3.png', 2)];
    const group = groupImages(files, 'x')[0]!;
    const cbz = await bundleToCbz(group);
    expect(cbz.name).toBe('c.cbz');
    expect(detectFormat(new Uint8Array(await cbz.slice(0, 16).arrayBuffer()))).toBe('zip');
    const entries = await readZipDirectory(cbz);
    const names = pageEntryNames(entries);
    expect(names).toHaveLength(3);
    const reader = await ZipReader.open(cbz);
    for (let i = 0; i < 3; i++) {
      const got = await reader.readEntry(names[i]!);
      const want = new Uint8Array(await group.files[i]!.arrayBuffer());
      expect(Array.from(got)).toEqual(Array.from(want));
    }
  });
  it('handles a larger-than-chunk image', async () => {
    const big = new File(
      [new Uint8Array(2_500_000).fill(7) as BlobPart, pageJpeg(1, 8, 8) as BlobPart],
      'big.jpg',
    );
    const cbz = await bundleToCbz({ name: 'big', files: [big] });
    const entries = await readZipDirectory(cbz);
    expect(entries[0]!.size).toBe(big.size);
  });
});

describe('bundleLooseImages', () => {
  it('leaves archives alone and bundles only the images', async () => {
    const zipLike = new File(
      [new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
      'x.cbz',
    );
    const out = await bundleLooseImages([png('p 1.png', 1), zipLike, png('p 2.png', 2)], 'fb');
    expect(out.map((f) => f.name).sort()).toEqual(['p.cbz', 'x.cbz']);
  });
  it('returns the same list when there are no images', async () => {
    const list = [new File([new Uint8Array(16)], 'a.bin')];
    expect(await bundleLooseImages(list, 'fb')).toBe(list);
  });
});

describe('determinism', () => {
  it('the same images always produce byte-identical CBZ (re-import is detected as duplicate)', async () => {
    const make = () => [png('d 1.png', 1), png('d 2.png', 2)];
    const a = await bundleToCbz(groupImages(make(), 'x')[0]!);
    await new Promise((r) => setTimeout(r, 2100));
    const b = await bundleToCbz(groupImages(make(), 'x')[0]!);
    expect(Array.from(new Uint8Array(await a.arrayBuffer()))).toEqual(
      Array.from(new Uint8Array(await b.arrayBuffer())),
    );
  });
});

describe('writeCbz (streamed into OPFS by the import worker)', () => {
  it('emits the archive in small chunks: never the whole archive at once', async () => {
    const big = (n: number) =>
      new File([new Uint8Array(3_000_000).fill(n) as BlobPart], `p${n}.jpg`);
    const files = [big(1), big(2), big(3)]; // 9 MB of pages
    const sizes: number[] = [];
    const parts: Uint8Array[] = [];
    await writeCbz(files, (c) => {
      sizes.push(c.byteLength);
      parts.push(c.slice());
    });
    expect(Math.max(...sizes)).toBeLessThanOrEqual((1 << 20) + 1024);
    const streamed = new Blob(parts as BlobPart[]);
    const entries = await readZipDirectory(streamed);
    expect(entries.map((e) => e.size)).toEqual([3_000_000, 3_000_000, 3_000_000]);
    // byte-identical to the in-memory bundle (same duplicate key either way)
    const mem = await bundleToCbz({ name: 'x', files });
    const a = Buffer.from(await streamed.arrayBuffer());
    expect(a.equals(Buffer.from(await mem.arrayBuffer()))).toBe(true);
  });

  it('stops when the sink throws (import cancelled)', async () => {
    const files = [new File([new Uint8Array(3_000_000) as BlobPart], 'a.jpg')];
    let calls = 0;
    await expect(
      writeCbz(files, () => {
        if (++calls === 2) throw new Error('cancelled');
      }),
    ).rejects.toThrow('cancelled');
    expect(calls).toBe(2);
  });
});

describe('splitImages', () => {
  it('groups images and passes other files through', async () => {
    const zip = new File([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]) as BlobPart], 'a.cbz');
    const { groups, rest } = await splitImages([png('p 2.png', 2), zip, png('p 1.png', 1)], 'f');
    expect(rest).toEqual([zip]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.files.map((f) => f.name)).toEqual(['p 1.png', 'p 2.png']);
  });
});
