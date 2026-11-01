import type { ComicInfo } from './types.ts';

const MAX_XML = 1024 * 1024;

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
function safeChar(cp: number): string {
  try {
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  } catch {
    return '';
  }
}

function tag(xml: string, name: string): string | undefined {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i');
  const m = re.exec(xml);
  if (!m) return undefined;
  let v = m[1]!.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(v);
  if (cdata) v = cdata[1]!;
  v = decodeEntities(v).trim();
  return v === '' ? undefined : v;
}

function attr(src: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(src);
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : undefined;
}

/** Tolerant ComicInfo.xml reader (no DOM so it runs in workers and Node). Unknown fields ignored. */
export function parseComicInfo(xmlText: string): ComicInfo | undefined {
  if (xmlText.length > MAX_XML || !/<ComicInfo\b/i.test(xmlText)) return undefined;
  const xml = xmlText.replace(/<!--[\s\S]*?-->/g, '');
  const info: ComicInfo = {};
  const set = <K extends keyof ComicInfo>(k: K, v: ComicInfo[K] | undefined) => {
    if (v !== undefined) info[k] = v;
  };
  set('series', tag(xml, 'Series'));
  set('number', tag(xml, 'Number'));
  set('volume', tag(xml, 'Volume'));
  set('title', tag(xml, 'Title'));
  set('summary', tag(xml, 'Summary'));
  set('writer', tag(xml, 'Writer'));
  set('penciller', tag(xml, 'Penciller'));
  set('genre', tag(xml, 'Genre'));
  set('tags', tag(xml, 'Tags'));
  set('manga', tag(xml, 'Manga'));
  set('languageISO', tag(xml, 'LanguageISO'));
  const pc = tag(xml, 'PageCount');
  if (pc && /^\d+$/.test(pc)) info.pageCount = parseInt(pc, 10);
  const pagesBlock = /<Pages\b[^>]*>([\s\S]*?)<\/Pages>/i.exec(xml)?.[1];
  if (pagesBlock) {
    const pages: NonNullable<ComicInfo['pages']> = [];
    for (const m of pagesBlock.matchAll(/<Page\b([^>]*?)\/?>/gi)) {
      const img = attr(m[1]!, 'Image');
      if (img === undefined || !/^\d+$/.test(img)) continue;
      pages.push({
        image: parseInt(img, 10),
        type: attr(m[1]!, 'Type'),
        doublePage: attr(m[1]!, 'DoublePage')?.toLowerCase() === 'true',
      });
      if (pages.length >= 20000) break;
    }
    if (pages.length) info.pages = pages;
  }
  return info;
}

export function isRightToLeftManga(info?: ComicInfo): boolean {
  return info?.manga?.toLowerCase() === 'yesandrighttoleft';
}
