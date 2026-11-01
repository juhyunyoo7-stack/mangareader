import { expect, skipWebkitStorage, test } from './fixtures.ts';
import {
  centreColour,
  expectColourOfPage,
  fixturePath,
  gotoLibrary,
  importFixtures,
  openBook,
  setLayout,
  waitPage,
} from './helpers.ts';
import type { Page } from '@playwright/test';

skipWebkitStorage();

async function bookPages(page: Page): Promise<{ w: number; h: number; wide: boolean }[]> {
  return page.evaluate(
    () =>
      new Promise<{ w: number; h: number; wide: boolean }[]>((resolve, reject) => {
        const r = indexedDB.open('mangareader');
        r.onsuccess = () => {
          const q = r.result.transaction('books', 'readonly').objectStore('books').getAll();
          q.onsuccess = () =>
            resolve((q.result as { pages: { w: number; h: number; wide: boolean }[] }[])[0]!.pages);
          q.onerror = () => reject(q.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}

async function bookFormats(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const r = indexedDB.open('mangareader');
        r.onsuccess = () => {
          const q = r.result.transaction('books', 'readonly').objectStore('books').getAll();
          q.onsuccess = () => resolve((q.result as { format: string }[]).map((b) => b.format));
          q.onerror = () => reject(q.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}

const CASES: [fixture: string, title: string, format: string][] = [
  ['stored-rar5.cbr', 'stored-rar5', 'rar'],
  ['stored-rar4.cbr', 'stored-rar4', 'rar'],
  ['solid4.cb7', 'solid4', '7z'],
  ['plain4.cb7', 'plain4', '7z'],
];

for (const [fixture, title, format] of CASES) {
  test(`${fixture}: imports via WASM, opens, pages render with the right pixels`, async ({
    page,
  }) => {
    await importFixtures(page, [fixture]);
    expect(await bookFormats(page)).toEqual([format]);
    await openBook(page, title);
    await setLayout(page, 'Single');
    await waitPage(page, 0);
    expectColourOfPage(await centreColour(page, 0), 0);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await waitPage(page, 2);
    expectColourOfPage(await centreColour(page, 2), 2);
  });
}

test('encrypted 7z is rejected with a clear message and nothing is stored', async ({ page }) => {
  await gotoLibrary(page);
  await page.getByTestId('file-input').first().setInputFiles('tests/fixtures/bin/encrypted.7z');
  await expect(
    page.getByText(/Password-protected archives are not supported/).first(),
  ).toBeVisible();
  expect(await bookFormats(page)).toEqual([]);
});

test('PDF imports (pdf.js, lazy), renders page colours, wide page is detected', async ({
  page,
}) => {
  await importFixtures(page, ['pages-4.pdf']);
  expect(await bookFormats(page)).toEqual(['pdf']);
  const dims = await bookPages(page);
  expect(dims.map((p) => [p.w, p.h])).toEqual([
    [800, 1200],
    [800, 1200],
    [800, 1200],
    [1200, 800],
  ]);
  expect(dims.map((p) => p.wide)).toEqual([false, false, false, true]);
  await openBook(page, 'pages-4');
  await setLayout(page, 'Single');
  await waitPage(page, 0);
  expectColourOfPage(await centreColour(page, 0), 0);
  for (const i of [1, 2, 3]) {
    await page.keyboard.press('ArrowRight');
    await waitPage(page, i);
    expectColourOfPage(await centreColour(page, i), i);
  }
});

test('image EPUB: pages follow the spine, RTL from the package, text EPUB is rejected', async ({
  page,
}) => {
  await importFixtures(page, ['comic-5.epub']);
  expect(await bookFormats(page)).toEqual(['epub']);
  await openBook(page, 'Epub & Test');
  await setLayout(page, 'Single');
  await waitPage(page, 0);
  expectColourOfPage(await centreColour(page, 0), 0);
  await page.keyboard.press('ArrowLeft'); // RTL: left = next
  await waitPage(page, 1);
  expectColourOfPage(await centreColour(page, 1), 1);

  await gotoLibrary(page);
  await page.getByTestId('file-input').first().setInputFiles(fixturePath('text-book.epub'));
  await expect(page.getByText(/This EPUB is mostly text/).first()).toBeVisible();
  expect(await bookFormats(page)).toEqual(['epub']);
});

// Page 1 is a real AVIF (pageColor 0), page 2 a real JXL (pageColor 1), page 0 a PNG (pageColor 2).
for (const [label, query] of [
  ['browser decoders first', ''],
  ['forced WASM fallback', '?wasmimg=1'],
] as const) {
  test(`AVIF + JXL pages decode (${label})`, async ({ page }) => {
    const wasm: string[] = [];
    page.on('response', (r) => {
      if (r.url().endsWith('.wasm')) wasm.push(r.url());
    });
    await page.goto(`/${query}#/library`);
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
    await page.getByTestId('file-input').first().setInputFiles(fixturePath('modern-formats.cbz'));
    await expect(page.getByText(/Imported \d+ book/)).toBeVisible({ timeout: 30_000 });
    await openBook(page, 'modern-formats');
    await setLayout(page, 'Single');
    await waitPage(page, 0);
    expectColourOfPage(await centreColour(page, 0), 2);
    await page.keyboard.press('ArrowRight');
    await waitPage(page, 1);
    expectColourOfPage(await centreColour(page, 1), 0);
    await page.keyboard.press('ArrowRight');
    await waitPage(page, 2);
    expectColourOfPage(await centreColour(page, 2), 1);
    if (query) {
      expect(wasm.some((u) => /jxl_dec/.test(u))).toBe(true);
      expect(wasm.some((u) => /avif_dec/.test(u))).toBe(true);
    }
  });
}
