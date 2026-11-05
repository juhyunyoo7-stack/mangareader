import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, skipWebkitStorage, test } from './fixtures.ts';
import { gotoLibrary, openBook, waitPage } from './helpers.ts';
import { pagePng } from '../../scripts/fixtures/lib.ts';

skipWebkitStorage();

const png = (n: number) => Buffer.from(pagePng(n, 300, 450));

test('loose page images selected together become one book, pages in natural order', async ({
  page,
}) => {
  await gotoLibrary(page);
  await page
    .getByTestId('file-input')
    .first()
    .setInputFiles(
      [10, 2, 1, 3].map((n) => ({
        name: `shot ${n}.png`,
        mimeType: 'image/png',
        buffer: png(n),
      })),
    );
  await expect(page.getByText('Imported 1 book.')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'All books' }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(1);
  await openBook(page, /shot/);
  await waitPage(page, 0);
  const pageCount = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const r = indexedDB.open('mangareader');
        r.onsuccess = () => {
          const all = r.result.transaction('books', 'readonly').objectStore('books').getAll();
          all.onsuccess = () => resolve((all.result[0] as { pageCount: number }).pageCount);
          all.onerror = () => reject(all.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
  expect(pageCount).toBe(4);
});

test('a picked folder of images becomes a book named after the folder', async ({ page }, info) => {
  const root = join(process.cwd(), 'tests', 'fixtures', 'out', `imgfolder-${info.workerIndex}`);
  const dir = join(root, 'My Comic Vol 1');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= 5; i++)
    writeFileSync(join(dir, `${String(i).padStart(3, '0')}.png`), png(i));
  await gotoLibrary(page);
  await page.getByTestId('folder-input').first().setInputFiles(dir);
  await expect(page.getByText('Imported 1 book.')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'All books' }).click();
  await expect(page.getByRole('button', { name: /My Comic Vol 1/ }).first()).toBeVisible();
});

test('importing the same images twice is detected as a duplicate', async ({ page }) => {
  await gotoLibrary(page);
  const files = [1, 2].map((n) => ({
    name: `dup ${n}.png`,
    mimeType: 'image/png',
    buffer: png(n),
  }));
  await page.getByTestId('file-input').first().setInputFiles(files);
  await expect(page.getByText('Imported 1 book.')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('file-input').first().setInputFiles(files);
  await expect(page.getByText(/already in your library/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'All books' }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(1);
});
