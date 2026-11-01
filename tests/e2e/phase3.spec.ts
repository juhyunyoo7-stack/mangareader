import type { Page } from '@playwright/test';
import { expect, skipWebkitStorage, test } from './fixtures.ts';
import { pageColor } from '../../scripts/fixtures/lib.ts';
import {
  centreColour,
  expectColourOfPage,
  importFixtures,
  openBook,
  setLayout,
  stage,
  waitPage,
} from './helpers.ts';

skipWebkitStorage();

const inlineFilter = (page: Page) => stage(page).evaluate((el) => (el as HTMLElement).style.filter);

/** Open the reader settings sheet, run `fn` on it, close it. */
export async function withSettings(
  page: Page,
  fn: (dlg: ReturnType<Page['getByRole']>) => Promise<void>,
) {
  await page.keyboard.press('m');
  await page.getByRole('button', { name: 'Reader settings' }).click();
  const dlg = page.getByRole('dialog', { name: 'Reader settings' });
  await fn(dlg);
  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(dlg).toBeHidden();
  await page.keyboard.press('m');
  await expect(page.locator('.overlay-top')).toBeHidden();
}

test('image filter presets set a CSS filter on the reader layer and persist', async ({ page }) => {
  await importFixtures(page, ['basic-10.cbz']);
  await openBook(page, 'basic-10');
  await setLayout(page, 'Single');
  await expect(stage(page)).toHaveCSS('filter', 'none');
  for (const [name, css] of [
    ['Dim', /^brightness\(0\.64\)/],
    ['Invert-soft', /invert\(1\)/],
    ['E-ink', /grayscale/],
    ['Sepia', /sepia/],
  ] as const) {
    await withSettings(page, async (dlg) => {
      await dlg
        .getByRole('group', { name: 'Image filter' })
        .getByRole('button', { name, exact: true })
        .click();
    });
    await expect.poll(() => inlineFilter(page)).toMatch(css);
  }
  // brightness slider stacks on the preset
  await withSettings(page, async (dlg) => {
    await dlg.getByLabel('Brightness').fill('1.3');
  });
  await expect.poll(() => inlineFilter(page)).toMatch(/sepia.*brightness\(1\.3\)/);
  // persists across reload
  await page.waitForTimeout(300);
  await page.reload();
  await waitPage(page, 0);
  await expect.poll(() => inlineFilter(page)).toMatch(/sepia/);
  // switching off clears it
  await withSettings(page, async (dlg) => {
    await dlg.getByLabel('Brightness').fill('1');
    await dlg
      .getByRole('group', { name: 'Image filter' })
      .getByRole('button', { name: 'Off' })
      .click();
  });
  await expect.poll(() => inlineFilter(page)).toBe('');
});

test('auto-trim crops blank margins (aspect and pixels), and can be switched off again', async ({
  page,
}) => {
  await importFixtures(page, ['margins-4.cbz']);
  await openBook(page, 'margins-4');
  await setLayout(page, 'Single');
  await waitPage(page, 0);
  const geom = () =>
    page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>(
        '.spread[data-state=current] canvas.page[data-page="0"]',
      )!;
      const d = c
        .getContext('2d')!
        .getImageData(Math.floor(c.width * 0.05), Math.floor(c.height * 0.04), 1, 1).data;
      return { ratio: c.width / c.height, px: [d[0]!, d[1]!, d[2]!] };
    });
  const before = await geom();
  expect(before.ratio).toBeCloseTo(600 / 900, 1);
  expect(before.px).toEqual([255, 255, 255]); // the sampled point is margin
  await withSettings(page, async (dlg) => {
    await dlg.getByLabel('Trim page margins').check();
  });
  await expect
    .poll(async () => (await geom()).ratio, { timeout: 10_000 })
    .toBeCloseTo((600 * 0.8) / (900 * 0.84), 2);
  const after = await geom();
  expectColourOfPage(after.px as [number, number, number], 0);
  // next page is analysed and cropped too
  await page.keyboard.press('ArrowRight');
  await waitPage(page, 1);
  expectColourOfPage(await centreColour(page, 1), 1);
  await withSettings(page, async (dlg) => {
    await dlg.getByLabel('Trim page margins').uncheck();
  });
  await page.keyboard.press('ArrowLeft');
  await waitPage(page, 0);
  await expect.poll(async () => (await geom()).ratio).toBeCloseTo(600 / 900, 2);
});

test('auto-trim + zoom: detail tiles are cut from the cropped region, not the margins', async ({
  page,
}) => {
  await importFixtures(page, ['margins-big.cbz']);
  await openBook(page, 'margins-big');
  await setLayout(page, 'Single');
  await waitPage(page, 0);
  await withSettings(page, async (dlg) => {
    await dlg.getByLabel('Trim page margins').check();
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('canvas.page[data-page="0"]')!;
        return +(c.width / c.height).toFixed(2);
      }),
    )
    .toBeCloseTo(0.63, 2);
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  // pan to the top-left corner of the cropped page
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
  }
  await expect(stage(page)).not.toHaveAttribute('data-tiles', '0', { timeout: 10_000 });
  const colours = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLCanvasElement>('canvas.tile')]
      .filter((t) => t.dataset.tile === '0,0')
      .map((t) => {
        const d = t.getContext('2d')!.getImageData(4, 4, 1, 1).data;
        return [d[0]!, d[1]!, d[2]!] as [number, number, number];
      }),
  );
  expect(colours.length).toBeGreaterThan(0);
  for (const c of colours) expectColourOfPage(c, 0); // white here would mean the crop offset was lost
});

