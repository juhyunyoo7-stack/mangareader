// Programmatic, deterministic fixture builders (DESIGN section 14). Pure functions returning bytes.
import jpeg from 'jpeg-js';
import {
  drawText,
  encodePng,
  fillRect,
  makeRaster,
  strokeRect,
  textWidth,
  type Raster,
} from './png.ts';
import { readFileSync } from 'node:fs';
import { writePdf } from './pdfwriter.ts';
import { writeRar4Stored, writeRar5Stored } from './rarwriter.ts';
import { writeZip, type ZipEntryIn, type ZipOptions } from './zipwriter.ts';

type RGB = [number, number, number];

export function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Unique, easily sampled colour per page number (used by e2e to identify the shown page). */
export function pageColor(n: number): RGB {
  return hslToRgb((n * 47) % 360, 0.65, 0.45);
}

export function pageRaster(n: number, w: number, h: number): Raster {
  const bg = pageColor(n);
  const r = makeRaster(w, h, bg);
  strokeRect(r, Math.max(2, Math.round(Math.min(w, h) / 60)), [255, 255, 255]);
  const label = String(n + 1);
  const s = Math.max(2, Math.floor(Math.min(w, h) / 10));
  const tw = textWidth(label, s);
  fillRect(
    r,
    Math.round((w - tw) / 2) - s,
    Math.round(h / 2) - s * 3,
    tw + s * 2,
    s * 7,
    [0, 0, 0],
  );
  drawText(
    r,
    label,
    Math.round((w - tw) / 2),
    Math.round(h / 2) - Math.round(s * 2.5),
    s,
    [255, 255, 255],
  );
  return r;
}

export function pagePng(n: number, w = 800, h = 1200): Uint8Array {
  return encodePng(pageRaster(n, w, h));
}

export function pageJpeg(n: number, w = 800, h = 1200): Uint8Array {
  const r = pageRaster(n, w, h);
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = r.data[i * 3]!;
    rgba[i * 4 + 1] = r.data[i * 3 + 1]!;
    rgba[i * 4 + 2] = r.data[i * 3 + 2]!;
    rgba[i * 4 + 3] = 255;
  }
  return new Uint8Array(jpeg.encode({ data: rgba, width: w, height: h }, 80).data);
}

export function name3(i: number, ext = 'png'): string {
  return `${String(i + 1).padStart(3, '0')}.${ext}`;
}

export interface BookSpec {
  pages: number;
  w?: number;
  h?: number;
  /** page index -> [w,h] overrides */
  sizes?: Record<number, [number, number]>;
  dir?: string;
  comicInfo?: string;
  zip?: ZipOptions;
  method?: 0 | 8;
  jpegPages?: number[];
}

export function buildCbz(spec: BookSpec): Uint8Array {
  const entries: ZipEntryIn[] = [];
  const w = spec.w ?? 800;
  const h = spec.h ?? 1200;
  for (let i = 0; i < spec.pages; i++) {
    const [pw, ph] = spec.sizes?.[i] ?? [w, h];
    const isJpeg = spec.jpegPages?.includes(i);
    entries.push({
      name: `${spec.dir ? spec.dir + '/' : ''}${name3(i, isJpeg ? 'jpg' : 'png')}`,
      data: isJpeg ? pageJpeg(i, pw, ph) : pagePng(i, pw, ph),
      method: spec.method ?? 0, // images are already compressed; stored is realistic
    });
  }
  if (spec.comicInfo) {
    entries.push({
      name: 'ComicInfo.xml',
      data: new TextEncoder().encode(spec.comicInfo),
      method: 8,
    });
  }
  return writeZip(entries, spec.zip);
}

