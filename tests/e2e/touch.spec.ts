import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { importFixtures, openBook, stage, waitPage } from './helpers.ts';

// Touch emulation tests (Chromium, Pixel 7 profile). Gestures are injected as real touch events via
// CDP so the Pointer Events recogniser is exercised end to end.

async function cdp(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

async function swipe(
  page: Page,
  c: CDPSession,
  from: [number, number],
  to: [number, number],
  steps = 8,
): Promise<void> {
  await c.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from[0], y: from[1], id: 1 }],
  });
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
    await page.waitForTimeout(12);
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function pinch(
  page: Page,
  c: CDPSession,
  centre: [number, number],
  from: number,
  to: number,
): Promise<void> {
  const pts = (d: number) => [
    { x: centre[0] - d / 2, y: centre[1], id: 1 },
    { x: centre[0] + d / 2, y: centre[1], id: 2 },
  ];
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let i = 1; i <= 10; i++) {
    await c.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: pts(from + ((to - from) * i) / 10),
    });
    await page.waitForTimeout(12);
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const zoomOf = async (page: Page) => Number(await stage(page).getAttribute('data-zoom'));

test.beforeEach(async ({ page }) => {
  await importFixtures(page, ['basic-10.cbz']);
  await openBook(page, 'basic-10');
  await expect(stage(page)).toHaveAttribute('data-layout', 'single'); // portrait phone => auto = single
});

test('tap zones turn pages on a phone', async ({ page }) => {
  const vp = page.viewportSize()!;
  await page.touchscreen.tap(vp.width * 0.9, vp.height * 0.5);
  await waitPage(page, 1);
  await page.touchscreen.tap(vp.width * 0.1, vp.height * 0.5);
  await waitPage(page, 0);
});

test('swipe left = next, swipe right = previous (LTR)', async ({ page }) => {
  const c = await cdp(page);
  const vp = page.viewportSize()!;
  const y = vp.height / 2;
  await swipe(page, c, [vp.width * 0.8, y], [vp.width * 0.2, y]);
  await waitPage(page, 1);
  await swipe(page, c, [vp.width * 0.2, y], [vp.width * 0.8, y]);
  await waitPage(page, 0);
});

test('double-tap zooms to 2.5x and back; swipe does not turn the page while zoomed', async ({
  page,
}) => {
  const c = await cdp(page);
  const vp = page.viewportSize()!;
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  await page.touchscreen.tap(cx, cy);
  await page.waitForTimeout(60);
  await page.touchscreen.tap(cx, cy);
  await expect.poll(() => zoomOf(page)).toBeCloseTo(2.5, 1);
  // a short swipe while zoomed mid-page pans, it must not turn the page
  await page.waitForTimeout(250);
  await swipe(page, c, [vp.width * 0.6, cy], [vp.width * 0.45, cy]);
  await page.waitForTimeout(300);
  await expect(stage(page)).toHaveAttribute('data-page', '0');
  expect(await zoomOf(page)).toBeCloseTo(2.5, 1);
  // double tap again resets
  await page.touchscreen.tap(cx, cy);
  await page.waitForTimeout(60);
  await page.touchscreen.tap(cx, cy);
  await expect.poll(() => zoomOf(page)).toBeCloseTo(1, 1);
});

test('pinch zooms in, around the pinch centre', async ({ page }) => {
  const c = await cdp(page);
  const vp = page.viewportSize()!;
  await pinch(page, c, [vp.width / 2, vp.height / 2], 80, 240);
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(2);
  // pinch back out returns to fit
  await pinch(page, c, [vp.width / 2, vp.height / 2], 240, 60);
  await expect.poll(() => zoomOf(page)).toBeLessThan(1.1);
});

test('long press opens the page menu', async ({ page }) => {
  const c = await cdp(page);
  const vp = page.viewportSize()!;
  await c.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: vp.width / 2, y: vp.height / 2, id: 1 }],
  });
  await page.waitForTimeout(800);
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('dialog', { name: 'Page 1' })).toBeVisible();
});
