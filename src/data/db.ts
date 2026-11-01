import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';
import type { Book, Bookmark, Progress, Series, SourceRecord } from '../core/types.ts';

export interface CollectionRecord {
  id: string;
  name: string;
  bookIds: string[];
  seriesIds: string[];
  createdAt: number;
  updatedAt: number;
}
export interface HistoryRecord {
  id?: number;
  bookId: string;
  at: number;
  fromPage: number;
  toPage: number;
  durationSec: number;
}
export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface MangaDB extends DBSchema {
  sources: { key: string; value: SourceRecord };
  books: {
    key: string;
    value: Book;
    indexes: {
      seriesId: string;
      contentKey: string;
      addedAt: number;
      lastReadAt: number;
      titleSort: string;
    };
  };
  series: {
    key: string;
    value: Series;
    indexes: { key: string; nameSort: string; lastReadAt: number };
  };
  progress: { key: string; value: Progress; indexes: { updatedAt: number } };
  bookmarks: { key: string; value: Bookmark; indexes: { bookId: string; createdAt: number } };
  collections: { key: string; value: CollectionRecord; indexes: { name: string } };
  history: { key: number; value: HistoryRecord; indexes: { bookId: string; at: number } };
  pageCache: { key: [string, number]; value: { bookId: string; page: number; data: unknown } };
  settings: { key: string; value: SettingRecord };
}

export const DB_NAME = 'mangareader';
export const DB_VERSION = 1;

type Upgrade = (
  db: IDBPDatabase<MangaDB>,
  tx: IDBPTransaction<MangaDB, StoreNames<MangaDB>[], 'versionchange'>,
) => void;

/** One entry per schema version. Every schema change adds the next number here plus a test. */
export const migrations: Record<number, Upgrade> = {
  1: (db) => {
    db.createObjectStore('sources', { keyPath: 'id' });
    const books = db.createObjectStore('books', { keyPath: 'id' });
    books.createIndex('seriesId', 'seriesId');
    books.createIndex('contentKey', 'contentKey', { unique: true });
    books.createIndex('addedAt', 'addedAt');
    books.createIndex('lastReadAt', 'lastReadAt');
    books.createIndex('titleSort', 'titleSort');
    const series = db.createObjectStore('series', { keyPath: 'id' });
    series.createIndex('key', 'key', { unique: true });
    series.createIndex('nameSort', 'nameSort');
    series.createIndex('lastReadAt', 'lastReadAt');
    const progress = db.createObjectStore('progress', { keyPath: 'bookId' });
    progress.createIndex('updatedAt', 'updatedAt');
    const bm = db.createObjectStore('bookmarks', { keyPath: 'id' });
    bm.createIndex('bookId', 'bookId');
    bm.createIndex('createdAt', 'createdAt');
    const col = db.createObjectStore('collections', { keyPath: 'id' });
    col.createIndex('name', 'name');
    const hist = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
    hist.createIndex('bookId', 'bookId');
    hist.createIndex('at', 'at');
    db.createObjectStore('pageCache', { keyPath: ['bookId', 'page'] });
    db.createObjectStore('settings', { keyPath: 'key' });
  },
};

export function runMigrations(
  db: IDBPDatabase<MangaDB>,
  oldVersion: number,
  newVersion: number,
  tx: IDBPTransaction<MangaDB, StoreNames<MangaDB>[], 'versionchange'>,
): void {
  for (let v = oldVersion + 1; v <= newVersion; v++) migrations[v]?.(db, tx);
}

let dbPromise: Promise<IDBPDatabase<MangaDB>> | null = null;

export function openAppDb(name = DB_NAME): Promise<IDBPDatabase<MangaDB>> {
  return openDB<MangaDB>(name, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, tx) {
      runMigrations(db, oldVersion, newVersion ?? DB_VERSION, tx);
    },
  });
}

export function getDb(): Promise<IDBPDatabase<MangaDB>> {
  dbPromise ??= openAppDb();
  return dbPromise;
}

/** Test hook: swap the shared handle. */
export function setDbForTests(p: Promise<IDBPDatabase<MangaDB>> | null): void {
  dbPromise = p;
}
