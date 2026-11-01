// Opt-in checks against the owner's real library files (REAL=1). The files are copyrighted personal
// scans: they are read in place by Playwright (never copied into the repo) and the screenshots written
// to docs/screenshots/real-* must stay out of anything published.
import type { Page } from '@playwright/test';
import { existsSync, statSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import { readingOrder } from '../../src/core/panels.ts';
import { stage, waitPage } from './helpers.ts';

const DIR = 'C:/YJH/파일조 다운로드/만화책/소년탐정 김전일';
const vol = (n: number) => `${DIR}/소년탐정 김전일 ${String(n).padStart(2, '0')}권.zip`;

test.skip(!process.env.REAL || !existsSync(vol(10)), 'set REAL=1 with the real files present');
test.use({ viewport: { width: 1280, height: 800 } });

const SHOT = (name: string) => `docs/screenshots/real-${name}.png`;

interface Rec {
  id: string;
  title: string;
  pageCount: number;
  hasCover: boolean;
  pages: { index: number; entry: string; w: number; h: number; wide: boolean }[];
  prefs: Record<string, unknown>;
}

async function books(page: Page): Promise<Rec[]> {
  return page.evaluate(
    () =>
      new Promise<Rec[]>((resolve, reject) => {
        const r = indexedDB.open('mangareader');
        r.onsuccess = () => {
          const q = r.result.transaction('books', 'readonly').objectStore('books').getAll();
          q.onsuccess = () => resolve(q.result as Rec[]);
          q.onerror = () => reject(q.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}

async function importReal(page: Page, n: number): Promise<number> {
  const t0 = Date.now();
  await page.getByTestId('file-input').first().setInputFiles(vol(n));
  await expect(page.getByText(/Imported \d+ book/).first()).toBeVisible({ timeout: 120_000 });
  return Date.now() - t0;
}

function orderReport(b: Rec): string {
  const nums = b.pages.map((p) => {
    const m = /_(\d+)\.jpe?g$/i.exec(p.entry);
    return m ? Number(m[1]) : p.entry.startsWith('_cover') ? 0 : -1;
  });
  const sorted = nums.every((v, i) => i === 0 || v > nums[i - 1]!);
  return `numericOrder=${sorted} first=${b.pages[0]!.entry} last=${b.pages.at(-1)!.entry}`;
}

test('real volumes import consistently (10, 01, 20)', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?debug=1#/library');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  const t0 = Date.now();
  const files = [10, 1, 20].filter((n) => existsSync(vol(n)));
  await page.getByTestId('file-input').first().setInputFiles(files.map(vol));
  await expect(page.getByText(new RegExp(`Imported ${files.length} book`)).first()).toBeVisible({
    timeout: 180_000,
  });
  console.log(
    `IMPORT ${files.length} volumes: ${Date.now() - t0} ms, ${files.map((n) => (statSync(vol(n)).size / 1e6).toFixed(1)).join('+')} MB`,
  );
  const all = (await books(page)).sort((a, b) => a.title.localeCompare(b.title));
  for (const b of all) {
    const dims = new Map<string, number>();
    for (const p of b.pages)
      dims.set(
        `${p.w >= 900 ? 'spread' : 'single'}`,
        (dims.get(`${p.w >= 900 ? 'spread' : 'single'}`) ?? 0) + 1,
      );
    console.log(
      `BOOK "${b.title}" pages=${b.pageCount} cover=${b.hasCover} ${orderReport(b)} kinds=${JSON.stringify([...dims])} prefs=${JSON.stringify(b.prefs)} wideFlags=${b.pages.filter((p) => p.wide).length}`,
    );
  }
  await page.getByRole('button', { name: 'All books' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOT('library'), fullPage: false });
});

async function openVolume(page: Page, n: number) {
  await page.goto('/?debug=1#/library');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  const ms = await importReal(page, n);
  await page.getByRole('button', { name: 'All books' }).click();
  const t0 = Date.now();
  await page
    .getByRole('button', { name: new RegExp(`${String(n).padStart(2, '0')}권`) })
    .first()
    .click();
  await expect(page.locator('.reader-root')).toBeVisible();
  await expect(stage(page)).toHaveAttribute('data-ready', '1');
  return { importMs: ms, openMs: Date.now() - t0 };
}

const state = (page: Page) =>
  page.evaluate(() => {
    const st = document.querySelector('.stage') as HTMLElement;
    return {
      page: st.dataset.page,
      pages: st.dataset.pages,
      layout: st.dataset.layout,
      zoom: st.dataset.zoom,
    };
  });

test('reader basics on volume 10: open time, layout, direction, screenshots', async ({ page }) => {
  test.setTimeout(240_000);
  const { importMs, openMs } = await openVolume(page, 10);
  console.log('IMPORT_MS', importMs, 'OPEN_MS', openMs, JSON.stringify(await state(page)));
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOT('v10-p0-cover') });
  await page.keyboard.press('ArrowRight');
  await waitPage(page, 1);
  await page.waitForTimeout(500);
  console.log('AFTER ArrowRight', JSON.stringify(await state(page)));
  await page.screenshot({ path: SHOT('v10-p1') });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  console.log('AFTER ArrowRight x2', JSON.stringify(await state(page)));
  await page.screenshot({ path: SHOT('v10-p2') });
});

interface PanelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Draw numbered panel boxes (fractions of the page, already in reading order) over the shown page. */
async function drawPanels(page: Page, order: PanelBox[]): Promise<void> {
  await page.evaluate((boxes) => {
    document.querySelectorAll('.dbg-panel').forEach((e) => e.remove());
    const c = document.querySelector('.spread[data-state=current] canvas.page') as HTMLElement;
    const r = c.getBoundingClientRect();
    boxes.forEach((b, i) => {
      const d = document.createElement('div');
      d.className = 'dbg-panel';
      d.style.cssText = `position:fixed;z-index:9999;pointer-events:none;border:3px solid rgb(255,0,0);box-sizing:border-box;left:${r.left + b.x * r.width}px;top:${r.top + b.y * r.height}px;width:${b.w * r.width}px;height:${b.h * r.height}px;color:#f00;font:bold 28px sans-serif;background:rgba(255,255,0,0.12)`;
      d.textContent = String(i + 1);
      document.body.appendChild(d);
    });
  }, order);
}

test('guided view detection on 10 real pages of volume 10 (annotated screenshots)', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openVolume(page, 10);
  const picks = [1, 2, 3, 10, 20, 30, 45, 60, 75, 87];
  for (const p of picks) {
    await page.evaluate((n) => (window as any).__mr.goto(n), p);
    await waitPage(page, p);
    await page.waitForTimeout(400);
    const a = (await page.evaluate((n) => (window as any).__mr.decoder.analyze(n), p)) as {
      panels: PanelBox[];
      trim: PanelBox;
      spread: boolean;
    };
    const ordered = a.panels.length > 1 ? readingOrder(a.panels, false, a.spread) : a.panels;
    console.log(
      `PANELS p${p}: n=${a.panels.length} spread=${a.spread} trim=${JSON.stringify(a.trim)}`,
    );
    await drawPanels(page, ordered);
    await page.screenshot({ path: SHOT(`v10-panels-p${String(p).padStart(2, '0')}`) });
  }
});

test('page-turn latency, memory, zoom/pan and resume on volume 10', async ({ page }) => {
  test.setTimeout(240_000);
  await openVolume(page, 10);
  await page.evaluate(() => {
    const w = window as any;
    w.__lat = [] as number[];
    let t0 = 0;
    window.addEventListener('keydown', () => (t0 = performance.now()), true);
    // latency = key press -> the next animation frame after the new page's canvas was attached
    new MutationObserver((ms) => {
      for (const m of ms) {
        for (const n of m.addedNodes) {
          if (n instanceof HTMLElement && n.classList.contains('spread') && t0) {
            const start = t0;
            t0 = 0;
            requestAnimationFrame(() => w.__lat.push(performance.now() - start));
          }
        }
      }
    }).observe(document.querySelector('.stage')!, { childList: true });
  });
  // first-time (cold) turns: every page is decoded for the first time
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(180);
  }
  const lat = (await page.evaluate(() => (window as any).__lat)) as number[];
  console.log(
    'LAT_RAW',
    lat
      .slice(0, 12)
      .map((v) => v.toFixed(0))
      .join(' '),
  );
  const sorted = [...lat].sort((a, b) => a - b);
  const q = (f: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))]!.toFixed(0);
  console.log(
    `LATENCY_MS n=${lat.length} median=${q(0.5)} p90=${q(0.9)} max=${sorted.at(-1)!.toFixed(0)} (keydown -> new page on screen, 180 ms between turns)`,
  );
  // (a) turn to an already prefetched page after the reader has been idle
  const idle: number[] = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(1500);
    await page.evaluate(() => ((window as any).__lat.length = 0));
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    const l = (await page.evaluate(() => (window as any).__lat)) as number[];
    idle.push(l.at(-1)!);
  }
  console.log('LATENCY_IDLE_PREFETCHED_MS', idle.map((v) => v.toFixed(0)).join(' '));
  // (b) decode time of pages nothing has touched yet (what a jump or a cold turn waits for)
  const cold = (await page.evaluate(async () => {
    const out: number[] = [];
    for (const n of [88, 80, 72, 64, 56, 48, 40, 32]) {
      const t0 = performance.now();
      const d = await (window as any).__mr.decoder.decodePage(n, 1280, 800);
      out.push(performance.now() - t0);
      d.bitmap.close();
    }
    return out;
  })) as number[];
  console.log('DECODE_COLD_PAGE_MS', cold.map((v) => v.toFixed(0)).join(' '));
  // fast flipping: 20 turns 30 ms apart must not pile up work
  const t1 = Date.now();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(600);
  console.log(
    'FAST_FLIP settled_on',
    JSON.stringify(await state(page)),
    'elapsed_ms',
    Date.now() - t1,
  );
  const dbg = await page.evaluate(() => {
    const d = (window as any).__mr.debug();
    const pm = (performance as any).memory;
    return {
      cache: d.cache,
      canvases: d.canvases,
      jsHeapMB: pm ? Math.round(pm.usedJSHeapSize / 1048576) : null,
    };
  });
  console.log('MEMORY', JSON.stringify(dbg));
  // zoom / pan
  await page.evaluate((n) => (window as any).__mr.goto(n), 30);
  await waitPage(page, 30);
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await page.waitForTimeout(900);
  console.log(
    'ZOOM',
    JSON.stringify(await state(page)),
    'tiles',
    await stage(page).getAttribute('data-tiles'),
  );
  await page.screenshot({ path: SHOT('v10-p30-zoom') });
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(600);
  await page.screenshot({ path: SHOT('v10-p30-zoom-panned') });
  // resume after reload
  await page.keyboard.press('0');
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(stage(page)).toHaveAttribute('data-ready', '1');
  console.log('RESUME_AFTER_RELOAD', JSON.stringify(await state(page)));
  await expect(stage(page)).toHaveAttribute('data-page', '30');
});

