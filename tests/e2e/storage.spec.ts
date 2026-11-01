import type { Page } from '@playwright/test';
import { expect, skipWebkitStorage, test } from './fixtures.ts';
import { importFixtures } from './helpers.ts';

skipWebkitStorage();

async function opfsBooks(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    try {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('books');
      const out: string[] = [];
      for await (const k of d.keys()) out.push(k as string);
      return out;
    } catch {
      return [];
    }
  });
}

async function markAllRead(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open('mangareader');
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const tx = r.result.transaction('books', 'readwrite');
          const st = tx.objectStore('books');
          st.getAll().onsuccess = (e) => {
            for (const b of (e.target as IDBRequest).result) st.put({ ...b, status: 'read' });
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test('offload finished books frees OPFS, keeps the row; re-import re-attaches without duplicating', async ({
  page,
}) => {
  await importFixtures(page, ['basic-10.cbz']);
  expect(await opfsBooks(page)).toHaveLength(1);
  await markAllRead(page);
  await page.goto('/#/settings');
  await page.getByTestId('offload-finished').click();
  await expect(page.getByText('Offloaded 1 book.')).toBeVisible();
  expect(await opfsBooks(page)).toHaveLength(0);

  await importFixtures(page, ['basic-10.cbz']);
  await page.getByRole('button', { name: 'All books' }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(1);
  expect(await opfsBooks(page)).toHaveLength(1);
});

test('erase all needs two confirmations and empties the library', async ({ page }) => {
  await importFixtures(page, ['basic-10.cbz']);
  await page.goto('/#/settings');
  await page.getByTestId('erase-all').click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('erase-confirm')).toHaveCount(0);
  expect(await opfsBooks(page)).toHaveLength(1);

  await page.getByTestId('erase-all').click();
  await page.getByTestId('erase-continue').click();
  await page.getByTestId('erase-confirm').click();
  await expect(page.getByText('All data erased.')).toBeVisible();
  expect(await opfsBooks(page)).toHaveLength(0);
  await page.goto('/#/library');
  await expect(page.getByTestId('book-card')).toHaveCount(0);
});
