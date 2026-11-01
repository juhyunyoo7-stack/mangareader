import { describe, expect, it } from 'vitest';
import { parseComicInfo, isRightToLeftManga } from '../../src/core/comicinfo.ts';
import { normalizeKey, parseFileName, titleSortKey } from '../../src/core/naming.ts';

// [file name, series, volume, chapter, number]
type Row = [string, string, number | undefined, number | undefined, number | undefined];
const rows: Row[] = [
  ['Alpha Saga v01.cbz', 'Alpha Saga', 1, undefined, undefined],
  ['Alpha Saga v12.cbz', 'Alpha Saga', 12, undefined, undefined],
  ['[Scans] Beta Quest Vol.2 (2019).cbz', 'Beta Quest', 2, undefined, undefined],
  ['Gamma Tales 03.cbz', 'Gamma Tales', 3, undefined, undefined],
  ['One Piece v105 (2023) (Digital) (Shueisha).cbz', 'One Piece', 105, undefined, undefined],
  ['One Piece - Volume 7.cbz', 'One Piece', 7, undefined, undefined],
  ['One_Piece_v08.cbz', 'One Piece', 8, undefined, undefined],
  ['Berserk c012.cbz', 'Berserk', undefined, 12, undefined],
  ['Berserk Ch.12.5.cbz', 'Berserk', undefined, 12.5, undefined],
  ['Berserk Chapter 100.cbz', 'Berserk', undefined, 100, undefined],
  ['Bleach v03 c021.cbz', 'Bleach', 3, 21, undefined],
  ['Spider-Man #12.cbz', 'Spider-Man', undefined, undefined, 12],
  ['Naruto 072.cbz', 'Naruto', 72, undefined, undefined],
  ['Naruto - 072.cbz', 'Naruto', 72, undefined, undefined],
  ['Naruto_72.cbz', 'Naruto', 72, undefined, undefined],
  ['20th Century Boys 05.cbz', '20th Century Boys', 5, undefined, undefined],
  ['Mob Psycho 100 v03.cbz', 'Mob Psycho 100', 3, undefined, undefined],
  ['Re:Zero 3.cbz', 'Re:Zero', 3, undefined, undefined],
  ['Dr. Stone v1.cbz', 'Dr. Stone', 1, undefined, undefined],
  ['Dr. Stone v20.cbz', 'Dr. Stone', 20, undefined, undefined],
  ['Some.Title.v01.cbz', 'Some Title', 1, undefined, undefined],
  ['Some.Title.Vol.02.cbz', 'Some Title', 2, undefined, undefined],
  ['鬼滅の刃 第5巻.cbz', '鬼滅の刃', 5, undefined, undefined],
  ['鬼滅の刃 5巻.cbz', '鬼滅の刃', 5, undefined, undefined],
  ['鬼滅の刃_第12巻.cbz', '鬼滅の刃', 12, undefined, undefined],
  ['[一般コミック] 進撃の巨人 第3巻.cbz', '進撃の巨人', 3, undefined, undefined],
  ['進撃の巨人 第10話.cbz', '進撃の巨人', undefined, 10, undefined],
  ['나 혼자만 레벨업 3권.cbz', '나 혼자만 레벨업', 3, undefined, undefined],
  ['나 혼자만 레벨업 12화.cbz', '나 혼자만 레벨업', undefined, 12, undefined],
  ['[Group] 원피스 07권 [Digital].cbz', '원피스', 7, undefined, undefined],
  ['ワンピース 第100巻.zip', 'ワンピース', 100, undefined, undefined],
  ['Vinland Saga, Vol. 4.cbz', 'Vinland Saga', 4, undefined, undefined],
  ['Vinland Saga Vol 04 (2020) [1r0n].cbz', 'Vinland Saga', 4, undefined, undefined],
  ['Akira Volume 1.cbz', 'Akira', 1, undefined, undefined],
  ['Akira volume 06.cbr', 'Akira', 6, undefined, undefined],
  ['Tintin Tome 3.cbz', 'Tintin', 3, undefined, undefined],
  ['Hunter x Hunter v36.pdf', 'Hunter x Hunter', 36, undefined, undefined],
  ['Hunter x Hunter v36.epub', 'Hunter x Hunter', 36, undefined, undefined],
  [
    'Fruits Basket - v01 (2004) (Digital) (danke-Empire).cbz',
    'Fruits Basket',
    1,
    undefined,
    undefined,
  ],
  ['Chainsaw Man v11 [Kodansha].cbz', 'Chainsaw Man', 11, undefined, undefined],
  ['【Group】Title 2.cbz', 'Title', 2, undefined, undefined],
  ['Title（Digital） v3.cbz', 'Title', 3, undefined, undefined],
  ['Title {HQ} v3.cbz', 'Title', 3, undefined, undefined],
  ['Fullmetal Alchemist c001-005.cbz', 'Fullmetal Alchemist', undefined, 1, undefined],
  ['Batman #001 (2011).cbz', 'Batman', undefined, undefined, 1],
  ['Batman 001 (2011).cbz', 'Batman', 1, undefined, undefined],
  ['Saga - v03.cbz', 'Saga', 3, undefined, undefined],
  ['Saga v3.5.cbz', 'Saga', 3.5, undefined, undefined],
  ['The Walking Dead v01 - Days Gone Bye.cbz', 'The Walking Dead', 1, undefined, undefined],
  ['Oyasumi Punpun v13.cbz', 'Oyasumi Punpun', 13, undefined, undefined],
  ['no number here.cbz', 'no number here', undefined, undefined, undefined],
  ['SingleWord.cbz', 'SingleWord', undefined, undefined, undefined],
  ['100.cbz', '100', undefined, undefined, undefined],
  ['v01.cbz', 'v01', 1, undefined, undefined],
  ['Vol 3.cbz', 'Vol 3', 3, undefined, undefined],
  ['C.O.D.E. v1.cbz', 'C.O.D.E', 1, undefined, undefined],
  ['Kaguya-sama Love is War v05.cbz', 'Kaguya-sama Love is War', 5, undefined, undefined],
  ['Kaguya-sama - Love Is War - Vol. 5.cbz', 'Kaguya-sama - Love Is War', 5, undefined, undefined],
  ['Tokyo Ghoul:re v09.cbz', 'Tokyo Ghoul:re', 9, undefined, undefined],
  ['Ranma 1／2 v02.cbz', 'Ranma 1／2', 2, undefined, undefined],
  ['Манга Том 1.cbz', 'Манга Том', 1, undefined, undefined],
  ['Comic  with   spaces   v04.cbz', 'Comic with spaces', 4, undefined, undefined],
  ['Dragon Ball Z (Color) v010.cbz', 'Dragon Ball Z', 10, undefined, undefined],
  [
    'C:\\books\\Folder\\Delicious in Dungeon v02.cbz',
    'Delicious in Dungeon',
    2,
    undefined,
    undefined,
  ],
  ['/home/u/Dandadan v09.cbz', 'Dandadan', 9, undefined, undefined],
  ['Blue Lock v01 (digital-Empire).cbz', 'Blue Lock', 1, undefined, undefined],
  ['Eden Ch 7.cbz', 'Eden', undefined, 7, undefined],
  ['Eden c7.cbz', 'Eden', undefined, 7, undefined],
];

