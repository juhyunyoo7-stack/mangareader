import { test as base, expect, type BrowserContext } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Playwright WebKit on Windows throws UnknownError for OPFS in ephemeral contexts, so WebKit runs
 * in a persistent context (temp profile). Chromium uses the normal ephemeral context.
 */
export const test = base.extend<{ uiLocale: string }>({
  uiLocale: ['en', { option: true }],
  // the UI is Korean by default; most specs select by English text, so they run in the English locale
  // (the Korean UI has its own spec, tests/e2e/korean.spec.ts, which overrides this)
  context: async (
    {
      browser,
      browserName,
      playwright,
      viewport,
      userAgent,
      hasTouch,
      isMobile,
      deviceScaleFactor,
      baseURL,
      serviceWorkers,
      uiLocale,
    },
    use,
  ) => {
    const seedLocale = (c: BrowserContext) =>
      c.addInitScript((l) => {
        try {
          if (!localStorage.getItem('mr.locale')) localStorage.setItem('mr.locale', l);
        } catch {
          /* storage blocked */
        }
      }, uiLocale);
    const opts = {
      viewport,
      userAgent,
      hasTouch,
      isMobile,
      deviceScaleFactor,
      baseURL,
      serviceWorkers,
    };
    if (browserName !== 'webkit') {
      const ctx = await browser.newContext(opts);
      await seedLocale(ctx);
      await use(ctx);
      await ctx.close();
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'mr-wk-'));
    const ctx = await playwright.webkit.launchPersistentContext(dir, opts);
    await seedLocale(ctx);
    await use(ctx);
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  },
});
export { expect };

/**
 * The Playwright WebKit build for Windows has no working OPFS file writes (createSyncAccessHandle
 * throws NotSupportedError, createWritable silently writes 0 bytes), so specs that store books
 * run on Chromium only. Real iOS Safari must be checked manually (docs/STATUS.md).
 */
export function skipWebkitStorage(): void {
  test.beforeEach(({ browserName }) => {
    test.skip(
      browserName === 'webkit',
      'Playwright WebKit on Windows has no functional OPFS writes',
    );
  });
}
