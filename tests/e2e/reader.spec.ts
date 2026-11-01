import { expect, skipWebkitStorage, test } from './fixtures.ts';
import {
  centreColour,
  expectColourOfPage,
  importFixtures,
  openBook,
  setLayout,
  shownPages,
  stage,
  waitPage,
  waitPages,
} from './helpers.ts';

skipWebkitStorage();

test.describe('paged reader (T8)', () => {
  test('opens a book and shows page 1 with the right pixels', async ({ page }) => {
    await importFixtures(page, ['basic-10.cbz']);
    await openBook(page, 'basic-10');
    await setLayout(page, 'Single');
    await waitPage(page, 0);
    expectColourOfPage(await centreColour(page, 0), 0);
    // overlay is hidden by default (immersive)
    await expect(page.locator('.overlay-top')).toBeHidden();
  });

  test('Right x5 reaches page 6 and reload resumes there', async ({ page }) => {
    await importFixtures(page, ['basic-10.cbz']);
    await openBook(page, 'basic-10');
    await setLayout(page, 'Single');
    for (let i = 1; i <= 5; i++) {
      await page.keyboard.press('ArrowRight');
      await waitPage(page, i);
    }
    expectColourOfPage(await centreColour(page, 5), 5);
    await page.waitForTimeout(900); // progress save debounce
    await page.reload();
    await waitPage(page, 5);
    expectColourOfPage(await centreColour(page, 5), 5);
  });

  test('keys: left goes back, Home/End, Space, bounds', async ({ page }) => {
    await importFixtures(page, ['odd-7.cbz']);
    await openBook(page, 'odd-7');
    await setLayout(page, 'Single');
    await page.keyboard.press('ArrowLeft');
    await waitPage(page, 0); // cannot go before the first page
    await page.keyboard.press('End');
    await waitPage(page, 6);
    await page.keyboard.press('ArrowLeft');
    await waitPage(page, 5);
    await page.keyboard.press('Home');
    await waitPage(page, 0);
    await page.keyboard.press('Space');
    await waitPage(page, 1);
    await page.keyboard.press('Shift+Space');
    await waitPage(page, 0);
  });

  test('mouse click zones turn pages; centre toggles the overlay', async ({ page }) => {
    await importFixtures(page, ['basic-10.cbz']);
    await openBook(page, 'basic-10');
    await setLayout(page, 'Single');
    const box = (await stage(page).boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.5);
    await waitPage(page, 1);
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.5);
    await waitPage(page, 0);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(page.locator('.overlay-top')).toBeVisible();
  });

  test('RTL book (ComicInfo) mirrors keys and click zones', async ({ page }) => {
    await importFixtures(page, ['rtl-manga.cbz']);
    await openBook(page, 'RTL Test');
    await setLayout(page, 'Single');
    await expect(page.locator('.reader-root')).toHaveAttribute('data-direction', 'rtl');
    await page.keyboard.press('ArrowLeft'); // forward in RTL
    await waitPage(page, 1);
    await page.keyboard.press('ArrowRight'); // back
    await waitPage(page, 0);
    const box = (await stage(page).boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.5); // left zone = next
    await waitPage(page, 1);
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.5);
    await waitPage(page, 0);
  });
});

