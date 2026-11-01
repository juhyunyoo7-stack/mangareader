import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeZip } from '../../src/archive/analyze.ts';
import { buildBook } from '../../src/data/bookFactory.ts';
import { applyPendingState, exportState, importState, isBackupDue } from '../../src/data/backup.ts';
import { openAppDb, setDbForTests } from '../../src/data/db.ts';
import {
  addBook,
  addBookmark,
  getProgress,
  getBookByKey,
  listBookmarks,
  listBooks,
  saveProgress,
  setSetting,
} from '../../src/data/repo.ts';
import { FIXTURES } from '../../scripts/fixtures/lib.ts';
import { blobSource } from './helpers.ts';

let n = 0;
function freshDb() {
  setDbForTests(openAppDb(`backup-db-${++n}`));
}
beforeEach(freshDb);

async function addFixture(id: string) {
  const bytes = FIXTURES['basic-10.cbz']!();
  const analysis = await analyzeZip(blobSource(bytes));
  const b = buildBook({
    id,
    analysis,
    fileName: 'basic-10.cbz',
    size: bytes.length,
    mtime: 1,
    location: { kind: 'opfs', path: `books/${id}/basic-10.cbz` },
    hasCover: false,
  });
  return addBook(b.book, { key: 'basic', name: 'Basic' });
}

describe('backup', () => {
  it('round-trips progress and bookmarks to a second device by contentKey', async () => {
    const a = await addFixture('A1');
    await saveProgress(a, 6, undefined, 'dev-a');
    await addBookmark(a, 3, 'note');
    const doc = JSON.parse(JSON.stringify(await exportState()));
    expect(doc.progress).toHaveLength(1);

    freshDb(); // device B with the same book under a different local id
    const b = await addFixture('B1');
    const r = await importState(doc);
    expect(r).toEqual({ booksMatched: 1, booksPending: 0 });
    expect((await getProgress(b.id))?.page).toBe(6);
    expect((await listBookmarks(b.id)).map((x) => x.page)).toEqual([3]);
    expect((await getBookByKey(b.contentKey))?.status).toBe('reading');
  });

  it('keeps state pending for books imported later', async () => {
    const a = await addFixture('A1');
    await saveProgress(a, 9, undefined, 'dev-a');
    const doc = JSON.parse(JSON.stringify(await exportState()));

    freshDb();
    expect(await importState(doc)).toEqual({ booksMatched: 0, booksPending: 1 });
    const b = await addFixture('B1');
    expect(await getProgress(b.id)).toBeUndefined();
    await applyPendingState(b);
    const p = await getProgress(b.id);
    expect(p?.page).toBe(9);
    expect(p?.finished).toBe(true);
  });

  it('does not overwrite newer local progress', async () => {
    const a = await addFixture('A1');
    await saveProgress(a, 2, undefined, 'dev-a');
    const doc = JSON.parse(JSON.stringify(await exportState()));
    doc.progress[0].updatedAt -= 10_000;
    doc.progress[0].page = 8;
    await importState(doc);
    expect((await getProgress(a.id))?.page).toBe(2);
  });

  it('rejects foreign documents', async () => {
    await expect(importState({ hello: 1 })).rejects.toThrow();
  });

  it('reminds after 14 days only when books exist', async () => {
    const t0 = 1_000_000_000_000;
    expect(await isBackupDue(t0)).toBe(false);
    await addFixture('A1');
    expect(await isBackupDue(t0 + 1000)).toBe(false);
    expect(await isBackupDue(t0 + 15 * 86_400_000)).toBe(true);
    await setSetting('lastBackupAt', t0 + 14 * 86_400_000);
    expect(await isBackupDue(t0 + 15 * 86_400_000)).toBe(false);
    expect((await listBooks()).length).toBe(1);
  });
});
