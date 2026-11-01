import type { Book } from '../core/types.ts';
import { bumpLibrary } from '../app/store.ts';
import { forgetCover } from '../app/library/data.ts';
import { getDb } from './db.ts';
import { removePath, wipeOpfs } from './opfs.ts';
import { deleteBook, patchBook } from './repo.ts';

/** Delete the archive bytes but keep metadata, progress and cover. */
export async function offloadBook(book: Book): Promise<void> {
  if (book.location.kind !== 'opfs') return;
  await removePath(['books', book.id]);
  await patchBook(book.id, { location: { kind: 'offloaded' } });
  bumpLibrary();
}

/** Remove a book entirely (rows + files). */
export async function removeBook(book: Book): Promise<void> {
  await removePath(['books', book.id]);
  await removePath(['thumbs', book.id]);
  forgetCover(book.id);
  await deleteBook(book.id);
  bumpLibrary();
}

/** Offload every finished OPFS book. Returns how many were offloaded. */
export async function offloadFinished(books: Book[]): Promise<number> {
  let n = 0;
  for (const b of books) {
    if (b.status === 'read' && b.location.kind === 'opfs') {
      await offloadBook(b);
      n++;
    }
  }
  return n;
}

/** Erase OPFS, IndexedDB and caches. Caller must have confirmed twice. */
export async function eraseEverything(): Promise<void> {
  const db = await getDb();
  for (const name of Array.from(db.objectStoreNames)) {
    await db.clear(name);
  }
  await wipeOpfs(); // the precached app shell is kept so the app still starts offline
  bumpLibrary();
}
