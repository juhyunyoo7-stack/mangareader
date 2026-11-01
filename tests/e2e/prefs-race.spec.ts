import type { Page } from '@playwright/test';
import { expect, skipWebkitStorage, test } from './fixtures.ts';
import { importFixtures, openBook, setLayout } from './helpers.ts';

skipWebkitStorage();

async function bookPrefs(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const r = indexedDB.open('mangareader');
        r.onsuccess = () => {
          const q = r.result.transaction('books', 'readonly').objectStore('books').getAll();
          q.onsuccess = () => resolve((q.result as { prefs: Record<string, unknown> }[])[0]!.prefs);
          q.onerror = () => reject(q.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}

// Root cause: applyPref read the book, awaited the IndexedDB write and only then published the result,
// so two calls in flight both started from the same old prefs and the later write dropped the earlier
// change; toggles also computed their new value from the stale state.
test('preference changes issued back to back are all kept', async ({ page }) => {
  await importFixtures(page, ['basic-10.cbz']);
  await openBook(page, 'basic-10');
  await setLayout(page, 'Single');
  await page.keyboard.press('r'); // right-to-left
  await page.keyboard.press('g'); // guided view, no wait in between
  await page.keyboard.press('o'); // cover offset toggle
  await expect
    .poll(() => bookPrefs(page))
    .toMatchObject({
      direction: 'rtl',
      guided: true,
      coverOffset: false,
    });
  await page.reload();
  await expect(page.locator('.stage')).toHaveAttribute('data-ready', '1');
  expect(await bookPrefs(page)).toMatchObject({
    direction: 'rtl',
    guided: true,
    coverOffset: false,
  });
});

test('toggling the same preference twice quickly ends where it started', async ({ page }) => {
  await importFixtures(page, ['basic-10.cbz']);
  await openBook(page, 'basic-10');
  await setLayout(page, 'Single');
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await page.waitForTimeout(800);
  const prefs = await bookPrefs(page);
  expect(prefs.guided ?? false).toBe(false);
});
