import { expect, test } from './fixtures.ts';
import { gotoLibrary, importFixtures, openBook, stage } from './helpers.ts';

// Phone/tablet behaviour (Chromium, Pixel 7 profile; the iPad cases only change the user agent).
// Emulation, not a real device: see docs/STATUS.md for what still needs an iPhone/iPad/Android.

const IPAD_17 =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** Specs that store books cannot run on Playwright WebKit for Windows (no OPFS writes). */
const needsStorage = (browserName: string) =>
  test.skip(browserName === 'webkit', 'Playwright WebKit on Windows has no functional OPFS writes');

async function leaveReader(page: import('@playwright/test').Page): Promise<void> {
  await stage(page).click({ position: { x: 200, y: 400 } }); // centre tap: overlay
  await page.getByRole('button', { name: 'Back to library' }).click();
  await expect(page.locator('.reader-root')).toHaveCount(0);
}

test.describe('back button (installed Android app)', () => {
  test('after leaving the reader, back does not reopen the book', async ({ page, browserName }) => {
    needsStorage(browserName);
    await importFixtures(page, ['basic-10.cbz']);
    await openBook(page, 'basic-10');
    await leaveReader(page);
    await expect(page).toHaveURL(/#\/series\//);
    await page.goBack();
    await expect(page).toHaveURL(/#\/library$/);
    await page.waitForTimeout(300);
    await expect(page.locator('.reader-root')).toHaveCount(0);
  });

  test('library -> series -> book -> leave: back goes to the library', async ({
    page,
    browserName,
  }) => {
    needsStorage(browserName);
    await importFixtures(page, ['basic-10.cbz']);
    await page.getByTestId('series-card').first().click();
    await expect(page).toHaveURL(/#\/series\//);
    await page
      .getByRole('button', { name: /basic-10/ })
      .first()
      .click();
    await expect(stage(page)).toHaveAttribute('data-ready', '1');
    await leaveReader(page);
    await expect(page).toHaveURL(/#\/series\//);
    await page.goBack();
    await expect(page).toHaveURL(/#\/library$/);
    await expect(page.locator('.reader-root')).toHaveCount(0);
  });
});

test('the screen is kept on while reading and released after leaving', async ({
  page,
  browserName,
}) => {
  needsStorage(browserName);
  await page.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __wl: string[] }).__wl = log;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async (type: string) => {
          log.push(`request:${type}`);
          return { release: async () => void log.push('release') };
        },
      },
    });
  });
  await importFixtures(page, ['basic-10.cbz']);
  await openBook(page, 'basic-10');
  const log = () => page.evaluate(() => (window as unknown as { __wl: string[] }).__wl);
  await expect.poll(log).toEqual(['request:screen']);
  await leaveReader(page);
  await expect.poll(log).toEqual(['request:screen', 'release']);
});

test.describe('iPad before iPadOS 18.4', () => {
  test.use({ userAgent: IPAD_17 });

  test('no folder picker (Safari cannot pick folders there): a hint explains multi-select', async ({
    page,
  }) => {
    await gotoLibrary(page);
    await expect(page.getByRole('button', { name: 'Import books' }).first()).toBeVisible();
    await expect(page.getByTestId('import-folder')).toHaveCount(0);
    await expect(page.getByTestId('folder-unavailable')).toContainText(
      'select all the page images',
    );
  });

  test('state export goes through the share sheet ("Save to Files", AirDrop)', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: { name: string; text: string }[] };
      w.__shared = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (d: { files: File[] }) => {
          for (const f of d.files) w.__shared.push({ name: f.name, text: await f.text() });
        },
      });
    });
    await page.goto('/#/settings');
    let downloaded = false;
    page.on('download', () => (downloaded = true));
    await page.getByTestId('export-state').click();
    const read = () =>
      page.evaluate(
        () => (window as unknown as { __shared: { name: string; text: string }[] }).__shared,
      );
    await expect.poll(read).toHaveLength(1);
    const shared = await read();
    expect(shared[0]!.name).toMatch(/^mangareader-state-\d{4}-\d{2}-\d{2}\.json$/);
    expect(() => JSON.parse(shared[0]!.text)).not.toThrow();
    expect(downloaded).toBe(false);
  });
});

test('Android keeps the folder picker and the normal download for the state file', async ({
  page,
  browserName,
}) => {
  needsStorage(browserName);
  await gotoLibrary(page);
  await expect(page.getByTestId('import-folder').first()).toBeVisible();
  await page.goto('/#/settings');
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-state').click();
  expect((await dl).suggestedFilename()).toMatch(/^mangareader-state-.*\.json$/);
});
