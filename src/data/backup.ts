import type { Book, Bookmark, Progress } from '../core/types.ts';
import { emptyState, mergeState, validateState, type StateDoc } from '../core/syncMerge.ts';
import { getDb } from './db.ts';
import { getDeviceId, getSetting, listBooks, setSetting } from './repo.ts';
import { S } from '../strings.ts';

const PENDING_KEY = 'pendingState';
const LAST_BACKUP_KEY = 'lastBackupAt';
const FIRST_RUN_KEY = 'firstRunAt';
export const BACKUP_REMINDER_DAYS = 14;
const DAY_MS = 86_400_000;

/** Snapshot of everything portable on this device, keyed by contentKey. */
export async function exportState(now = Date.now()): Promise<StateDoc> {
  const db = await getDb();
  const deviceId = await getDeviceId();
  const doc = emptyState(deviceId, new Date(now).toISOString());
  const books = await listBooks();
  const byId = new Map(books.map((b) => [b.id, b]));
  const series = new Map((await db.getAll('series')).map((s) => [s.id, s]));
  for (const b of books) {
    doc.books.push({
      contentKey: b.contentKey,
      title: b.title,
      series: series.get(b.seriesId)?.name ?? '',
      fileName: b.fileName,
      size: b.size,
    });
    if (Object.keys(b.prefs).length > 0 || b.overrides.length > 0) {
      doc.bookPrefs.push({
        contentKey: b.contentKey,
        prefs: b.prefs,
        overrides: b.overrides,
        updatedAt: b.prefsUpdatedAt,
        deviceId,
      });
    }
  }
  for (const s of series.values()) {
    if (Object.keys(s.prefs).length > 0) {
      doc.seriesPrefs.push({
        seriesKey: s.key,
        name: s.name,
        prefs: s.prefs,
        updatedAt: s.lastReadAt ?? s.addedAt,
        deviceId,
      });
    }
  }
  for (const p of await db.getAll('progress')) {
    if (!byId.has(p.bookId)) continue;
    const { bookId: _b, ...rest } = p;
    doc.progress.push(rest);
  }
  for (const bm of await db.getAll('bookmarks')) {
    if (!byId.has(bm.bookId)) continue;
    const { bookId: _b, ...rest } = bm;
    doc.bookmarks.push({ ...rest, deviceId });
  }
  for (const c of await db.getAll('collections')) {
    doc.collections.push({
      id: c.id,
      name: c.name,
      bookKeys: c.bookIds.map((id) => byId.get(id)?.contentKey).filter((k): k is string => !!k),
      seriesKeys: c.seriesIds.map((id) => series.get(id)?.key).filter((k): k is string => !!k),
      updatedAt: c.updatedAt,
      deviceId,
    });
  }
  return doc;
}

export function stateFileName(now = new Date()): string {
  return `mangareader-state-${now.toISOString().slice(0, 10)}.json`;
}

/** Triggers a browser download of the state file and records the backup time. */
export async function downloadState(): Promise<void> {
  const doc = await exportState();
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = stateFileName();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  await setSetting(LAST_BACKUP_KEY, Date.now());
}

export interface ImportSummary {
  booksMatched: number;
  booksPending: number;
}

/** Applies the record set of one book from a state document; newer-wins per record. */
async function applyDocToBook(doc: StateDoc, book: Book): Promise<void> {
  const db = await getDb();
  const key = book.contentKey;
  const prog = doc.progress.find((p) => p.contentKey === key);
  const bms = doc.bookmarks.filter((b) => b.contentKey === key);
  const bp = doc.bookPrefs.find((p) => p.contentKey === key);
  if (!prog && bms.length === 0 && !bp) return;
  const tx = db.transaction(['progress', 'bookmarks', 'books'], 'readwrite');
  const cur = await tx.objectStore('books').get(book.id);
  if (!cur) {
    await tx.done;
    return;
  }
  if (prog) {
    const local = await tx.objectStore('progress').get(book.id);
    if (!local || prog.updatedAt > local.updatedAt) {
      const rec: Progress = {
        ...prog,
        bookId: book.id,
        pageCount: cur.pageCount,
        page: Math.min(prog.page, cur.pageCount - 1),
      };
      await tx.objectStore('progress').put(rec);
      cur.status = rec.finished ? 'read' : rec.page > 0 ? 'reading' : cur.status;
      cur.lastReadAt = Math.max(cur.lastReadAt ?? 0, prog.updatedAt);
    }
  }
  for (const bm of bms) {
    const local = await tx.objectStore('bookmarks').get(bm.id);
    if (!local || bm.updatedAt > local.updatedAt) {
      const rec: Bookmark = { ...bm, bookId: book.id };
      await tx.objectStore('bookmarks').put(rec);
    }
  }
  if (bp && bp.updatedAt > cur.prefsUpdatedAt) {
    cur.prefs = bp.prefs;
    cur.overrides = bp.overrides.filter((o) => o.index < cur.pageCount);
    cur.prefsUpdatedAt = bp.updatedAt;
  }
  await tx.objectStore('books').put(cur);
  await tx.done;
}

/** Merge an untrusted state document into this device: applied now to known books, kept pending for books imported later. */
export async function importState(raw: unknown): Promise<ImportSummary> {
  const incoming = validateState(raw);
  const prev = await getSetting<StateDoc | null>(PENDING_KEY, null);
  const pending = prev ? mergeState(prev, incoming) : incoming;
  const books = await listBooks();
  const known = new Set(books.map((b) => b.contentKey));
  for (const b of books) await applyDocToBook(pending, b);
  // series preferences apply by normalised key where the local series has none yet
  const db = await getDb();
  for (const sp of pending.seriesPrefs) {
    const s = await db.getFromIndex('series', 'key', sp.seriesKey);
    if (s && Object.keys(s.prefs).length === 0) await db.put('series', { ...s, prefs: sp.prefs });
  }
  await setSetting(PENDING_KEY, pending);
  await setSetting(LAST_BACKUP_KEY, Date.now());
  return {
    booksMatched: pending.books.filter((b) => known.has(b.contentKey)).length,
    booksPending: pending.books.filter((b) => !known.has(b.contentKey)).length,
  };
}

export async function importStateFile(file: File): Promise<ImportSummary> {
  if (file.size > 64 * 1024 * 1024) throw new Error(S.stateTooLarge);
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error(S.stateNotOurs);
  }
  return importState(raw);
}

/** Called after a book is added: restores progress/bookmarks/prefs imported earlier for its contentKey. */
export async function applyPendingState(book: Book): Promise<void> {
  const pending = await getSetting<StateDoc | null>(PENDING_KEY, null);
  if (!pending) return;
  await applyDocToBook(pending, book);
}

export async function clearPendingState(): Promise<void> {
  await setSetting(PENDING_KEY, null);
}

/** True when there are books and no backup/sync happened for 14 days. */
export async function isBackupDue(now = Date.now()): Promise<boolean> {
  const first = await getSetting<number | null>(FIRST_RUN_KEY, null);
  if (first === null) await setSetting(FIRST_RUN_KEY, now);
  const last = (await getSetting<number | null>(LAST_BACKUP_KEY, null)) ?? first ?? now;
  if ((await listBooks()).length === 0) return false;
  return now - last > BACKUP_REMINDER_DAYS * DAY_MS;
}

export async function snoozeBackupReminder(): Promise<void> {
  await setSetting(LAST_BACKUP_KEY, Date.now() - (BACKUP_REMINDER_DAYS - 3) * DAY_MS);
}
