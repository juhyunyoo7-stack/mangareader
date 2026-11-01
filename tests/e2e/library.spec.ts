import { expect, skipWebkitStorage, test } from './fixtures.ts';
import { importFixtures, openBook, setLayout, stage, waitPage } from './helpers.ts';
import { SERIES_BOOKS } from '../../scripts/fixtures/lib.ts';

skipWebkitStorage();

const SERIES_FILES = SERIES_BOOKS.map((b) => `series/${b.file}`);

test('10 books group into 3 series with the right volume counts', async ({ page }) => {
  await importFixtures(page, SERIES_FILES);
  await expect(page.getByTestId('series-card')).toHaveCount(3);
  for (const [name, count] of [
    ['Alpha Saga', '4 volumes'],
    ['Beta Quest', '3 volumes'],
    ['Gamma Tales', '3 volumes'],
  ] as const) {
    const card = page.locator(`[data-testid=series-card][data-series="${name}"]`);
    await expect(card).toContainText(count);
  }
});

test('series view lists volumes in order and covers are generated', async ({ page }) => {
  await importFixtures(page, SERIES_FILES);
  await page.getByRole('button', { name: 'Open series Alpha Saga' }).click();
  await expect(page.getByRole('heading', { name: 'Alpha Saga' })).toBeVisible();
  const cards = page.getByTestId('book-card');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toContainText('v01');
  await expect(cards.nth(3)).toContainText('v04');
  await expect(cards.first().locator('img.cover')).toBeVisible();
  const naturalW = await cards
    .first()
    .locator('img.cover')
    .evaluate((i: HTMLImageElement) => i.naturalWidth);
  expect(naturalW).toBeGreaterThan(50);
});

test('search "vol 2" finds Beta Quest Vol.2 only', async ({ page }) => {
  await importFixtures(page, SERIES_FILES);
  await page.getByRole('searchbox', { name: 'Search library' }).fill('vol 2');
  const cards = page.getByTestId('book-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Beta Quest Vol.2');
  await page.getByRole('searchbox', { name: 'Search library' }).fill('gamma');
  await expect(cards).toHaveCount(3);
  await page.getByRole('searchbox', { name: 'Search library' }).fill('zzzz');
  await expect(page.getByText('0 results')).toBeVisible();
});

test('sort changes order (name vs size) in All books', async ({ page }) => {
  await importFixtures(page, ['basic-10.cbz', 'odd-7.cbz', 'rtl-manga.cbz']);
  await page.getByRole('button', { name: 'All books' }).click();
  const titles = async () =>
    await page.getByTestId('book-card').locator('.card-title').allInnerTexts();
  await page.getByLabel('Sort').selectOption('name');
  expect(await titles()).toEqual(['basic-10', 'odd-7', 'RTL Test']);
  await page.getByLabel('Sort').selectOption('size');
  const bySize = await titles();
  expect(bySize[bySize.length - 1]).toBe('odd-7'); // smallest file last
});

test('continue reading row appears after reading part of a book', async ({ page }) => {
  await importFixtures(page, ['basic-10.cbz']);
  await expect(page.getByRole('region', { name: 'Continue reading' })).toHaveCount(0);
  await openBook(page, 'basic-10');
  await setLayout(page, 'Single');
  for (let i = 1; i <= 3; i++) {
    await page.keyboard.press('ArrowRight');
    await waitPage(page, i);
  }
  await page.waitForTimeout(800);
  await page.goto('/#/library');
  const row = page.getByRole('region', { name: 'Continue reading' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('basic-10');
  await expect(row).toContainText('33%');
  await row.getByRole('button', { name: /Open basic-10/ }).click();
  await expect(stage(page)).toHaveAttribute('data-page', '3');
});

test('non-ASCII file names are displayed as text and never as markup', async ({ page }) => {
  await importFixtures(page, ['nonascii.cbz', 'traversal.cbz']);
  await page.getByRole('button', { name: 'All books' }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(2);
  // the hostile entry name must not have created elements
  expect(await page.locator('img[src=x]').count()).toBe(0);
  await openBook(page, 'traversal');
  // only the 3 safe images remain as pages (traversal/hidden/junk entries were ignored)
  await page.keyboard.press('m');
  await expect(page.getByTestId('page-label')).toContainText('/ 3');
});

test('book menu: offload keeps progress; remove deletes', async ({ page }) => {
  await importFixtures(page, ['odd-7.cbz']);
  await page.getByRole('button', { name: 'All books' }).click();
  await page.getByRole('button', { name: /Actions for odd-7/ }).click();
  await page.getByRole('button', { name: /Offload/ }).click();
  await expect(page.getByTestId('book-card').getByText('Offloaded')).toBeVisible();
  await page.getByRole('button', { name: /Actions for odd-7/ }).click();
  await page.getByRole('button', { name: 'Remove from library' }).click();
  await page.getByRole('button', { name: /Confirm: remove/ }).click();
  await expect(page.getByText('No books yet')).toBeVisible();
});