describe('parseFileName', () => {
  it.each(rows)('%s', (file, series, volume, chapter, number) => {
    const p = parseFileName(file);
    expect(p.series).toBe(series);
    expect(p.volume).toBe(volume);
    expect(p.chapter).toBe(chapter);
    expect(p.number).toBe(number);
  });
  it('has at least 60 cases', () => expect(rows.length).toBeGreaterThanOrEqual(60));
  it('series key folds width, case and punctuation', () => {
    expect(parseFileName('ＡＢＣ　Story v1.cbz').seriesKey).toBe(
      parseFileName('abc story v2.cbz').seriesKey,
    );
    expect(normalizeKey('Re:Zero - Starting!')).toBe('re zero starting');
  });
  it('folder hint wins for series', () => {
    const p = parseFileName('001.cbz', { folderSeries: 'My Series' });
    expect(p.series).toBe('My Series');
    expect(parseFileName('v02.cbz', { folderSeries: 'My Series' })).toMatchObject({
      series: 'My Series',
      volume: 2,
    });
  });
  it('title sort keys sort numbers naturally', () => {
    const a = ['x v10', 'x v2', 'x v1'].map(titleSortKey).sort();
    expect(a).toEqual(['x v000001', 'x v000002', 'x v000010']);
  });
});

describe('parseComicInfo', () => {
  const xml = `<?xml version="1.0"?>
<ComicInfo xmlns:xsi="x">
  <Title>A &amp; B &lt;3</Title><Series>My   Series</Series><Number>3</Number><Volume>2</Volume>
  <Summary><![CDATA[Some <b>text</b> & more]]></Summary>
  <Writer>Someone</Writer><Manga>YesAndRightToLeft</Manga><PageCount>3</PageCount>
  <!-- <Series>Commented</Series> -->
  <Unknown>ignored</Unknown>
  <Pages>
    <Page Image="0" Type="FrontCover" />
    <Page Image="1" DoublePage="true" />
    <Page Image='2' Type="Story"></Page>
  </Pages>
</ComicInfo>`;
  it('parses fields, entities, CDATA, comments, pages', () => {
    const c = parseComicInfo(xml)!;
    expect(c.title).toBe('A & B <3');
    expect(c.series).toBe('My   Series');
    expect(c.number).toBe('3');
    expect(c.volume).toBe('2');
    expect(c.summary).toBe('Some <b>text</b> & more');
    expect(c.pageCount).toBe(3);
    expect(c.pages).toEqual([
      { image: 0, type: 'FrontCover', doublePage: false },
      { image: 1, type: undefined, doublePage: true },
      { image: 2, type: 'Story', doublePage: false },
    ]);
    expect(isRightToLeftManga(c)).toBe(true);
    expect('unknown' in c).toBe(false);
  });
  it('rejects non-ComicInfo and oversized input', () => {
    expect(parseComicInfo('<html></html>')).toBeUndefined();
    expect(
      parseComicInfo('<ComicInfo>' + 'x'.repeat(2 * 1024 * 1024) + '</ComicInfo>'),
    ).toBeUndefined();
  });
  it('tolerates garbage numeric entities and empty fields', () => {
    const c = parseComicInfo(
      '<ComicInfo><Title>&#99999999999;ok&#x41;</Title><Series></Series></ComicInfo>',
    )!;
    expect(c.title).toBe('okA');
    expect(c.series).toBeUndefined();
  });
});

