import { test } from './fixtures.ts';
import { importFixtures, openBook, setLayout, stage, waitPage } from './helpers.ts';

/** Run with SHOTS=1 npx playwright test screenshots --project=chromium-desktop. Writes docs/screenshots/*.png. */
test.skip(!process.env.SHOTS, 'screenshots are generated on demand');
test.skip(({ browserName }) => browserName !== 'chromium', 'chromium only');

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  ipad: { width: 820, height: 1180 },
  phone: { width: 412, height: 915 },
} as const;

for (const [name, vp] of Object.entries(VIEWPORTS)) {
  test(`screenshots ${name}`, async ({ page }) => {
    await page.setViewportSize(vp);
    const shot = (n: string) => page.screenshot({ path: `docs/screenshots/${name}-${n}.png` });
    await page.goto('/#/library');
    await shot('library-empty');
    await importFixtures(page, [
      'basic-10.cbz',
      'rtl-manga.cbz',
      'webtoon-50.cbz',
      'series/Alpha Saga v01.cbz',
      'series/Gamma Tales 01.cbz',
    ]);
    await page.waitForTimeout(5600); // import panel and toast fade away by themselves
    await shot('library');
    await page.goto('/#/settings');
    await page.waitForTimeout(400);
    await shot('settings');

    await page.goto('/#/library');
    await openBook(page, 'basic-10');
    await setLayout(page, 'Single');
    await shot('reader-single');
    await page.keyboard.press('m');
    await page.waitForTimeout(300);
    await shot('reader-overlay');
    await page.keyboard.press('m');

    await page.goto('/#/library');
    await openBook(page, /rtl/i);
    await setLayout(page, 'Double');
    await waitPage(page, 0);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(400);
    await shot('reader-rtl-double');

    await page.goto('/#/library');
    await openBook(page, 'webtoon-50');
    await setLayout(page, 'Webtoon');
    await stage(page).evaluate((el) => (el.scrollTop = 3000));
    await page.waitForTimeout(600);
    await shot('reader-webtoon');
  });
}