test('filters and auto-trim look on a real page', async ({ page }) => {
  test.setTimeout(240_000);
  await openVolume(page, 10);
  await page.evaluate((n) => (window as any).__mr.goto(n), 3);
  await waitPage(page, 3);
  await page.waitForTimeout(500);
  for (const name of ['Dim', 'Invert-soft', 'Sepia', 'E-ink', 'Off']) {
    await page.keyboard.press('m');
    await page.getByRole('button', { name: 'Reader settings' }).click();
    const dlg = page.getByRole('dialog', { name: 'Reader settings' });
    await dlg
      .getByRole('group', { name: 'Image filter' })
      .getByRole('button', { name, exact: true })
      .click();
    await dlg.getByRole('button', { name: 'Close' }).click();
    await page.keyboard.press('m');
    await page.waitForTimeout(500);
    if (name !== 'Off') await page.screenshot({ path: SHOT(`v10-p3-${name.toLowerCase()}`) });
  }
  // trim box statistics over all pages
  const all = (await page.evaluate(async () => {
    const out: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < 89; i++) out.push((await (window as any).__mr.decoder.analyze(i)).trim);
    return out;
  })) as { x: number; y: number; w: number; h: number }[];
  const cropped = all.filter((t) => t.w * t.h < 0.99);
  const share = cropped.map((t) => 1 - t.w * t.h).sort((a, b) => a - b);
  console.log(
    `TRIM pages=${all.length} cropped=${cropped.length} median_removed=${share.length ? (share[Math.floor(share.length / 2)]! * 100).toFixed(1) : 0}% max_removed=${share.length ? (share.at(-1)! * 100).toFixed(1) : 0}%`,
  );
  await page.keyboard.press('m');
  await page.getByRole('button', { name: 'Reader settings' }).click();
  const dlg = page.getByRole('dialog', { name: 'Reader settings' });
  await dlg.getByLabel('Trim page margins').check();
  await dlg.getByRole('button', { name: 'Close' }).click();
  await page.keyboard.press('m');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOT('v10-p3-trim-on') });
});