test.describe('double page and overrides (T9)', () => {
  test('wide page is shown alone and pairing resumes after it', async ({ page }) => {
    await importFixtures(page, ['spread-wide.cbz']);
    await openBook(page, 'spread-wide');
    await setLayout(page, 'Double');
    // cover offset on by default: [0] [1,2] [3,4] [5 wide] [6,7] [8,9]
    await waitPages(page, [0]);
    const seen: number[][] = [[0]];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowRight');
      await expect
        .poll(async () => (await shownPages(page)).join(','))
        .not.toBe(seen[seen.length - 1]!.join(','));
      seen.push(await shownPages(page));
    }
    expect(seen).toEqual([[0], [1, 2], [3, 4], [5], [6, 7], [8, 9]]);
  });

  test('toggling the cover offset keeps the current page visible', async ({ page }) => {
    await importFixtures(page, ['odd-7.cbz']);
    await openBook(page, 'odd-7');
    await setLayout(page, 'Double');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await waitPages(page, [3, 4]);
    await page.keyboard.press('o');
    await expect.poll(async () => await shownPages(page)).toEqual([2, 3]);
    await page.keyboard.press('o');
    await expect.poll(async () => await shownPages(page)).toEqual([1, 2]); // page 2 (lowest of [2,3]) stays visible
  });

  test('RTL double: right page is the lower page index', async ({ page }) => {
    await importFixtures(page, ['rtl-manga.cbz']);
    await openBook(page, 'RTL Test');
    await setLayout(page, 'Double');
    await page.keyboard.press('ArrowLeft'); // next spread [1,2]
    await waitPages(page, [1, 2]);
    const xs = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLCanvasElement>('.spread[data-state=current] canvas.page'),
      ].map((c) => ({
        page: Number(c.dataset.page),
        x: c.getBoundingClientRect().x,
      })),
    );
    const left = xs.reduce((a, b) => (a.x < b.x ? a : b));
    const right = xs.reduce((a, b) => (a.x > b.x ? a : b));
    expect(right.page).toBe(1);
    expect(left.page).toBe(2);
  });

  test('per-page override via right-click persists after reload', async ({ page }) => {
    await importFixtures(page, ['odd-7.cbz']);
    await openBook(page, 'odd-7');
    await setLayout(page, 'Double');
    await page.keyboard.press('ArrowRight');
    await waitPages(page, [1, 2]);
    const c = page.locator('.spread[data-state=current] canvas.page[data-page="1"]');
    await c.click({ button: 'right' });
    await page
      .getByRole('dialog', { name: 'Page 2' })
      .getByRole('button', { name: 'Show alone' })
      .click();
    await waitPages(page, [1]);
    await page.keyboard.press('ArrowRight');
    await waitPages(page, [2, 3]);
    await page.reload();
    await expect(stage(page)).toHaveAttribute('data-ready', '1');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await waitPages(page, [1]);
  });
});

test.describe('cache budget and tiling (T7)', () => {
  test('flipping 100 pages never exceeds the cache budget', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mr.debug', '1');
      localStorage.setItem('mr.budgetMB', '6');
    });
    await importFixtures(page, ['pages-100.cbz']);
    await openBook(page, 'pages-100');
    await setLayout(page, 'Single');
    for (let i = 1; i < 100; i++) {
      await page.keyboard.press('ArrowRight');
      await waitPage(page, i);
    }
    const d = await page.evaluate(() =>
      (window as unknown as { __mr: { debug(): any } }).__mr.debug(),
    );
    expect(d.cache.budget).toBe(6 * 1024 * 1024);
    expect(d.cache.peakTotal).toBeLessThanOrEqual(d.cache.budget);
    expect(d.cache.evictions).toBeGreaterThan(20);
  });

  test('a 25 MP page renders as tiles when zoomed, each canvas <= 16 MP', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mr.debug', '1'));
    await importFixtures(page, ['huge-page.cbz']);
    await openBook(page, 'huge-page');
    await setLayout(page, 'Single');
    await page.keyboard.press('ArrowRight');
    await waitPage(page, 1);
    // base layer: bitmap is clamped far below the 16 MP cap
    const sizes0 = await page.evaluate(
      () => (window as unknown as { __mr: { debug(): any } }).__mr.debug().canvasSizes,
    );
    for (const s of sizes0) expect(s.w * s.h).toBeLessThanOrEqual(16_000_000);
    // zoom to the maximum around the centre
    for (let i = 0; i < 8; i++) await page.keyboard.press('+');
    await expect
      .poll(async () => Number(await stage(page).getAttribute('data-tiles')))
      .toBeGreaterThan(0);
    const sizes = await page.evaluate(
      () => (window as unknown as { __mr: { debug(): any } }).__mr.debug().canvasSizes,
    );
    expect(sizes.some((s: { tile: boolean }) => s.tile)).toBe(true);
    for (const s of sizes) {
      expect(s.w * s.h).toBeLessThanOrEqual(16_000_000);
      expect(Math.max(s.w, s.h)).toBeLessThanOrEqual(2048 + 1);
    }
  });
});
