import { expect, skipWebkitStorage, test } from './fixtures.ts';
import { importFixtures, openBook, setLayout, stage, waitPage } from './helpers.ts';

skipWebkitStorage();

test.beforeEach(async ({ page }) => {
  await importFixtures(page, ['pages-100.cbz']);
  await openBook(page, 'pages-100');
  await setLayout(page, 'Single');
});

test('overlay is hidden by default and toggles with the centre tap, m and Escape', async ({
  page,
}) => {
  await expect(page.locator('.overlay-top')).toBeHidden();
  await expect(page.locator('.overlay-bottom')).toBeHidden();
  await page.keyboard.press('m');
  await expect(page.locator('.overlay-top')).toBeVisible();
  await expect(page.locator('.overlay-bottom')).toBeVisible();
  await page.keyboard.press('Escape'); // first Escape closes the overlay
  await expect(page.locator('.overlay-top')).toBeHidden();
  const box = (await stage(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.overlay-top')).toBeVisible();
});

test('slider to 50% opens the middle page', async ({ page }) => {
  await page.keyboard.press('m');
  const slider = page.getByRole('slider', { name: 'Page' });
  await slider.fill('50');
  await waitPage(page, 49);
  await expect(page.getByTestId('page-label')).toContainText('50 / 100');
});

test('thumbnail strip shows decoded thumbnails and navigates on click', async ({ page }) => {
  await page.keyboard.press('m');
  await page.getByRole('button', { name: /Pages/ }).click();
  const strip = page.getByTestId('thumb-strip');
  await expect(strip).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go to page 4' })).toBeVisible();
  // a thumbnail has actually been drawn (non-zero canvas)
  await expect
    .poll(() =>
      page
        .locator('.thumb canvas')
        .first()
        .evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Go to page 4' }).click();
  await waitPage(page, 3);
  // jump far, strip follows the current page when reopened
  await page.getByRole('slider', { name: 'Page' }).fill('80');
  await waitPage(page, 79);
});

test('bookmark toggle from the overlay and the b key', async ({ page }) => {
  await page.keyboard.press('ArrowRight');
  await waitPage(page, 1);
  await page.keyboard.press('b');
  await expect(page.getByText('Bookmarked page 2')).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Remove bookmark' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Remove bookmark' }).click();
  await expect(page.getByRole('button', { name: 'Add bookmark' })).toBeVisible();
});

test('quick settings: direction applies and persists; layout cycle key', async ({ page }) => {
  await page.keyboard.press('m');
  await page.getByRole('button', { name: 'Reader settings' }).click();
  const dlg = page.getByRole('dialog', { name: 'Reader settings' });
  await dlg
    .getByRole('group', { name: 'Direction' })
    .getByRole('button', { name: 'Right to left' })
    .click();
  await expect(page.locator('.reader-root')).toHaveAttribute('data-direction', 'rtl');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator('.reader-root')).toHaveAttribute('data-direction', 'rtl');
});

test('page label is announced via a polite live region', async ({ page }) => {
  await page.keyboard.press('ArrowRight');
  await waitPage(page, 1);
  await expect(page.locator('[aria-live=polite][role=status]').first()).toContainText(
    /Page \d+ of 100/,
  );
});

test('series scope applies direction to every volume of the series', async ({ page }) => {
  await importFixtures(page, ['series/Alpha Saga v01.cbz', 'series/Alpha Saga v02.cbz']);
  await page.getByRole('button', { name: 'Open series Alpha Saga' }).click();
  await page.getByRole('button', { name: /Open Alpha Saga v01/ }).click();
  await expect(stage(page)).toHaveAttribute('data-ready', '1');
  await page.keyboard.press('m');
  await page.getByRole('button', { name: 'Reader settings' }).click();
  const dlg = page.getByRole('dialog', { name: 'Reader settings' });
  await dlg
    .getByRole('group', { name: 'Apply changes to' })
    .getByRole('button', { name: 'Whole series' })
    .click();
  await dlg
    .getByRole('group', { name: 'Direction' })
    .getByRole('button', { name: 'Right to left' })
    .click();
  await page.keyboard.press('Escape'); // closes the sheet; the overlay stays visible
  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.getByRole('button', { name: /Open Alpha Saga v02/ }).click();
  await expect(page.locator('.reader-root')).toHaveAttribute('data-direction', 'rtl');
});