export function comicInfo(f: Record<string, string | number>): string {
  const body = Object.entries(f)
    .map(([k, v]) => `  <${k}>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</${k}>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo>\n${body}\n</ComicInfo>\n`;
}

/** 800 wide strips; one very tall page to force tile strips. */
export function buildWebtoon(pages = 50, tallIndex = 10, tallHeight = 30000): Uint8Array {
  const sizes: Record<number, [number, number]> = {};
  for (let i = 0; i < pages; i++) sizes[i] = [800, i === tallIndex ? tallHeight : 1600];
  return buildCbz({ pages, sizes, w: 800, h: 1600 });
}

/** One page larger than the 16 MP canvas cap (5000x5000 = 25 MP). */
export function buildHugePage(): Uint8Array {
  const entries: ZipEntryIn[] = [
    { name: '001.png', data: pagePng(0, 800, 1200), method: 0 },
    { name: '002.png', data: encodePng(hugeRaster(5000, 5000)), method: 0 },
    { name: '003.png', data: pagePng(2, 800, 1200), method: 0 },
  ];
  return writeZip(entries);
}

function hugeRaster(w: number, h: number): Raster {
  const r = pageRaster(1, w, h);
  // colour quadrants + a marker block per quadrant so deep zoom shows distinct content
  fillRect(r, 0, 0, w / 2, h / 2, [200, 40, 40]);
  fillRect(r, w / 2, 0, w / 2, h / 2, [40, 200, 40]);
  fillRect(r, 0, h / 2, w / 2, h / 2, [40, 40, 200]);
  fillRect(r, w / 2, h / 2, w / 2, h / 2, [200, 200, 40]);
  drawText(r, '2', w / 2 - 600, h / 2 - 500, 200, [255, 255, 255]);
  return r;
}

export function seriesBook(label: string, n: number, extra?: string): Uint8Array {
  void label;
  const pages = 3;
  const base = n * 3;
  const entries: ZipEntryIn[] = [];
  for (let i = 0; i < pages; i++) {
    entries.push({ name: name3(i), data: pagePng(base + i, 120, 180), method: 0 });
  }
  if (extra) entries.push({ name: 'ComicInfo.xml', data: new TextEncoder().encode(extra) });
  return writeZip(entries);
}

export const SERIES_BOOKS: { file: string; series: string; volume: number }[] = [
  { file: 'Alpha Saga v01.cbz', series: 'Alpha Saga', volume: 1 },
  { file: 'Alpha Saga v02.cbz', series: 'Alpha Saga', volume: 2 },
  { file: 'Alpha Saga v03.cbz', series: 'Alpha Saga', volume: 3 },
  { file: 'Alpha Saga v04.cbz', series: 'Alpha Saga', volume: 4 },
  { file: '[Scans] Beta Quest Vol.1 (2019).cbz', series: 'Beta Quest', volume: 1 },
  { file: '[Scans] Beta Quest Vol.2 (2019).cbz', series: 'Beta Quest', volume: 2 },
  { file: '[Scans] Beta Quest Vol.3 (2019).cbz', series: 'Beta Quest', volume: 3 },
  { file: 'Gamma Tales 01.cbz', series: 'Gamma Tales', volume: 1 },
  { file: 'Gamma Tales 02.cbz', series: 'Gamma Tales', volume: 2 },
  { file: 'Gamma Tales 03.cbz', series: 'Gamma Tales', volume: 3 },
];

export function buildSeriesBooks(): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  SERIES_BOOKS.forEach((b, i) => {
    out[b.file] = seriesBook(b.series, i);
  });
  return out;
}

/** Hand-encoded Shift-JIS "ページ" = 83 79 81 5B 83 57 */
const SJIS_PAGE = [0x83, 0x79, 0x81, 0x5b, 0x83, 0x57];

export function buildSjis(): Uint8Array {
  const mk = (i: number): ZipEntryIn => ({
    name: '',
    rawName: Uint8Array.from([...SJIS_PAGE, ...new TextEncoder().encode(`00${i + 1}.png`)]),
    data: pagePng(i, 400, 600),
    method: 0,
  });
  return writeZip([mk(0), mk(1), mk(2)], { noUtf8Flag: true });
}

