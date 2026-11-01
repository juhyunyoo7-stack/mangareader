import { useEffect, useState } from 'preact/hooks';
import { normalizeKey } from '../../core/naming.ts';
import type { Book, Progress, Series } from '../../core/types.ts';
import { getOpfsFile } from '../../data/opfs.ts';
import { listBooks, listProgress, listSeries } from '../../data/repo.ts';
import { libraryVersion } from '../store.ts';

export interface LibraryData {
  loading: boolean;
  books: Book[];
  series: Series[];
  progress: Map<string, Progress>;
}

export function useLibraryData(): LibraryData {
  const [data, setData] = useState<LibraryData>({
    loading: true,
    books: [],
    series: [],
    progress: new Map(),
  });
  const version = libraryVersion.value;
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [books, series, prog] = await Promise.all([listBooks(), listSeries(), listProgress()]);
      if (alive) {
        setData({
          loading: false,
          books,
          series,
          progress: new Map(prog.map((p) => [p.bookId, p])),
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [version]);
  return data;
}

// ---- covers ---------------------------------------------------------------------------------
const coverUrls = new Map<string, Promise<string | null>>();

export function coverUrl(bookId: string): Promise<string | null> {
  let p = coverUrls.get(bookId);
  if (!p) {
    p = getOpfsFile(['thumbs', bookId, 'cover.webp'])
      .then((f) => URL.createObjectURL(f))
      .catch(() => null);
    coverUrls.set(bookId, p);
  }
  return p;
}

export function forgetCover(bookId: string): void {
  const p = coverUrls.get(bookId);
  coverUrls.delete(bookId);
  void p?.then((u) => u && URL.revokeObjectURL(u));
}

// ---- search / sort --------------------------------------------------------------------------
export type SortKey = 'name' | 'recent' | 'added' | 'progress' | 'size';

export interface SearchEntry {
  text: string;
  /** numbers that appear as whole words, plus volume/chapter/number metadata */
  nums: Set<number>;
}

export function buildSearchEntry(b: Book, seriesName: string): SearchEntry {
  const ci = b.comicInfo;
  const text = normalizeKey(
    [b.title, seriesName, b.fileName, ci?.writer, ci?.tags, ci?.genre].filter(Boolean).join(' '),
  );
  const nums = new Set<number>();
  for (const w of text.split(' ')) if (/^\d+$/.test(w)) nums.add(parseInt(w, 10));
  for (const n of [b.volume, b.chapter, b.number]) if (n !== undefined) nums.add(n);
  return { text, nums };
}

/** Text tokens match as substrings; numeric tokens match whole numbers ("2" is not "2019"). */
export function matchesQuery(e: SearchEntry, query: string): boolean {
  const tokens = normalizeKey(query).split(' ').filter(Boolean);
  return tokens.every((t) => (/^\d+$/.test(t) ? e.nums.has(parseInt(t, 10)) : e.text.includes(t)));
}

export function sortBooks(books: Book[], key: SortKey, progress: Map<string, Progress>): Book[] {
  const by = [...books];
  switch (key) {
    case 'name':
      return by.sort((a, b) => a.titleSort.localeCompare(b.titleSort));
    case 'recent':
      return by.sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || b.addedAt - a.addedAt);
    case 'added':
      return by.sort((a, b) => b.addedAt - a.addedAt);
    case 'progress':
      return by.sort(
        (a, b) => (progress.get(b.id)?.percent ?? -1) - (progress.get(a.id)?.percent ?? -1),
      );
    case 'size':
      return by.sort((a, b) => b.size - a.size);
  }
}

export function sortSeries(list: Series[], key: SortKey, books: Book[]): Series[] {
  const sizes = new Map<string, number>();
  const added = new Map<string, number>();
  for (const b of books) {
    sizes.set(b.seriesId, (sizes.get(b.seriesId) ?? 0) + b.size);
    added.set(b.seriesId, Math.max(added.get(b.seriesId) ?? 0, b.addedAt));
  }
  const by = [...list];
  switch (key) {
    case 'name':
      return by.sort((a, b) => a.nameSort.localeCompare(b.nameSort));
    case 'recent':
      return by.sort(
        (a, b) =>
          (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) ||
          (added.get(b.id) ?? 0) - (added.get(a.id) ?? 0),
      );
    case 'added':
      return by.sort((a, b) => (added.get(b.id) ?? 0) - (added.get(a.id) ?? 0));
    case 'size':
      return by.sort((a, b) => (sizes.get(b.id) ?? 0) - (sizes.get(a.id) ?? 0));
    case 'progress':
      return by.sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0));
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}
