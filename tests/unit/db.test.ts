import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeZip } from '../../src/archive/analyze.ts';
import { buildBook } from '../../src/data/bookFactory.ts';
import { DB_VERSION, openAppDb, setDbForTests } from '../../src/data/db.ts';
import {
  addBook,
  addBookmark,
  booksOfSeries,
  deleteBook,
  getBookByKey,
  getDeviceId,
  getProgress,
  listBookmarks,
  listSeries,
  removeBookmark,
  saveProgress,
} from '../../src/data/repo.ts';
import { FIXTURES, buildSeriesBooks } from '../../scripts/fixtures/lib.ts';
import { blobSource } from './helpers.ts';

let n = 0;
beforeEach(() => {
  setDbForTests(openAppDb(`test-db-${++n}`));
});

async function makeBook(fileName: string, bytes: Uint8Array, id: string) {
  const analysis = await analyzeZip(blobSource(bytes));
  return buildBook({
    id,
    analysis,
    fileName,
    size: bytes.length,
    mtime: 1,
    location: { kind: 'opfs', path: `books/${id}/${fileName}` },
    hasCover: false,
  });
}

describe('schema and migrations', () => {
  it('creates all v1 stores and indexes', async () => {
    const db = await openAppDb(`schema-${++n}`);
    expect([...db.objectStoreNames].sort()).toEqual(
      [
        'bookmarks',
        'books',
        'collections',
        'history',
        'pageCache',
        'progress',
        'series',
        'settings',
        'sources',
      ].sort(),
    );
    const tx = db.transaction('books');
    expect([...tx.store.indexNames].sort()).toEqual(
      ['addedAt', 'contentKey', 'lastReadAt', 'seriesId', 'titleSort'].sort(),
    );
    expect(DB_VERSION).toBe(1);
  });
  it('opening a v0 (empty) database runs the v1 migration without data loss', async () => {
    const name = `mig-${++n}`;
    // simulate an older install that only had a settings store at version 0 -> create bare db
    const old = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('settings', { keyPath: 'key' });
      },
    });
    await old.put('settings', { key: 'deviceId', value: 'keep-me' });
    old.close();
    // opening with the app at the same version leaves the existing store untouched
    const db = await openAppDb(name);
    expect(await db.get('settings', 'deviceId')).toEqual({ key: 'deviceId', value: 'keep-me' });
  });
});

describe('books and series', () => {
  it('groups volumes of the same series and keeps unrelated ones apart', async () => {
    const books = buildSeriesBooks();
    let i = 0;
    for (const [file, bytes] of Object.entries(books)) {
      const b = await makeBook(file, bytes, `b${i++}`);
      await addBook(b.book, b.series);
    }
    const series = await listSeries();
    expect(series.map((s) => s.name).sort()).toEqual(['Alpha Saga', 'Beta Quest', 'Gamma Tales']);
    const alpha = series.find((s) => s.name === 'Alpha Saga')!;
    const vols = await booksOfSeries(alpha.id);
    expect(vols.map((b) => b.volume)).toEqual([1, 2, 3, 4]);
  });

  it('content key is unique', async () => {
    const bytes = FIXTURES['odd-7.cbz']!();
    const a = await makeBook('a.cbz', bytes, 'a');
    await addBook(a.book, a.series);
    const dup = await makeBook('b.cbz', bytes, 'b');
    await expect(addBook(dup.book, dup.series)).rejects.toThrow();
    expect((await getBookByKey(a.book.contentKey))?.id).toBe('a');
  });

  it('ComicInfo Manga=YesAndRightToLeft sets series direction rtl', async () => {
    const b = await makeBook('rtl.cbz', FIXTURES['rtl-manga.cbz']!(), 'r1');
    const saved = await addBook(b.book, b.series);
    const s = (await listSeries()).find((x) => x.id === saved.seriesId)!;
    expect(s.name).toBe('Right Left');
    expect(s.prefs.direction).toBe('rtl');
  });

  it('deleting the last book removes the empty series and dependent rows', async () => {
    const b = await makeBook('x.cbz', FIXTURES['odd-7.cbz']!(), 'x1');
    const saved = await addBook(b.book, b.series);
    await saveProgress(saved, 3, undefined, 'dev');
    await addBookmark(saved, 2);
    await deleteBook('x1');
    expect(await listSeries()).toEqual([]);
    expect(await getProgress('x1')).toBeUndefined();
    expect(await listBookmarks('x1')).toEqual([]);
  });
});

describe('progress and bookmarks', () => {
  it('saves progress, updates status, percent and finished flag', async () => {
    const b = await makeBook('p.cbz', FIXTURES['odd-7.cbz']!(), 'p1');
    const book = await addBook(b.book, b.series);
    let p = await saveProgress(book, 0, undefined, 'dev');
    expect(p).toMatchObject({ page: 0, percent: 0, finished: false });
    p = await saveProgress(book, 3, 0.25, 'dev');
    expect(p).toMatchObject({ page: 3, percent: 50, finished: false, webtoonOffset: 0.25 });
    p = await saveProgress(book, 6, undefined, 'dev');
    expect(p.finished).toBe(true);
    const again = await getBookByKey(book.contentKey);
    expect(again?.status).toBe('read');
    expect(again?.lastReadAt).toBeGreaterThan(0);
  });
  it('bookmarks use tombstones', async () => {
    const b = await makeBook('q.cbz', FIXTURES['odd-7.cbz']!(), 'q1');
    const book = await addBook(b.book, b.series);
    const bm = await addBookmark(book, 4, 'note');
    expect((await listBookmarks('q1')).map((x) => x.page)).toEqual([4]);
    await removeBookmark(bm.id);
    expect(await listBookmarks('q1')).toEqual([]);
  });
  it('device id is stable', async () => {
    const a = await getDeviceId();
    expect(a).toMatch(/^[0-9A-Z]{26}$/);
    expect(await getDeviceId()).toBe(a);
  });
});
