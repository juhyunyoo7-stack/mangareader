import type { Page } from '@playwright/test';
import { expect, skipWebkitStorage, test } from './fixtures.ts';
import { fixturePath, stage, waitPage } from './helpers.ts';

skipWebkitStorage();
test.use({ uiLocale: 'ko' });

async function openBook(page: Page, title: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: '전체 책' }).click();
  await page.getByRole('button', { name: title }).first().click();
  await expect(page.locator('.reader-root')).toBeVisible();
  await expect(stage(page)).toHaveAttribute('data-ready', '1');
}

async function importKo(page: Page, names: string[]): Promise<void> {
  await page.goto('/#/library');
  await expect(page.getByRole('heading', { name: '라이브러리' })).toBeVisible();
  await page.getByTestId('file-input').first().setInputFiles(names.map(fixturePath));
  await expect(page.getByText(/책 \d+권을 가져왔습니다/).first()).toBeVisible({ timeout: 30_000 });
}

const VIEWPORTS = [
  ['phone', { width: 412, height: 915 }],
  ['ipad', { width: 820, height: 1180 }],
  ['desktop', { width: 1280, height: 800 }],
] as const;

/** Elements whose text is cut off (clipped inside a fixed box) or that poke out of the viewport. */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) {
      out.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${vw})`);
    }
    const label = (e: Element) =>
      `${e.tagName.toLowerCase()}.${(e as HTMLElement).className}: ${(e.textContent ?? '').trim().slice(0, 30)}`;
    for (const e of document.querySelectorAll<HTMLElement>(
      'button, label, h1, h2, .card-title, .card-sub, .badge, .hint, .banner, .toast, .seg, select, p',
    )) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) out.push(`outside viewport: ${label(e)}`);
      const cs = getComputedStyle(e);
      const clips = cs.overflow !== 'visible' || cs.textOverflow === 'ellipsis';
      if (clips && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis') {
        out.push(`text clipped: ${label(e)}`);
      }
    }
    return out;
  });
}

test('the UI is Korean by default and the language can be switched and remembered', async ({
  page,
}) => {
  await page.goto('/#/library');
  await expect(page.getByRole('heading', { name: '라이브러리' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.getByRole('heading', { name: '아직 책이 없습니다' })).toBeVisible();
  await expect(page.getByRole('button', { name: '책 가져오기' }).first()).toBeVisible();
  await page.goto('/#/settings');
  await page.getByRole('group', { name: '언어' }).getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page
    .getByRole('group', { name: 'Language' })
    .getByRole('button', { name: '한국어' })
    .click();
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
});

test('import, library, reader overlay, reader settings and settings are fully Korean', async ({
  page,
}) => {
  await page.goto('/#/library');
  await page.getByTestId('file-input').first().setInputFiles('tests/fixtures/bin/solid4.7z');
  await expect(page.getByText('책 1권을 가져왔습니다.').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '전체 책' }).click();
  await expect(page.getByText('4쪽').first()).toBeVisible();
  await openBook(page, /solid4/);
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: '리더 설정' })).toBeVisible();
  await expect(page.getByRole('button', { name: '북마크 추가' })).toBeVisible();
  await expect(page.getByRole('button', { name: '쪽 목록' })).toBeVisible();
  await page.getByRole('button', { name: '리더 설정' }).click();
  const dlg = page.getByRole('dialog', { name: '리더 설정' });
  await expect(dlg.getByRole('group', { name: '배치' })).toBeVisible();
  await expect(
    dlg.getByRole('group', { name: '방향' }).getByRole('button', { name: '오른쪽 → 왼쪽' }),
  ).toBeVisible();
  await expect(dlg.getByRole('group', { name: '이미지 필터' })).toBeVisible();
  await expect(dlg.getByLabel('여백 자르기')).toBeVisible();
  await dlg.getByRole('button', { name: '닫기' }).click();
  // an error path: a damaged file reports a Korean message
  await page.goto('/#/library');
  await page
    .getByTestId('file-input')
    .first()
    .setInputFiles({
      name: 'x.cbr',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('Rar!\x1a\x07\x00 padding padding'),
    });
  await expect(page.getByText(/x\.cbr: 파일이 잘렸거나 손상되었습니다/).first()).toBeVisible();
  await page
    .getByTestId('file-input')
    .first()
    .setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello hello hello'),
    });
  await expect(page.getByText(/notes\.txt: 지원하지 않는 형식입니다/).first()).toBeVisible();
});

for (const [name, size] of VIEWPORTS) {
  test(`Korean layout has no overflow or clipped text (${name} ${size.width}x${size.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await importKo(page, [
      'basic-10.cbz',
      'series/Alpha Saga v01.cbz',
      'series/Alpha Saga v02.cbz',
    ]);
    const problems: string[] = [];
    const check = async (where: string) => {
      for (const p of await layoutProblems(page)) problems.push(`[${where}] ${p}`);
    };
    await page.goto('/#/library');
    await page.getByRole('button', { name: '전체 책' }).click();
    await page.waitForTimeout(400);
    await check('library');
    await page.screenshot({ path: `docs/screenshots/ko-${name}-library.png` });
    await page.getByRole('button', { name: '시리즈' }).click();
    await page.waitForTimeout(300);
    await check('library-series');
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    await check('settings');
    await page.screenshot({ path: `docs/screenshots/ko-${name}-settings.png`, fullPage: true });
    await page.goto('/#/library');
    await page.getByRole('button', { name: '전체 책' }).click();
    await openBook(page, 'basic-10');
    await page.keyboard.press('m');
    await page.waitForTimeout(400);
    await check('reader-overlay');
    await page.screenshot({ path: `docs/screenshots/ko-${name}-reader-overlay.png` });
    await page.getByRole('button', { name: '리더 설정' }).click();
    await page.waitForTimeout(400);
    await check('reader-settings');
    await page.screenshot({ path: `docs/screenshots/ko-${name}-reader-settings.png` });
    await page
      .getByRole('dialog', { name: '리더 설정' })
      .getByRole('button', { name: '닫기' })
      .click();
    await waitPage(page, 0).catch(() => undefined);
    void stage;
    expect(problems, problems.join('\n')).toEqual([]);
  });
}
