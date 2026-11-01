import type { Analysis } from '../archive/analyze.ts';
import { isRightToLeftManga } from '../core/comicinfo.ts';
import { normalizeKey, parseFileName, titleSortKey } from '../core/naming.ts';
import type { Book, BookLocation, ReaderPrefs } from '../core/types.ts';

export interface BuiltBook {
  book: Omit<Book, 'seriesId'>;
  series: { key: string; name: string; prefs: ReaderPrefs };
}

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

export function buildBook(a: {
  id: string;
  analysis: Analysis;
  fileName: string;
  size: number;
  mtime: number;
  location: BookLocation;
  folderSeries?: string;
  hasCover: boolean;
}): BuiltBook {
  const { analysis, fileName } = a;
  const parsed = parseFileName(fileName, { folderSeries: a.folderSeries });
  const ci = analysis.comicInfo;
  const seriesName = ci?.series?.trim() || parsed.series;
  const key = normalizeKey(seriesName) || normalizeKey(parsed.title) || a.id;
  const title = ci?.title?.trim() || parsed.title;
  const now = Date.now();
  const prefs: ReaderPrefs = isRightToLeftManga(ci) ? { direction: 'rtl' } : {};
  return {
    book: {
      id: a.id,
      contentKey: analysis.contentKey,
      location: a.location,
      fileName,
      size: a.size,
      mtime: a.mtime,
      format: analysis.format,
      pageCount: analysis.pages.length,
      pages: analysis.pages,
      title,
      titleSort: titleSortKey(title),
      volume: num(ci?.volume) ?? parsed.volume,
      chapter: parsed.chapter,
      number: num(ci?.number) ?? parsed.number,
      comicInfo: ci,
      hasCover: a.hasCover,
      prefs: {},
      overrides: [],
      prefsUpdatedAt: 0,
      status: 'unread',
      addedAt: now,
    },
    series: { key, name: seriesName, prefs },
  };
}