import { buildSearchEntry, matchesQuery } from '../../src/app/library/data.ts';
import type { Book } from '../../src/core/types.ts';

describe('library search', () => {
  const book = (title: string, fileName: string, volume?: number): Book =>
    ({ title, fileName, volume, titleSort: title }) as unknown as Book;
  const e = buildSearchEntry(
    book('Beta Quest Vol.2', '[Scans] Beta Quest Vol.2 (2019).cbz', 2),
    'Beta Quest',
  );
  it('substring tokens and whole-number tokens', () => {
    expect(matchesQuery(e, 'vol 2')).toBe(true);
    expect(matchesQuery(e, 'beta')).toBe(true);
    expect(matchesQuery(e, 'quest vol')).toBe(true);
    expect(matchesQuery(e, '2019')).toBe(true);
    expect(matchesQuery(e, 'vol 3')).toBe(false);
    expect(matchesQuery(e, 'gamma')).toBe(false);
  });
  it('"2" does not match 2019 alone', () => {
    const o = buildSearchEntry(
      book('Beta Quest Vol.1', '[Scans] Beta Quest Vol.1 (2019).cbz', 1),
      'Beta Quest',
    );
    expect(matchesQuery(o, 'vol 2')).toBe(false);
    expect(matchesQuery(o, 'vol 1')).toBe(true);
  });
  it('volume metadata matches (v02 file name)', () => {
    const v = buildSearchEntry(book('Alpha Saga v02', 'Alpha Saga v02.cbz', 2), 'Alpha Saga');
    expect(matchesQuery(v, 'alpha 2')).toBe(true);
    expect(matchesQuery(v, 'alpha 12')).toBe(false);
  });
  it('width/case folding and CJK', () => {
    const k = buildSearchEntry(book('鬼滅の刃 第5巻', '鬼滅の刃 第5巻.cbz', 5), '鬼滅の刃');
    expect(matchesQuery(k, '鬼滅')).toBe(true);
    expect(matchesQuery(buildSearchEntry(book('ＡＢＣ', 'abc.cbz'), 'ＡＢＣ'), 'abc')).toBe(true);
  });
  it('empty query matches everything', () => expect(matchesQuery(e, '')).toBe(true));
  it('10k books search in < 50 ms', () => {
    const entries = Array.from({ length: 10_000 }, (_, i) =>
      buildSearchEntry(
        book(`Series ${i % 300} Vol.${i % 40}`, `Series ${i % 300} Vol.${i % 40}.cbz`, i % 40),
        `Series ${i % 300}`,
      ),
    );
    const t0 = performance.now();
    const n = entries.filter((x) => matchesQuery(x, 'series 17 vol 17')).length;
    expect(performance.now() - t0).toBeLessThan(50);
    expect(n).toBeGreaterThan(0);
  });
});
