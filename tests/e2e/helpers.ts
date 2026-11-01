import { expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES, buildSeriesBooks } from '../../scripts/fixtures/lib.ts';

const OUT = join(process.cwd(), 'tests', 'fixtures', 'out');

/** Write fixture to disk once (cached) and return its absolute path. */
export function fixturePath(name: string): string {
  mkdirSync(join(OUT, 'series'), { recursive: true });
  const isSeries = name.startsWith('series/');
  const path = join(OUT, name);
  if (!existsSync(path)) {
    const bytes = isSeries ? buildSeriesBooks()[name.slice('series/'.length)]! : FIXTURES[name]!();
    writeFileSync(path, bytes);
  }
  return path;
}

export function fixtureBytes(name: string): Buffer {
  return readFileSync(fixturePath(name));
}

export async function gotoLibrary(page: Page): Promise<void> {
  await page.goto('/#/library');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
}

/** Import fixtures through the file input and wait until all are listed. */
export async function importFixtures(page: Page, names: string[]): Promise<void> {
  await gotoLibrary(page);
  await page.getByTestId('file-input').first().setInputFiles(names.map(fixturePath));
  await expect(page.getByText(/Imported \d+ book/)).toBeVisible({ timeout: 30_000 });
}

/** Open the first book card whose title matches. */
export async function openBook(page: Page, title: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'All books' }).click();
  await page.getByRole('button', { name: title }).first().click();
  await expect(page.locator('.reader-root')).toBeVisible();
  await expect(page.locator('.stage')).toHaveAttribute('data-ready', '1');
}

// ---- reader helpers ---------------------------------------------------------------------------
import type { Locator } from '@playwright/test';
import { pageColor } from '../../scripts/fixtures/lib.ts';

export function stage(page: Page): Locator {
  return page.locator('.stage');
}

export async function waitPage(page: Page, n: number): Promise<void> {
  await expect(stage(page)).toHaveAttribute('data-page', String(n));
}

export async function shownPages(page: Page): Promise<number[]> {
  const v = (await stage(page).getAttribute('data-pages')) ?? '';
  return v === '' ? [] : v.split(',').map(Number);
}

export async function waitPages(page: Page, pages: number[]): Promise<void> {
  await expect(stage(page)).toHaveAttribute('data-pages', pages.join(','));
}

/** Open overlay, choose a layout in the reader settings sheet, close it. */
export async function setLayout(
  page: Page,
  name: 'Single' | 'Double' | 'Auto' | 'Webtoon',
): Promise<void> {
  await page.keyboard.press('m');
  await page.getByRole('button', { name: 'Reader settings' }).click();
  const dlg = page.getByRole('dialog', { name: 'Reader settings' });
  await dlg
    .getByRole('group', { name: 'Layout' })
    .getByRole('button', { name, exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  if (name === 'Single' || name === 'Double') {
    await expect(stage(page)).toHaveAttribute('data-layout', name.toLowerCase());
  }
  await page.keyboard.press('m');
  await expect(page.locator('.overlay-top')).toBeHidden();
}

/** Colour of the pixel at the centre of the canvas for `pageIndex` (the page's colour fixture). */
export async function centreColour(
  page: Page,
  pageIndex: number,
): Promise<[number, number, number]> {
  return page.evaluate((i) => {
    const c = document.querySelector<HTMLCanvasElement>(
      `.spread[data-state=current] canvas.page[data-page="${i}"]`,
    )!;
    const ctx = c.getContext('2d')!;
    // sample a pixel left of the centre digits: 20% across, 30% down
    const d = ctx.getImageData(Math.floor(c.width * 0.2), Math.floor(c.height * 0.3), 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  }, pageIndex);
}

export function expectColourOfPage(actual: [number, number, number], pageIndex: number): void {
  const want = pageColor(pageIndex);
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i]! - want[i]!)).toBeLessThanOrEqual(6);
}
