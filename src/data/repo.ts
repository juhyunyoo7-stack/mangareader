import { ulid } from '../core/id.ts';
import {
  DEFAULT_PREFS,
  DEFAULT_UI,
  type Book,
  type Bookmark,
  type GlobalPrefs,
  type Progress,
  type ReaderPrefs,
  type Series,
  type UiSettings,
} from '../core/types.ts';
import { titleSortKey } from '../core/naming.ts';
import { getDb } from './db.ts';

// ---- settings -------------------------------------------------------------------------------
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await getDb();
  const rec = await db.get('settings', key);
  return rec ? (rec.value as T) : fallback;
}
export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.put('settings', { key, value });
}
export async function getDeviceId(): Promise<string> {
  const existing = await getSetting<string | null>('deviceId', null);
  if (existing) return existing;
  const id = ulid();
  await setSetting('deviceId', id);
  return id;
}
export async function getGlobalPrefs(): Promise<GlobalPrefs> {
  return { ...DEFAULT_PREFS, ...(await getSetting<Partial<GlobalPrefs>>('global.prefs', {})) };
}
export async function getUiSettings(): Promise<UiSettings> {
  return { ...DEFAULT_UI, ...(await getSetting<Partial<UiSettings>>('ui', {})) };
}

// ---- books ----------------------------------------------------------------------------------
export async function listBooks(): Promise<Book[]> {
  return (await getDb()).getAll('books');
}
export async function getBook(id: string): Promise<Book | undefined> {
  return (await getDb()).get('books', id);
}
export async function getBookByKey(contentKey: string): Promise<Book | undefined> {
  return (await getDb()).getFromIndex('books', 'contentKey', contentKey);
}
export async function putBook(b: Book): Promise<void> {
  await (await getDb()).put('books', b);
}
export async function patchBook(id: string, patch: Partial<Book>): Promise<Book | undefined> {
  const db = await getDb();
  const tx = db.transaction('books', 'readwrite');
  const cur = await tx.store.get(id);
  if (!cur) {
    await tx.done;
    return undefined;
  }
  const next = { ...cur, ...patch };
  await tx.store.put(next);
  await tx.done;
  return next;
}
export async function setBookPrefs(
  id: string,
  prefs: ReaderPrefs,
  overrides?: Book['overrides'],
): Promise<void> {
  await patchBook(id, {
    prefs,
    ...(overrides ? { overrides } : {}),
    prefsUpdatedAt: Date.now(),
  });
}

/** Delete a book and its dependent rows (progress, bookmarks). Series is removed when empty. */
export async function deleteBook(id: string): Promise<void> {
  const db = await getDb();
  const book = await db.get('books', id);
  const tx = db.transaction(['books', 'series', 'progress', 'bookmarks'], 'readwrite');
  await tx.objectStore('books').delete(id);
  await tx.objectStore('progress').delete(id);
  const bms = await tx.objectStore('bookmarks').index('bookId').getAllKeys(id);
  for (const k of bms) await tx.objectStore('bookmarks').delete(k);
  if (book) {
    const left = await tx.objectStore('books').index('seriesId').count(book.seriesId);
    if (left === 0) await tx.objectStore('series').delete(book.seriesId);
  }
  await tx.done;
}

// ---- series ---------------------------------------------------------------------------------
export async function listSeries(): Promise<Series[]> {
  return (await getDb()).getAll('series');
}
export async function getSeries(id: string): Promise<Series | undefined> {
  return (await getDb()).get('series', id);
}
export async function putSeries(s: Series): Promise<void> {
  await (await getDb()).put('series', s);
}
export async function booksOfSeries(seriesId: string): Promise<Book[]> {
  const list = await (await getDb()).getAllFromIndex('books', 'seriesId', seriesId);
  return list.sort(
    (a, b) =>
      (a.volume ?? a.number ?? a.chapter ?? Infinity) -
        (b.volume ?? b.number ?? b.chapter ?? Infinity) || a.titleSort.localeCompare(b.titleSort),
  );
}

/** Insert a book, creating or reusing its series, in one transaction. */
export async function addBook(
  book: Omit<Book, 'seriesId'>,
  series: { key: string; name: string; prefs?: ReaderPrefs },
): Promise<Book> {
  const db = await getDb();
  const tx = db.transaction(['books', 'series'], 'readwrite');
  tx.done.catch(() => undefined); // a duplicate content key aborts the tx; the add() rejection is the signal
  let s = await tx.objectStore('series').index('key').get(series.key);
  if (!s) {
    s = {
      id: ulid(),
      key: series.key,
      name: series.name,
      nameSort: titleSortKey(series.name),
      prefs: series.prefs ?? {},
      addedAt: Date.now(),
    };
  }
  s.coverBookId ??= book.id;
  await tx.objectStore('series').put(s);
  const full: Book = { ...book, seriesId: s.id };
  await tx.objectStore('books').add(full);
  await tx.done;
  return full;
}

// ---- progress -------------------------------------------------------------------------------
export async function getProgress(bookId: string): Promise<Progress | undefined> {
  return (await getDb()).get('progress', bookId);
}
export async function listProgress(): Promise<Progress[]> {
  return (await getDb()).getAll('progress');
}

export async function saveProgress(
  book: Book,
  page: number,
  webtoonOffset: number | undefined,
  deviceId: string,
): Promise<Progress> {
  const db = await getDb();
  const finished = page >= book.pageCount - 1;
  const now = Date.now();
  const p: Progress = {
    bookId: book.id,
    contentKey: book.contentKey,
    page,
    pageCount: book.pageCount,
    percent: book.pageCount > 1 ? Math.round((page / (book.pageCount - 1)) * 100) : 100,
    webtoonOffset,
    finished,
    updatedAt: now,
    deviceId,
  };
  const tx = db.transaction(['progress', 'books', 'series'], 'readwrite');
  const prev = await tx.objectStore('progress').get(book.id);
  // a finished flag is sticky until the reader goes back to the first half
  if (prev?.finished && !finished && page > book.pageCount / 2) p.finished = true;
  await tx.objectStore('progress').put(p);
  const b = await tx.objectStore('books').get(book.id);
  if (b) {
    b.lastReadAt = now;
    b.status = p.finished
      ? 'read'
      : page > 0
        ? 'reading'
        : b.status === 'unread'
          ? 'unread'
          : 'reading';
    await tx.objectStore('books').put(b);
    const s = await tx.objectStore('series').get(b.seriesId);
    if (s) {
      s.lastReadAt = now;
      await tx.objectStore('series').put(s);
    }
  }
  await tx.done;
  return p;
}

// ---- bookmarks ------------------------------------------------------------------------------
export async function listBookmarks(bookId: string): Promise<Bookmark[]> {
  const all = await (await getDb()).getAllFromIndex('bookmarks', 'bookId', bookId);
  return all.filter((b) => !b.deleted).sort((a, b) => a.page - b.page);
}
export async function addBookmark(book: Book, page: number, note?: string): Promise<Bookmark> {
  const now = Date.now();
  const bm: Bookmark = {
    id: ulid(),
    bookId: book.id,
    contentKey: book.contentKey,
    page,
    note,
    createdAt: now,
    updatedAt: now,
  };
  await (await getDb()).put('bookmarks', bm);
  return bm;
}
/** Tombstone (kept for sync) rather than delete. */
export async function removeBookmark(id: string): Promise<void> {
  const db = await getDb();
  const bm = await db.get('bookmarks', id);
  if (bm) await db.put('bookmarks', { ...bm, deleted: true, updatedAt: Date.now() });
}
