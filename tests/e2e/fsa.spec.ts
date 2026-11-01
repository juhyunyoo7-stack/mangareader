import type { Page } from '@playwright/test';
import { expect, skipWebkitStorage, test } from './fixtures.ts';
import { fixtureBytes, gotoLibrary } from './helpers.ts';

skipWebkitStorage();

/** Replace the native picker with one that returns an OPFS directory the test fills. */
async function installMockPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle('fsa-lib', { create: true });
    };
    // OPFS handles always report granted, but make that explicit for the code path under test
    (FileSystemHandle.prototype as unknown as Record<string, unknown>).queryPermission = async () =>
      'granted';
  });
}

async function putFile(page: Page, path: string[], bytes: Buffer): Promise<void> {
  await page.evaluate(
    async ({ path, b64 }) => {
      let d = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('fsa-lib', { create: true });
      for (const seg of path.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
      const fh = await d.getFileHandle(path[path.length - 1]!, { create: true });
      const w = await fh.createWritable();
      await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      await w.close();
    },
    { path, b64: bytes.toString('base64') },
  );
}

test('desktop library folder: add, list in settings, rescan finds new file, remove drops books', async ({
  page,
}) => {
  await installMockPicker(page);
  await gotoLibrary(page);
  await putFile(page, ['Manga', 'basic-10.cbz'], fixtureBytes('basic-10.cbz'));
  await putFile(page, ['Manga', 'odd-7.cbz'], fixtureBytes('odd-7.cbz'));

  await page.getByRole('button', { name: 'Add folder' }).click();
  await expect(page.getByText(/fsa-lib: 2 added/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'All books' }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(2);

  await page.goto('/#/settings');
  const row = page.getByTestId('source-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('fsa-lib');
  await expect(row).toContainText('2 books');

  await putFile(page, ['Manga', 'rtl-manga.cbz'], fixtureBytes('rtl-manga.cbz'));
  await row.getByRole('button', { name: 'Rescan' }).click();
  await expect(row).toContainText('3 books', { timeout: 30_000 });

  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('source-row')).toHaveCount(0);
  await page.goto('/#/library');
  await expect(page.getByTestId('book-card')).toHaveCount(0);
});
