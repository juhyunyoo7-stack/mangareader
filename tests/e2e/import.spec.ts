import type { Page } from '@playwright/test';
import { expect, skipWebkitStorage, test } from './fixtures.ts';

skipWebkitStorage();
import { fixturePath, gotoLibrary, importFixtures } from './helpers.ts';

async function idbCount(page: Page, store: string): Promise<number> {
  return page.evaluate(
    (s) =>
      new Promise<number>((resolve, reject) => {
        const r = indexedDB.open('mangareader');
        r.onsuccess = () => {
          const tx = r.result.transaction(s, 'readonly');
          const c = tx.objectStore(s).count();
          c.onsuccess = () => resolve(c.result);
          c.onerror = () => reject(c.error);
        };
        r.onerror = () => reject(r.error);
      }),
    store,
  );
}

async function opfsList(page: Page, path: string[]): Promise<string[]> {
  return page.evaluate(async (p) => {
    try {
      let d = await navigator.storage.getDirectory();
      for (const seg of p) d = await d.getDirectoryHandle(seg);
      const out: string[] = [];
      for await (const k of d.keys()) out.push(k as string);
      return out;
    } catch {
      return [];
    }
  }, path);
}

test('import 3 CBZ via file input: rows in IDB, archives in OPFS, listed in library', async ({
  page,
}) => {
  await importFixtures(page, ['basic-10.cbz', 'odd-7.cbz', 'rtl-manga.cbz']);
  expect(await idbCount(page, 'books')).toBe(3);
  expect((await opfsList(page, ['books'])).length).toBe(3);
  expect(await opfsList(page, ['incoming'])).toEqual([]);
  await page.getByRole('button', { name: 'All books' }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(3);
});

test('re-importing the same file is rejected with a toast and adds nothing', async ({ page }) => {
  await importFixtures(page, ['odd-7.cbz']);
  await page.getByTestId('file-input').first().setInputFiles(fixturePath('odd-7.cbz'));
  await expect(page.getByText(/already in your library/i).first()).toBeVisible();
  expect(await idbCount(page, 'books')).toBe(1);
  expect((await opfsList(page, ['books'])).length).toBe(1);
  expect(await opfsList(page, ['incoming'])).toEqual([]);
});

test('same content under another file name is detected as duplicate (content key)', async ({
  page,
}) => {
  await importFixtures(page, ['odd-7.cbz']);
  const bytes = (await import('node:fs')).readFileSync(fixturePath('odd-7.cbz'));
  await page
    .getByTestId('file-input')
    .first()
    .setInputFiles({ name: 'renamed copy.cbz', mimeType: 'application/zip', buffer: bytes });
  await expect(page.getByText(/already in your library/i).first()).toBeVisible();
  expect(await idbCount(page, 'books')).toBe(1);
});

test('non-comic and unreadable RAR files are rejected with a clear message', async ({ page }) => {
  await gotoLibrary(page);
  await page
    .getByTestId('file-input')
    .first()
    .setInputFiles([
      {
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello world, definitely not a comic'),
      },
      {
        name: 'x.cbr',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('Rar!\x1a\x07\x00 padding padding'),
      },
    ]);
  await expect(
    page.getByText(/notes\.txt: This file is not a supported comic archive/),
  ).toBeVisible();
  await expect(page.getByText(/x\.cbr: The archive is truncated or damaged/)).toBeVisible();
  expect(await idbCount(page, 'books')).toBe(0);
});

test('corrupt archives fail cleanly and leave no files behind', async ({ page }) => {
  await gotoLibrary(page);
  await page
    .getByTestId('file-input')
    .first()
    .setInputFiles([
      fixturePath('truncated.cbz'),
      fixturePath('encrypted.cbz'),
      fixturePath('no-images.cbz'),
    ]);
  await expect(page.getByText(/truncated\.cbz: The archive is truncated/)).toBeVisible();
  await expect(page.getByText(/encrypted\.cbz: Password-protected/)).toBeVisible();
  await expect(page.getByText(/no-images\.cbz: No readable images/)).toBeVisible();
  expect(await idbCount(page, 'books')).toBe(0);
  expect(await opfsList(page, ['incoming'])).toEqual([]);
  expect(await opfsList(page, ['books'])).toEqual([]);
});

test('cancel mid-import leaves nothing in incoming/ or books/', async ({ page }) => {
  await gotoLibrary(page);
  await page.evaluate(() => {
    const chunk = new Uint8Array(1024 * 1024);
    chunk.set([0x50, 0x4b, 0x03, 0x04]);
    const parts: BlobPart[] = [];
    for (let i = 0; i < 600; i++) parts.push(chunk);
    const dt = new DataTransfer();
    dt.items.add(new File(parts, 'big.cbz', { type: 'application/zip' }));
    const input = document.querySelector<HTMLInputElement>('[data-testid=file-input]')!;
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('button', { name: 'Cancel current' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel current' }).click();
  await expect(page.getByText(/Import cancelled|not a valid ZIP|truncated/).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(async () => (await opfsList(page, ['incoming'])).length).toBe(0);
  expect(await opfsList(page, ['books'])).toEqual([]);
  expect(await idbCount(page, 'books')).toBe(0);
});
