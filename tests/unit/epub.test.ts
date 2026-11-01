import { describe, expect, it } from 'vitest';
import { analyzeZip } from '../../src/archive/analyze.ts';
import { ArchiveError } from '../../src/archive/errors.ts';
import {
  firstImageRef,
  parseContainer,
  parseOpf,
  resolveZipPath,
  textLength,
} from '../../src/archive/epub/epubParse.ts';
import { isRightToLeftManga } from '../../src/core/comicinfo.ts';
import { buildEpub, FIXTURES } from '../../scripts/fixtures/lib.ts';
import { blobSource } from './helpers.ts';

describe('epub parsing helpers', () => {
  it('reads the rootfile path in either attribute order and quote style', () => {
    expect(
      parseContainer(`<container><rootfile media-type="x" full-path='A/b.opf'/></container>`),
    ).toBe('A/b.opf');
    expect(parseContainer('<container/>')).toBeUndefined();
  });

  it('parses manifest, spine order, direction and title', () => {
    const opf = parseOpf(
      `<package><metadata><dc:title>A &amp; B</dc:title></metadata><manifest>
        <item href="a.xhtml" id="a" media-type="application/xhtml+xml"/>
        <item id="b" href="b%201.xhtml" media-type="application/xhtml+xml"></item></manifest>
        <spine page-progression-direction="rtl"><itemref idref="b"/><itemref idref="a"/></spine></package>`,
    );
    expect(opf.spine).toEqual(['b', 'a']);
    expect(opf.manifest.get('b')?.href).toBe('b%201.xhtml');
    expect(opf.rtl).toBe(true);
    expect(opf.title).toBe('A & B');
  });

  it('finds the first img or svg image and ignores remote/data urls', () => {
    expect(firstImageRef('<body><img src="data:x"/><img alt="" src="../i/1.png"/></body>')).toBe(
      '../i/1.png',
    );
    expect(firstImageRef('<svg><image width="1" xlink:href="p.jpg"/></svg>')).toBe('p.jpg');
    expect(firstImageRef('<p>text</p>')).toBeUndefined();
  });

  it('measures visible text only', () => {
    expect(
      textLength(
        '<head><title>long title here</title><style>p{}</style></head><body><p>ab</p> <p>c</p></body>',
      ),
    ).toBe(4);
  });

  it('resolves relative paths with .. and percent-encoding', () => {
    expect(resolveZipPath('OEBPS/xhtml/p.xhtml', '../img/p%20001.png#x')).toBe(
      'OEBPS/img/p 001.png',
    );
    expect(resolveZipPath('OEBPS/c.opf', '/abs/x.png')).toBe('abs/x.png');
  });
});

describe('image-based EPUB analysis', () => {
  it('uses spine order, not file name order, and marks the book as epub + rtl', async () => {
    const a = await analyzeZip(blobSource(FIXTURES['comic-5.epub']!()));
    expect(a.format).toBe('epub');
    expect(a.pages.map((p) => p.entry)).toEqual([
      'OEBPS/img/p 005.png',
      'OEBPS/img/p 004.png',
      'OEBPS/img/p 003.png',
      'OEBPS/img/p 002.png',
      'OEBPS/img/p 001.png',
    ]);
    expect(a.pages.every((p) => p.w === 400 && p.h === 600)).toBe(true);
    expect(isRightToLeftManga(a.comicInfo)).toBe(true);
    expect(a.comicInfo?.title).toBe('Epub & Test');
  });

  it('follows a custom spine order and SVG-wrapped images', async () => {
    const a = await analyzeZip(blobSource(FIXTURES['comic-svg.epub']!()));
    expect(a.pages.map((p) => p.entry)).toEqual([
      'OEBPS/img/p 002.png',
      'OEBPS/img/p 004.png',
      'OEBPS/img/p 001.png',
      'OEBPS/img/p 003.png',
    ]);
    expect(isRightToLeftManga(a.comicInfo)).toBe(false);
  });

  it('rejects a text EPUB (over 30% of pages are prose)', async () => {
    const err = await analyzeZip(blobSource(FIXTURES['text-book.epub']!())).catch((e) => e);
    expect(err).toBeInstanceOf(ArchiveError);
    expect((err as ArchiveError).code).toBe('text-epub');
  });

  it('tolerates a minority of text pages (colophon)', async () => {
    const a = await analyzeZip(blobSource(buildEpub({ pages: 8, textPages: [7] })));
    expect(a.pages).toHaveLength(7);
  });
});