/** EUC-KR / CP949 bytes of "김일": also a valid Shift-JIS byte sequence (the ambiguous case). */
const CP949_KIMIL = [0xb1, 0xe8, 0xc0, 0xcf];

/** A Korean scan set without the UTF-8 flag: ASCII `_cover.jpg` plus 11 pages, like real downloads. */
export function buildCp949(): Uint8Array {
  const enc = new TextEncoder();
  const entries: ZipEntryIn[] = [{ name: '_cover.jpg', data: pageJpeg(0, 300, 420), method: 0 }];
  for (let i = 1; i <= 11; i++) {
    entries.push({
      name: '',
      rawName: Uint8Array.from([
        ...CP949_KIMIL,
        ...enc.encode(`10_${String(i).padStart(2, '0')}.jpg`),
      ]),
      data: pageJpeg(i, 300, 420),
      method: 0,
    });
  }
  return writeZip(entries, { noUtf8Flag: true });
}

export function buildNonAscii(): Uint8Array {
  const e = (name: string, i: number): ZipEntryIn => ({
    name,
    data: pagePng(i, 400, 600),
    method: 0,
  });
  return writeZip([
    e('第01話/ページ 001.png', 0),
    e('第01話/ページ 002.png', 1),
    e('한글폴더/003.png', 2),
    e('emoji 🎉 page 004.png', 3),
  ]);
}

export function buildTraversal(): Uint8Array {
  const e = (name: string, i: number): ZipEntryIn => ({
    name,
    data: pagePng(i, 200, 300),
    method: 0,
  });
  return writeZip([
    e('../../evil.png', 7),
    e('/abs/evil2.png', 8),
    e('..\\win-evil.png', 9),
    e('ok/001.png', 0),
    e('ok/002.png', 1),
    e('__MACOSX/ok/._001.png', 2),
    e('.hidden.png', 3),
    { name: 'Thumbs.db', data: new Uint8Array(10) },
    e('<img src=x onerror=alert(1)>.png', 4),
  ]);
}

export function buildBombRatio(): Uint8Array {
  return writeZip([
    { name: '001.png', data: new Uint8Array(24 * 1024 * 1024), method: 8 },
    { name: '002.png', data: pagePng(1, 100, 100), method: 0 },
  ]);
}

export function buildFakeSize(): Uint8Array {
  return writeZip([
    { name: '001.png', data: pagePng(0, 100, 100), method: 0, fakeUncompressedSize: 3_000_000_000 },
  ]);
}

export function buildEncrypted(): Uint8Array {
  return writeZip([{ name: '001.png', data: pagePng(0, 100, 100), method: 0, encrypted: true }]);
}

export function buildNaturalSort(): Uint8Array {
  // true reading order is 1,2,10; lexicographic order would be 1,10,2
  const names = ['10.png', '2.png', '1.png'];
  const idx: Record<string, number> = { '1.png': 0, '2.png': 1, '10.png': 2 };
  return writeZip(
    names.map((name) => ({ name, data: pagePng(idx[name]!, 200, 300), method: 0 as const })),
  );
}

export function buildNoImages(): Uint8Array {
  return writeZip([{ name: 'readme.txt', data: new TextEncoder().encode('no images here') }]);
}

export interface FixtureSet {
  [file: string]: () => Uint8Array;
}

function rarPages(): { name: string; data: Uint8Array }[] {
  return [0, 1, 2, 3].map((i) => ({ name: name3(i), data: pagePng(i, 300, 450) }));
}

/** Real 7-Zip output committed under tests/fixtures/bin (regenerate with scripts/gen-7z-fixtures.ts). */
const bin7z = (name: string) => () => new Uint8Array(readFileSync(`tests/fixtures/bin/${name}`));

export interface EpubSpec {
  pages: number;
  rtl?: boolean;
  /** spine lists the pages in this order (default: 0..n-1) */
  order?: number[];
  /** page indices whose XHTML carries paragraphs of prose */
  textPages?: number[];
  /** wrap the image in <svg><image> instead of <img> */
  svg?: boolean;
}

