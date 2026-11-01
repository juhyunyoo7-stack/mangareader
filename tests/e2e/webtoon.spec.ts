import { expect, skipWebkitStorage, test } from './fixtures.ts';
import { expectColourOfPage, importFixtures, openBook, setLayout, stage } from './helpers.ts';

skipWebkitStorage();

async function openWebtoon(page: import('@playwright/test').Page) {
  await importFixtures(page, ['webtoon-50.cbz']);
  await openBook(page, 'webtoon-50');
  await setLayout(page, 'Webtoon');
  await expect(page.locator('.stage[data-mode=webtoon]')).toBeVisible();
  await expect(page.locator('.stage[data-mode=webtoon]')).toHaveAttribute('data-ready', '1');
}

const canvasCount = (page: import('@playwright/test').Page) =>
  page.locator('.stage canvas').count();

test('virtualised webtoon: bounded canvases while scrolling a 30000 px strip to the bottom', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('mr.debug', '1'));
  await openWebtoon(page);
  const st = page.locator('.stage[data-mode=webtoon]');
  await expect.poll(() => canvasCount(page)).toBeGreaterThan(0);
  const total = await st.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(total).toBeGreaterThan(70_000); // 49 x 1600*1.25 + 37500
  let max = 0;
  for (let y = 0; y <= total; y += 1500) {
    await st.evaluate((el, top) => (el.scrollTop = top), y);
    await page.waitForTimeout(25);
    max = Math.max(max, await canvasCount(page));
    if (y % 30000 < 1500) {
      // let decoding catch up now and then so the visible area is painted
      await expect.poll(() => canvasCount(page)).toBeGreaterThan(0);
    }
  }
  await st.evaluate((el, top) => (el.scrollTop = top), total);
  await expect(st).toHaveAttribute('data-page', '49');
  await expect.poll(() => canvasCount(page)).toBeGreaterThan(0);
  max = Math.max(max, await canvasCount(page));
  expect(max).toBeLessThanOrEqual(12);
  // every strip stays far below the canvas cap
  const sizes = await page.evaluate(
    () => (window as unknown as { __mr: { debug(): any } }).__mr.debug().canvasSizes,
  );
  for (const s of sizes) expect(s.w * s.h).toBeLessThanOrEqual(16_000_000);
});

test('webtoon pixels: strip for page 3 carries page 3 colours', async ({ page }) => {
  await openWebtoon(page);
  const st = page.locator('.stage[data-mode=webtoon]');
  const top = await st.evaluate((el) => (el.scrollTop = 3 * 1600 * 1.25 + 10));
  void top;
  await expect(st).toHaveAttribute('data-page', '3');
  await expect(page.locator('canvas.strip[data-page="3"]')).toBeVisible();
  const col = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.strip[data-page="3"]')!;
    const d = c
      .getContext('2d')!
      .getImageData(Math.floor(c.width * 0.2), Math.floor(c.height * 0.3), 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  });
  expectColourOfPage(col, 3);
});

test('resume restores the scroll offset within one viewport after reload', async ({ page }) => {
  await openWebtoon(page);
  const st = page.locator('.stage[data-mode=webtoon]');
  // middle of the tall page (index 10)
  const target = await st.evaluate((el) => {
    const t = 10 * 1600 * 1.25 + 0.5 * 30000 * 1.25;
    el.scrollTop = t;
    return t;
  });
  await expect(st).toHaveAttribute('data-page', '10');
  await page.waitForTimeout(900); // save debounce
  await page.reload();
  const st2 = page.locator('.stage[data-mode=webtoon]');
  await expect(st2).toHaveAttribute('data-ready', '1');
  await expect(st2).toHaveAttribute('data-page', '10');
  const now = await st2.evaluate((el) => el.scrollTop);
  const vh = await st2.evaluate((el) => el.clientHeight);
  expect(Math.abs(now - target)).toBeLessThan(vh);
  await expect.poll(() => canvasCount(page)).toBeGreaterThan(0);
  void stage;
});

test('space/page-down scrolls about one screen; tap zones scroll too', async ({ page }) => {
  await openWebtoon(page);
  const st = page.locator('.stage[data-mode=webtoon]');
  await page.keyboard.press('Space');
  await expect.poll(() => st.evaluate((el) => el.scrollTop)).toBeGreaterThan(500);
  await page.keyboard.press('Shift+Space');
  await expect.poll(() => st.evaluate((el) => el.scrollTop)).toBeLessThan(5);
  const box = (await st.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.9);
  await expect.poll(() => st.evaluate((el) => el.scrollTop)).toBeGreaterThan(500);
});
