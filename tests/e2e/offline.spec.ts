import { expect, test } from './fixtures.ts';

test('service worker precaches the shell and the app renders offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  // wait until the SW is active and controlling the page
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((res) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => res(), { once: true }),
      );
    }
    return reg.active?.state;
  });
  await page.reload(); // now definitely controlled, populates nothing new
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  // a lazily loaded route and the module worker must work offline too
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await context.setOffline(false);
});