/** EPUB 3 with one XHTML per page; image files are named so that natural sort differs from spine order. */
export function buildEpub(spec: EpubSpec): Uint8Array {
  const enc = (t: string) => new TextEncoder().encode(t);
  const n = spec.pages;
  const order = spec.order ?? Array.from({ length: n }, (_, i) => i);
  const entries: ZipEntryIn[] = [
    { name: 'mimetype', data: enc('application/epub+zip'), method: 0 },
    {
      name: 'META-INF/container.xml',
      data: enc(
        '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></container>',
      ),
    },
  ];
  const items: string[] = [];
  const refs: string[] = [];
  for (let i = 0; i < n; i++) {
    const img = `img/p ${String(n - i).padStart(3, '0')}.png`; // reverse alphabetical on purpose
    const body = spec.textPages?.includes(i)
      ? '<p>' + 'Lorem ipsum dolor sit amet. '.repeat(20) + '</p>'
      : spec.svg
        ? `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 600"><image width="400" height="600" xlink:href="../${img.replace(' ', '%20')}"/></svg>`
        : `<img src="../${img.replace(' ', '%20')}" alt=""/>`;
    entries.push({
      name: `OEBPS/xhtml/page${i}.xhtml`,
      data: enc(
        `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>p${i}</title><style>p{margin:0}</style></head><body>${body}</body></html>`,
      ),
    });
    entries.push({ name: `OEBPS/${img}`, data: pagePng(i, 400, 600), method: 0 });
    items.push(`<item id="x${i}" href="xhtml/page${i}.xhtml" media-type="application/xhtml+xml"/>`);
    items.push(`<item id="i${i}" href="${img.replace(' ', '%20')}" media-type="image/png"/>`);
  }
  for (const i of order) refs.push(`<itemref idref="x${i}"/>`);
  entries.push({
    name: 'OEBPS/content.opf',
    data: enc(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Epub &amp; Test</dc:title></metadata><manifest>${items.join('')}</manifest><spine${spec.rtl ? ' page-progression-direction="rtl"' : ''}>${refs.join('')}</spine></package>`,
    ),
  });
  return writeZip(entries);
}

/** 4-page PDF: three 400x600 pt portrait pages and one 600x400 pt landscape page. */
export function buildPdf(padBytes = 0): Uint8Array {
  const sizes: [number, number][] = [
    [400, 600],
    [400, 600],
    [400, 600],
    [600, 400],
  ];
  return writePdf(
    sizes.map(([w, h], i) => ({ w, h, rgb: pageColor(i) })),
    padBytes,
  );
}

/** PNG, then real AVIF and JXL encodes of pages 0/1 (tests/fixtures/bin/page-*.{avif,jxl}). */
export function buildModernFormats(): Uint8Array {
  const f = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/bin/${n}`));
  return writeZip([
    { name: '001.png', data: pagePng(2, 200, 300), method: 0 },
    { name: '002.avif', data: f('page-0.avif'), method: 0 },
    { name: '003.jxl', data: f('page-1.jxl'), method: 0 },
  ]);
}

/** Pages with a 10% / 8% white margin around a solid page-colour block (auto-trim test). */
export function buildMargins(W = 600, H = 900, pages = 4): Uint8Array {
  const entries: ZipEntryIn[] = Array.from({ length: pages }, (_, i) => {
    const r = makeRaster(W, H, [255, 255, 255]);
    fillRect(r, W * 0.1, H * 0.08, W * 0.8, H * 0.84, pageColor(i));
    return { name: name3(i), data: encodePng(r), method: 0 };
  });
  return writeZip(entries);
}

/** Pages of a 2x3 panel grid on white gutters; panel k (LTR reading order) has pageColor(k). */
export const GRID_PANELS: [number, number, number, number][] = [0, 1, 2].flatMap((r) =>
  [0, 1].map(
    (c) => [0.05 + c * 0.48, 0.04 + r * 0.32, 0.42, 0.28] as [number, number, number, number],
  ),
);

export function buildPanelGrid(pages = 2): Uint8Array {
  const W = 600;
  const H = 900;
  const entries: ZipEntryIn[] = Array.from({ length: pages }, (_, i) => {
    const r = makeRaster(W, H, [255, 255, 255]);
    GRID_PANELS.forEach(([x, y, w, h], k) => {
      fillRect(r, x * W, y * H, w * W, h * H, [0, 0, 0]);
      fillRect(r, x * W + 4, y * H + 4, w * W - 8, h * H - 8, pageColor(k));
    });
    return { name: name3(i), data: encodePng(r), method: 0 };
  });
  return writeZip(entries);
}

export const FIXTURES: FixtureSet = {
  'panel-grid.cbz': () => buildPanelGrid(2),
  'margins-big.cbz': () => buildMargins(2400, 3600, 2),
  'margins-4.cbz': buildMargins,
  'modern-formats.cbz': buildModernFormats,
  'pages-4.pdf': buildPdf,
  'comic-5.epub': () => buildEpub({ pages: 5, rtl: true }),
  'comic-svg.epub': () => buildEpub({ pages: 4, svg: true, order: [2, 0, 3, 1] }),
  'text-book.epub': () => buildEpub({ pages: 4, textPages: [0, 1, 2] }),
  'stored-rar5.cbr': () => writeRar5Stored(rarPages()),
  'stored-rar4.cbr': () => writeRar4Stored(rarPages()),
  'solid4.cb7': bin7z('solid4.7z'),
  'plain4.cb7': bin7z('plain4.7z'),
  'encrypted.cb7': bin7z('encrypted.7z'),
  'basic-10.cbz': () => buildCbz({ pages: 10 }),
  'pages-100.cbz': () => buildCbz({ pages: 100, w: 400, h: 600 }),
  'odd-7.cbz': () => buildCbz({ pages: 7, w: 600, h: 900 }),
  'spread-wide.cbz': () => buildCbz({ pages: 10, w: 600, h: 900, sizes: { 5: [1200, 900] } }),
  'rtl-manga.cbz': () =>
    buildCbz({
      pages: 8,
      w: 600,
      h: 900,
      comicInfo: comicInfo({
        Series: 'Right Left',
        Number: 1,
        Manga: 'YesAndRightToLeft',
        Title: 'RTL Test',
      }),
    }),
  'mixed-jpeg.cbz': () => buildCbz({ pages: 4, w: 500, h: 700, jpegPages: [1, 3] }),
  'deflated.cbz': () => buildCbz({ pages: 4, w: 300, h: 400, method: 8 }),
  'zip64.cbz': () => buildCbz({ pages: 4, w: 300, h: 400, zip: { zip64: true } }),
  'datadesc.cbz': () =>
    buildCbz({ pages: 4, w: 300, h: 400, method: 8, zip: { dataDescriptor: true } }),
  'nested.cbz': () => buildCbz({ pages: 4, w: 300, h: 400, dir: 'Vol 1/Ch 1' }),
  'webtoon-50.cbz': () => buildWebtoon(),
  'huge-page.cbz': () => buildHugePage(),
  'nonascii.cbz': buildNonAscii,
  'sjis.cbz': buildSjis,
  'cp949.cbz': buildCp949,
  'traversal.cbz': buildTraversal,
  'natural-sort.cbz': buildNaturalSort,
  'bomb-ratio.cbz': buildBombRatio,
  'fake-size.cbz': buildFakeSize,
  'encrypted.cbz': buildEncrypted,
  'no-images.cbz': buildNoImages,
  'truncated.cbz': () => {
    const b = buildCbz({ pages: 6, w: 300, h: 400 });
    return b.subarray(0, Math.floor(b.length * 0.6));
  },
  'notazip.cbz': () => new TextEncoder().encode('this is not a zip file at all. '.repeat(50)),
};