const viewCentrePixel = (page: Page) =>
  page.evaluate(() => {
    const st = document.querySelector('.stage')!.getBoundingClientRect();
    const cx = st.left + st.width / 2;
    const cy = st.top + st.height / 2;
    const c = document.querySelector<HTMLCanvasElement>('.spread[data-state=current] canvas.page')!;
    const r = c.getBoundingClientRect();
    const x = Math.floor(((cx - r.left) / r.width) * c.width);
    const y = Math.floor(((cy - r.top) / r.height) * c.height);
    const d = c.getContext('2d')!.getImageData(x, y, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  });

async function expectPanel(page: Page, k: number, colourIndex: number) {
  await expect(stage(page)).toHaveAttribute('data-panel', String(k));
  await expect
    .poll(async () => {
      const px = await viewCentrePixel(page);
      const want = pageColor(colourIndex);
      return Math.max(...px.map((v, i) => Math.abs(v - want[i]!)));
    })
    .toBeLessThanOrEqual(6);
  expect(Number(await stage(page).getAttribute('data-zoom'))).toBeGreaterThan(1.3);
}

test('guided view: panels are visited in reading order, then the next page; back lands on the last panel', async ({
  page,
}) => {
  await importFixtures(page, ['panel-grid.cbz']);
  await openBook(page, 'panel-grid');
  await setLayout(page, 'Single');
  await waitPage(page, 0);
  await page.keyboard.press('g');
  await expect(stage(page)).toHaveAttribute('data-panels', '6', { timeout: 10_000 });
  for (let k = 0; k < 6; k++) {
    await expectPanel(page, k, k);
    await waitPage(page, 0);
    if (k < 5) await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('ArrowRight'); // past the last panel -> next page, first panel
  await waitPage(page, 1);
  await expect(stage(page)).toHaveAttribute('data-panels', '6', { timeout: 10_000 });
  await expectPanel(page, 0, 0);
  await page.keyboard.press('ArrowLeft'); // before the first panel -> previous page, last panel
  await waitPage(page, 0);
  await expect(stage(page)).toHaveAttribute('data-panels', '6', { timeout: 10_000 });
  await expectPanel(page, 5, 5);
  // switching guided off returns to the whole page
  await page.keyboard.press('g');
  await expect(stage(page)).toHaveAttribute('data-panels', '0');
  await expect
    .poll(async () => Number(await stage(page).getAttribute('data-zoom')))
    .toBeLessThan(1.05);
});

test('guided view: right-to-left books read each row from the right', async ({ page }) => {
  await importFixtures(page, ['panel-grid.cbz']);
  await openBook(page, 'panel-grid');
  await setLayout(page, 'Single');
  await page.keyboard.press('r'); // RTL
  await page.waitForTimeout(400); // preference writes are async; do not interleave them
  await page.keyboard.press('g');
  await expect(stage(page)).toHaveAttribute('data-panels', '6', { timeout: 10_000 });
  // rows are (0,1) (2,3) (4,5); RTL reads 1,0,3,2,5,4
  const order = [1, 0, 3, 2, 5, 4];
  for (const [k, colour] of order.entries()) {
    await expectPanel(page, k, colour);
    if (k < 5) await page.keyboard.press('ArrowLeft'); // RTL: left = next
  }
});

test('guided view: a page with no panel structure is shown whole', async ({ page }) => {
  await importFixtures(page, ['basic-10.cbz']);
  await openBook(page, 'basic-10');
  await setLayout(page, 'Single');
  await page.keyboard.press('g');
  await expect(stage(page)).toHaveAttribute('data-guided', 'ready', { timeout: 10_000 });
  await expect(stage(page)).toHaveAttribute('data-panels', '0');
  await page.keyboard.press('ArrowRight');
  await waitPage(page, 1);
});

for (const [label, reduced, expected] of [
  ['animates the camera (250 ms)', 'no-preference', /transform 250ms/],
  ['moves instantly with reduced motion', 'reduce', /^(none)?$/],
] as const) {
  test(`guided view ${label}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reduced });
    await importFixtures(page, ['panel-grid.cbz']);
    await openBook(page, 'panel-grid');
    await setLayout(page, 'Single');
    await page.keyboard.press('g');
    await expect(stage(page)).toHaveAttribute('data-panels', '6', { timeout: 10_000 });
    await page.keyboard.press('ArrowRight');
    await expect(stage(page)).toHaveAttribute('data-panel', '1');
    const tr = await page.evaluate(
      () =>
        document.querySelector<HTMLElement>('.spread[data-state=current] .layer')!.style.transition,
    );
    expect(tr).toMatch(expected);
  });
}