test('RTL: per-series setting is inherited by other volumes; guided steps on a real spread', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto('/?debug=1#/library');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await page
    .getByTestId('file-input')
    .first()
    .setInputFiles([vol(10), vol(20)]);
  await expect(page.getByText(/Imported 2 book/).first()).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: 'All books' }).click();
  await page.getByRole('button', { name: /10권/ }).first().click();
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
  await dlg.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(500);
  await page.goto('/?debug=1#/library');
  await page.getByRole('button', { name: 'All books' }).click();
  await page.getByRole('button', { name: /20권/ }).first().click();
  await expect(stage(page)).toHaveAttribute('data-ready', '1');
  const rtl = await page.evaluate(() => (window as any).__mr.getConfig().direction);
  console.log('SERIES_RTL volume20 direction =', rtl);
  expect(rtl).toBe('rtl');
});

test('guided view keyboard walk on real spread pages 1 and 60', async ({ page }) => {
  test.setTimeout(240_000);
  await openVolume(page, 10);
  await page.evaluate((n) => (window as any).__mr.goto(n), 1);
  await waitPage(page, 1);
  await page.keyboard.press('g');
  await expect(stage(page)).toHaveAttribute('data-guided', 'ready', { timeout: 15_000 });
  const n = Number(await stage(page).getAttribute('data-panels'));
  console.log('GUIDED p1 panels', n);
  for (let k = 0; k < n; k++) {
    await page.waitForTimeout(450);
    console.log(
      `  step ${k}: panel=${await stage(page).getAttribute('data-panel')} zoom=${await stage(page).getAttribute('data-zoom')} rect=${await stage(page).getAttribute('data-panel-rect')}`,
    );
    if ([0, 2, 4].includes(k)) await page.screenshot({ path: SHOT(`v10-guided-p1-step${k}`) });
    await page.keyboard.press('ArrowRight');
  }
  await page.waitForTimeout(600);
  console.log(
    'after last panel ->',
    JSON.stringify(await state(page)),
    'panel',
    await stage(page).getAttribute('data-panel'),
  );
});
