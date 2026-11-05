import { readFileSync } from 'node:fs';
import { expect, skipWebkitStorage, test } from './fixtures.ts';
import { fixturePath, importFixtures } from './helpers.ts';

skipWebkitStorage();

test('export on context A, import on fresh context B with the same CBZ restores progress and bookmarks', async ({
  browser,
  page,
}) => {
  await importFixtures(page, ['basic-10.cbz']);
  // give book A progress and a bookmark through IndexedDB (the reader path is covered elsewhere)
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open('mangareader');
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction(['books', 'progress', 'bookmarks'], 'readwrite');
          const g = tx.objectStore('books').getAll();
          g.onsuccess = () => {
            const b = g.result[0];
            const now = Date.now();
            tx.objectStore('progress').put({
              bookId: b.id,
              contentKey: b.contentKey,
              page: 4,
              pageCount: b.pageCount,
              percent: 44,
              finished: false,
              updatedAt: now,
              deviceId: 'A',
            });
            tx.objectStore('bookmarks').put({
              id: 'bm-1',
              bookId: b.id,
              contentKey: b.contentKey,
              page: 2,
              createdAt: now,
              updatedAt: now,
            });
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.goto('/#/settings');
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-state').click();
  const file = await (await dl).path();
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  expect(doc.format).toBe('mangareader-state');
  expect(doc.progress).toHaveLength(1);

  const ctxB = await browser.newContext({
    baseURL: `http://localhost:${process.env.PW_PORT ?? 4173}`,
  });
  await ctxB.addInitScript(() => localStorage.setItem('mr.locale', 'en'));
  const b = await ctxB.newPage();
  // import the state first, then the book: pending state must apply on import
  await b.goto('/#/settings');
  await b.getByTestId('state-input').setInputFiles(file);
  await expect(b.getByText(/State imported\. 0 books updated, 1 waiting/)).toBeVisible();
  await importFixtures(b, ['basic-10.cbz']);
  const restored = await b.evaluate(
    () =>
      new Promise<{ page: number; bms: number }>((resolve, reject) => {
        const r = indexedDB.open('mangareader');
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const tx = r.result.transaction(['progress', 'bookmarks'], 'readonly');
          const p = tx.objectStore('progress').getAll();
          const m = tx.objectStore('bookmarks').getAll();
          tx.oncomplete = () => resolve({ page: p.result[0]?.page ?? -1, bms: m.result.length });
        };
      }),
  );
  expect(restored).toEqual({ page: 4, bms: 1 });

  // a garbage file is rejected without touching data
  await b.goto('/#/settings');
  await b.getByTestId('state-input').setInputFiles(fixturePath('notazip.cbz'));
  await expect(b.getByText('Could not read that state file.')).toBeVisible();
  await ctxB.close();
});
